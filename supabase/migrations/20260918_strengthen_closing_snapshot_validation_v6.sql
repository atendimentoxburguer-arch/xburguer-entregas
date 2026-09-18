-- Reforça a validação interna dos fechamentos e da importação de snapshots.

create or replace function public.xb_closing_is_consistent(p_details jsonb, p_snapshot jsonb)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  delivered_count integer;
  cancelled_count integer;
  pending_count integer;
  total_value numeric;
  total_fees numeric;
  cancelled_fees numeric;
  payment_count integer;
  payment_value numeric;
  courier_delivered integer;
  courier_cancelled integer;
  courier_fees numeric;
  courier_cancelled_fees numeric;
  snapshot_delivered integer;
  snapshot_cancelled integer;
  snapshot_value numeric;
  snapshot_fees numeric;
  snapshot_cancelled_fees numeric;
begin
  if p_details is null or jsonb_typeof(p_details) <> 'object' then return false; end if;
  if jsonb_typeof(p_details->'payments') <> 'array' then return false; end if;
  if jsonb_typeof(p_details->'couriers') <> 'array' then return false; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'array' then return false; end if;

  delivered_count := greatest(0, coalesce((p_details->>'totalDeliveries')::integer, 0));
  cancelled_count := greatest(0, coalesce((p_details->>'cancelledDeliveries')::integer, 0));
  pending_count := greatest(0, coalesce((p_details->>'pending')::integer, 0));
  total_value := round(coalesce((p_details->>'totalOrderValue')::numeric, 0), 2);
  total_fees := round(coalesce((p_details->>'totalFees')::numeric, 0), 2);
  cancelled_fees := round(coalesce((p_details->>'cancelledFees')::numeric, 0), 2);

  if pending_count <> 0 then return false; end if;

  select coalesce(sum(greatest(0, (x->>'count')::integer)),0),
         round(coalesce(sum((x->>'value')::numeric),0),2)
    into payment_count, payment_value
  from jsonb_array_elements(p_details->'payments') x;

  select coalesce(sum(greatest(0, (x->>'count')::integer)),0),
         coalesce(sum(greatest(0, (x->>'cancelled')::integer)),0),
         round(coalesce(sum((x->>'fees')::numeric),0),2),
         round(coalesce(sum((x->>'cancelledFees')::numeric),0),2)
    into courier_delivered, courier_cancelled, courier_fees, courier_cancelled_fees
  from jsonb_array_elements(p_details->'couriers') x;

  select count(*) filter (where x->>'status' = 'Entregue'),
         count(*) filter (where x->>'status' = 'Cancelada'),
         round(coalesce(sum((x->>'orderValue')::numeric) filter (where x->>'status' = 'Entregue'),0),2),
         round(coalesce(sum((x->>'fee')::numeric) filter (where x->>'status' in ('Entregue','Cancelada')),0),2),
         round(coalesce(sum((x->>'fee')::numeric) filter (where x->>'status' = 'Cancelada'),0),2)
    into snapshot_delivered, snapshot_cancelled, snapshot_value, snapshot_fees, snapshot_cancelled_fees
  from jsonb_array_elements(p_snapshot) x;

  return payment_count = delivered_count
     and payment_value = total_value
     and courier_delivered = delivered_count
     and courier_cancelled = cancelled_count
     and courier_fees = total_fees
     and courier_cancelled_fees = cancelled_fees
     and snapshot_delivered = delivered_count
     and snapshot_cancelled = cancelled_count
     and jsonb_array_length(p_snapshot) = delivered_count + cancelled_count
     and snapshot_value = total_value
     and snapshot_fees = total_fees
     and snapshot_cancelled_fees = cancelled_fees;
exception when others then
  return false;
end;
$$;

create or replace function public.xb_import_closing(
  p_date date,
  p_closed_at timestamptz,
  p_details jsonb,
  p_snapshot jsonb
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  wrong_date_count integer := 0;
begin
  if current_user_id is null then raise exception 'Usuário não autenticado'; end if;
  if p_date is null then raise exception 'Data do fechamento é obrigatória'; end if;
  if p_details is null or p_snapshot is null then raise exception 'Dados do fechamento são obrigatórios'; end if;
  if not public.xb_closing_is_consistent(p_details, p_snapshot) then
    raise exception 'Fechamento importado está inconsistente';
  end if;

  begin
    select count(*)
      into wrong_date_count
    from jsonb_array_elements(p_snapshot) x
    where nullif(x->>'createdAt','') is null
       or (((x->>'createdAt')::timestamptz at time zone 'America/Sao_Paulo')::date <> p_date);
  exception when others then
    raise exception 'Snapshot do fechamento possui data inválida';
  end;

  if wrong_date_count > 0 then
    raise exception 'Snapshot do fechamento contém registro de outra data';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':' || p_date::text, 0));
  perform set_config('xburguer.closing_write','1',true);

  insert into public.daily_closings(user_id,date,closed_at,reopened_at,details_v2,delivery_snapshot_v1,legacy_payload)
  values(
    current_user_id,p_date,coalesce(p_closed_at,now()),null,p_details,p_snapshot,
    jsonb_build_object('date',p_date,'closedAt',coalesce(p_closed_at,now()),'detailsV2',p_details,'deliverySnapshotV1',p_snapshot)
  )
  on conflict(user_id,date) do update set
    closed_at=excluded.closed_at,
    reopened_at=null,
    details_v2=excluded.details_v2,
    delivery_snapshot_v1=excluded.delivery_snapshot_v1,
    legacy_payload=excluded.legacy_payload;

  return true;
end;
$$;

revoke execute on function public.xb_import_closing(date,timestamptz,jsonb,jsonb) from public;
grant execute on function public.xb_import_closing(date,timestamptz,jsonb,jsonb) to authenticated;
