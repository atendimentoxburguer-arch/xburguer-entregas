-- Integridade de fechamento e entregas - 13/09/2026
-- Aplicada no projeto de produção antes deste arquivo ser versionado.

create or replace function public.xb_closing_is_consistent(p_details jsonb, p_snapshot jsonb)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  delivered_count integer; cancelled_count integer; pending_count integer;
  total_value numeric; total_fees numeric; cancelled_fees numeric;
  payment_count integer; payment_value numeric;
  courier_delivered integer; courier_cancelled integer; courier_fees numeric; courier_cancelled_fees numeric;
  snapshot_delivered integer; snapshot_cancelled integer; snapshot_value numeric; snapshot_fees numeric;
begin
  if p_details is null or jsonb_typeof(p_details) <> 'object' then return false; end if;
  if jsonb_typeof(p_details->'payments') <> 'array' then return false; end if;
  if jsonb_typeof(p_details->'couriers') <> 'array' then return false; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'array' then return false; end if;

  delivered_count := greatest(0, coalesce((p_details->>'totalDeliveries')::integer,0));
  cancelled_count := greatest(0, coalesce((p_details->>'cancelledDeliveries')::integer,0));
  pending_count := greatest(0, coalesce((p_details->>'pending')::integer,0));
  total_value := round(coalesce((p_details->>'totalOrderValue')::numeric,0),2);
  total_fees := round(coalesce((p_details->>'totalFees')::numeric,0),2);
  cancelled_fees := round(coalesce((p_details->>'cancelledFees')::numeric,0),2);
  if pending_count <> 0 then return false; end if;

  select coalesce(sum(greatest(0,(x->>'count')::integer)),0), round(coalesce(sum((x->>'value')::numeric),0),2)
    into payment_count,payment_value from jsonb_array_elements(p_details->'payments') x;
  select coalesce(sum(greatest(0,(x->>'count')::integer)),0),
         coalesce(sum(greatest(0,(x->>'cancelled')::integer)),0),
         round(coalesce(sum((x->>'fees')::numeric),0),2),
         round(coalesce(sum((x->>'cancelledFees')::numeric),0),2)
    into courier_delivered,courier_cancelled,courier_fees,courier_cancelled_fees
    from jsonb_array_elements(p_details->'couriers') x;
  select count(*) filter (where x->>'status'='Entregue'),
         count(*) filter (where x->>'status'='Cancelada'),
         round(coalesce(sum((x->>'orderValue')::numeric) filter (where x->>'status'='Entregue'),0),2),
         round(coalesce(sum((x->>'fee')::numeric) filter (where x->>'status' in ('Entregue','Cancelada')),0),2)
    into snapshot_delivered,snapshot_cancelled,snapshot_value,snapshot_fees
    from jsonb_array_elements(p_snapshot) x;

  return payment_count=delivered_count and payment_value=total_value
     and courier_delivered=delivered_count and courier_cancelled=cancelled_count
     and courier_fees=total_fees and courier_cancelled_fees=cancelled_fees
     and snapshot_delivered=delivered_count and snapshot_cancelled=cancelled_count
     and jsonb_array_length(p_snapshot)=delivered_count+cancelled_count
     and snapshot_value=total_value and snapshot_fees=total_fees;
exception when others then return false;
end;
$$;

create or replace function public.xb_lock_delivery_business_day()
returns trigger language plpgsql security invoker set search_path=public as $$
declare
  user_value uuid; old_day date; new_day date; old_key bigint; new_key bigint;
begin
  user_value := coalesce(new.user_id,old.user_id);
  if tg_op <> 'INSERT' then old_day := (old.created_at at time zone 'America/Sao_Paulo')::date; end if;
  if tg_op <> 'DELETE' then new_day := (new.created_at at time zone 'America/Sao_Paulo')::date; end if;
  if old_day is not null then old_key := hashtextextended(user_value::text||':'||old_day::text,0); end if;
  if new_day is not null then new_key := hashtextextended(user_value::text||':'||new_day::text,0); end if;
  if old_key is not null and new_key is not null and old_key <> new_key then
    perform pg_advisory_xact_lock(least(old_key,new_key)); perform pg_advisory_xact_lock(greatest(old_key,new_key));
  else
    perform pg_advisory_xact_lock(coalesce(new_key,old_key));
  end if;
  return coalesce(new,old);
end;
$$;

drop trigger if exists deliveries_lock_business_day on public.deliveries;
create trigger deliveries_lock_business_day before insert or update or delete on public.deliveries
for each row execute function public.xb_lock_delivery_business_day();

create or replace function public.xb_guard_delivery_state()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.payment <> 'Dinheiro' then
    new.change_for := null;
  elsif new.change_for is not null and new.change_for < new.order_value then
    raise exception 'O valor para troco não pode ser menor que o valor do pedido';
  end if;
  if tg_op='INSERT' and new.order_value <= 0 then raise exception 'O valor do pedido precisa ser maior que zero'; end if;
  if tg_op='INSERT' and btrim(coalesce(new.address,''))='' then raise exception 'O endereço da entrega é obrigatório'; end if;
  if new.status='Entregue' and new.order_value <= 0 then raise exception 'Não é possível concluir uma entrega com valor de pedido zerado'; end if;
  if new.status='Entregue' and new.courier_id is null then raise exception 'Não é possível concluir uma entrega sem entregador'; end if;
  if new.payment='Pago online' and new.payment_confirmed_at is null then
    new.payment_confirmed_at := coalesce(new.created_at,now());
  elsif new.status='Entregue' and new.payment_confirmed_at is null then
    new.payment_confirmed_at := now();
  elsif new.status='Aguardando' and new.payment <> 'Pago online' then
    new.payment_confirmed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists deliveries_guard_state on public.deliveries;
create trigger deliveries_guard_state before insert or update on public.deliveries
for each row execute function public.xb_guard_delivery_state();

drop trigger if exists deliveries_guard_fee on public.deliveries;
create trigger deliveries_guard_fee before insert or update on public.deliveries
for each row execute function public.xb_guard_delivery_fee();

create or replace function public.xb_authoritative_closing_write()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if coalesce(current_setting('xburguer.closing_write',true),'')='1' then return coalesce(new,old); end if;
  if tg_op='UPDATE' then return old; end if;
  return null;
end;
$$;

drop trigger if exists daily_closings_authoritative_write on public.daily_closings;
create trigger daily_closings_authoritative_write before insert or update or delete on public.daily_closings
for each row execute function public.xb_authoritative_closing_write();

create or replace function public.xb_finalize_day(p_date date, p_allow_pending boolean default false)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  current_user_id uuid := auth.uid(); business_today date := (now() at time zone 'America/Sao_Paulo')::date;
  pending_count integer:=0; invalid_count integer:=0; final_count integer:=0; delivered_count integer:=0; cancelled_count integer:=0;
  total_order_value numeric(12,2):=0; total_fees numeric(12,2):=0; cancelled_fees numeric(12,2):=0;
  payments jsonb:='[]'::jsonb; couriers jsonb:='[]'::jsonb; snapshot jsonb:='[]'::jsonb; details jsonb; result jsonb;
  existing public.daily_closings%rowtype;
begin
  if current_user_id is null then raise exception 'Usuário não autenticado'; end if;
  if p_date is null then raise exception 'Data do fechamento é obrigatória'; end if;
  if p_date > business_today then raise exception 'Não é possível fechar uma data futura'; end if;
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text||':'||p_date::text,0));
  select * into existing from public.daily_closings where user_id=current_user_id and date=p_date;
  if found and public.xb_closing_is_consistent(existing.details_v2,existing.delivery_snapshot_v1) then
    return jsonb_build_object('date',existing.date,'closedAt',existing.closed_at,'detailsV2',existing.details_v2,'deliverySnapshotV1',existing.delivery_snapshot_v1);
  end if;

  select count(*) filter(where status='Aguardando'), count(*) filter(where status in ('Entregue','Cancelada')),
         count(*) filter(where status='Entregue'), count(*) filter(where status='Cancelada'),
         coalesce(round(sum(order_value) filter(where status='Entregue'),2),0),
         coalesce(round(sum(fee) filter(where status in ('Entregue','Cancelada')),2),0),
         coalesce(round(sum(fee) filter(where status='Cancelada'),2),0),
         count(*) filter(where status='Entregue' and (order_value<=0 or courier_id is null or btrim(coalesce(address,''))=''))
  into pending_count,final_count,delivered_count,cancelled_count,total_order_value,total_fees,cancelled_fees,invalid_count
  from public.deliveries where user_id=current_user_id and (created_at at time zone 'America/Sao_Paulo')::date=p_date;

  if final_count=0 and pending_count=0 then raise exception 'Nenhuma entrega encontrada para esta data'; end if;
  if pending_count>0 then raise exception 'Existem % entrega(s) pendente(s). Conclua ou cancele antes de fechar o dia.',pending_count; end if;
  if invalid_count>0 then raise exception 'Existem % entrega(s) concluída(s) com dados inválidos. Corrija antes de fechar o dia.',invalid_count; end if;

  select coalesce(jsonb_agg(jsonb_build_object('name',method,'count',item_count,'value',item_value) order by ord),'[]'::jsonb)
  into payments from (
    select methods.ord,methods.method,count(d.id)::integer item_count,coalesce(round(sum(d.order_value),2),0)::numeric(12,2) item_value
    from (values(1,'Dinheiro'::text),(2,'PIX'::text),(3,'Cartão'::text),(4,'Pago online'::text)) methods(ord,method)
    left join public.deliveries d on d.user_id=current_user_id and (d.created_at at time zone 'America/Sao_Paulo')::date=p_date and d.status='Entregue' and d.payment=methods.method
    group by methods.ord,methods.method
  ) p;

  select coalesce(jsonb_agg(jsonb_build_object('id',courier_key,'name',courier_name,'count',delivered_qty,'cancelled',cancelled_qty,'cancelledFees',cancelled_fee_value,'fees',fee_value) order by courier_name),'[]'::jsonb)
  into couriers from (
    select coalesce(d.courier_id,'__without_courier__') courier_key,coalesce(max(c.name),'Sem entregador definido') courier_name,
      count(*) filter(where d.status='Entregue')::integer delivered_qty,count(*) filter(where d.status='Cancelada')::integer cancelled_qty,
      coalesce(round(sum(d.fee) filter(where d.status='Cancelada'),2),0)::numeric(12,2) cancelled_fee_value,
      coalesce(round(sum(d.fee),2),0)::numeric(12,2) fee_value
    from public.deliveries d left join public.couriers c on c.user_id=d.user_id and c.id=d.courier_id
    where d.user_id=current_user_id and (d.created_at at time zone 'America/Sao_Paulo')::date=p_date and d.status in ('Entregue','Cancelada')
    group by coalesce(d.courier_id,'__without_courier__')
  ) q;

  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'code',d.code,'client',d.client,'phone',d.phone,'address',d.address,'reference',d.reference,
    'courierId',d.courier_id,'courierName',coalesce(c.name,'Sem entregador definido'),'fee',d.fee,'orderValue',d.order_value,'payment',d.payment,
    'changeFor',d.change_for,'notes',d.notes,'status',d.status,'createdAt',d.created_at,'updatedAt',d.updated_at,'paymentConfirmedAt',d.payment_confirmed_at)
    order by d.created_at,d.code),'[]'::jsonb)
  into snapshot from public.deliveries d left join public.couriers c on c.user_id=d.user_id and c.id=d.courier_id
  where d.user_id=current_user_id and (d.created_at at time zone 'America/Sao_Paulo')::date=p_date and d.status in ('Entregue','Cancelada');

  details := jsonb_build_object('totalDeliveries',delivered_count,'totalOrderValue',total_order_value,'totalFees',total_fees,
    'cancelledDeliveries',cancelled_count,'cancelledFees',cancelled_fees,'pending',0,'payments',payments,'couriers',couriers);
  perform set_config('xburguer.closing_write','1',true);
  insert into public.daily_closings(user_id,date,closed_at,reopened_at,details_v2,delivery_snapshot_v1,legacy_payload)
  values(current_user_id,p_date,coalesce(existing.closed_at,now()),null,details,snapshot,
    jsonb_build_object('date',p_date,'closedAt',coalesce(existing.closed_at,now()),'detailsV2',details,'deliverySnapshotV1',snapshot))
  on conflict(user_id,date) do update set closed_at=coalesce(public.daily_closings.closed_at,excluded.closed_at),reopened_at=null,
    details_v2=excluded.details_v2,delivery_snapshot_v1=excluded.delivery_snapshot_v1,legacy_payload=excluded.legacy_payload
  returning jsonb_build_object('date',date,'closedAt',closed_at,'detailsV2',details_v2,'deliverySnapshotV1',delivery_snapshot_v1) into result;
  return result;
end;
$$;

create or replace function public.xb_reopen_day(p_date date)
returns boolean language plpgsql security invoker set search_path=public as $$
declare current_user_id uuid:=auth.uid(); deleted_count integer;
begin
  if current_user_id is null then raise exception 'Usuário não autenticado'; end if;
  if p_date is null then raise exception 'Data do fechamento é obrigatória'; end if;
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text||':'||p_date::text,0));
  perform set_config('xburguer.closing_write','1',true);
  delete from public.daily_closings where user_id=current_user_id and date=p_date;
  get diagnostics deleted_count=row_count;
  return deleted_count>0;
end;
$$;

grant execute on function public.xb_closing_is_consistent(jsonb,jsonb) to authenticated;
grant execute on function public.xb_finalize_day(date,boolean) to authenticated;
grant execute on function public.xb_reopen_day(date) to authenticated;
