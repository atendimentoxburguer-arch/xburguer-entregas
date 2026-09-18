-- Restauração autoritativa e atômica do backup.
-- Qualquer erro desfaz a operação inteira no PostgreSQL.

create or replace function public.xb_restore_backup(
  p_settings jsonb,
  p_couriers jsonb,
  p_deliveries jsonb,
  p_closings jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  item jsonb;
  closing_date date;
  details jsonb;
  snapshot jsonb;
  wrong_date_count integer;
  delivery_count integer := 0;
  courier_count integer := 0;
  closing_count integer := 0;
  maximum_code bigint := 0;
  requested_next bigint := 1;
begin
  if current_user_id is null then raise exception 'Usuário não autenticado'; end if;
  if p_couriers is null or jsonb_typeof(p_couriers) <> 'array'
     or p_deliveries is null or jsonb_typeof(p_deliveries) <> 'array'
     or p_closings is null or jsonb_typeof(p_closings) <> 'array' then
    raise exception 'Backup possui estrutura inválida';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':backup-restore', 0));
  perform set_config('xburguer.closing_write','1',true);

  delete from public.daily_closings where user_id = current_user_id;
  delete from public.deliveries where user_id = current_user_id;
  delete from public.couriers where user_id = current_user_id;

  for item in select value from jsonb_array_elements(p_couriers)
  loop
    if btrim(coalesce(item->>'id','')) = '' or btrim(coalesce(item->>'name','')) = '' then
      raise exception 'Backup possui entregador sem ID ou nome';
    end if;
    insert into public.couriers(user_id,id,name,phone,fee,active,created_at,updated_at)
    values(
      current_user_id,item->>'id',item->>'name',coalesce(item->>'phone',''),
      coalesce(nullif(item->>'fee','')::numeric,0),
      coalesce(nullif(item->>'active','')::boolean,true),
      coalesce(nullif(item->>'createdAt','')::timestamptz,now()),
      coalesce(nullif(item->>'updatedAt','')::timestamptz,nullif(item->>'createdAt','')::timestamptz,now())
    );
    courier_count := courier_count + 1;
  end loop;

  for item in select value from jsonb_array_elements(p_deliveries)
  loop
    if btrim(coalesce(item->>'id','')) = '' then raise exception 'Backup possui entrega sem ID'; end if;
    if nullif(item->>'createdAt','') is null then raise exception 'Backup possui entrega sem data de criação'; end if;

    insert into public.deliveries(
      user_id,id,code,client,phone,address,reference,courier_id,fee,order_value,
      payment,change_for,notes,status,payment_confirmed_at,created_at,updated_at
    ) values (
      current_user_id,item->>'id',(item->>'code')::bigint,
      coalesce(item->>'client',''),coalesce(item->>'phone',''),coalesce(item->>'address',''),
      coalesce(item->>'reference',''),nullif(item->>'courierId',''),
      coalesce(nullif(item->>'fee','')::numeric,0),coalesce(nullif(item->>'orderValue','')::numeric,0),
      coalesce(nullif(item->>'payment',''),'Dinheiro'),nullif(item->>'changeFor','')::numeric,
      coalesce(item->>'notes',''),
      case when item->>'status'='Em rota' then 'Aguardando' else coalesce(nullif(item->>'status',''),'Aguardando') end,
      nullif(item->>'paymentConfirmedAt','')::timestamptz,
      (item->>'createdAt')::timestamptz,
      coalesce(nullif(item->>'updatedAt','')::timestamptz,(item->>'createdAt')::timestamptz)
    );
    delivery_count := delivery_count + 1;
  end loop;

  select coalesce(max(code),0) into maximum_code
  from public.deliveries where user_id=current_user_id;

  begin
    requested_next := greatest(1,coalesce(nullif(p_settings->>'nextDeliveryCode','')::bigint,1));
  exception when others then
    requested_next := 1;
  end;

  insert into public.app_settings(user_id,store_name,default_fee,next_delivery_code)
  values(
    current_user_id,
    coalesce(nullif(btrim(p_settings->>'storeName'),''),'X-Burguer Entregas'),
    greatest(0,coalesce(nullif(p_settings->>'defaultFee','')::numeric,0)),
    greatest(maximum_code+1,requested_next,1)
  )
  on conflict(user_id) do update set
    store_name=excluded.store_name,
    default_fee=excluded.default_fee,
    next_delivery_code=excluded.next_delivery_code,
    updated_at=now();

  for item in select value from jsonb_array_elements(p_closings)
  loop
    if nullif(item->>'date','') is null then raise exception 'Backup possui fechamento sem data'; end if;
    closing_date := (item->>'date')::date;
    details := item->'detailsV2';
    snapshot := item->'deliverySnapshotV1';

    if details is null or snapshot is null or jsonb_typeof(snapshot) <> 'array' then
      perform public.xb_finalize_day(closing_date,false);
      closing_count := closing_count + 1;
      continue;
    end if;

    if not public.xb_closing_is_consistent(details,snapshot) then
      raise exception 'Fechamento % está inconsistente no backup',closing_date;
    end if;

    begin
      select count(*) into wrong_date_count
      from jsonb_array_elements(snapshot) x
      where nullif(x->>'createdAt','') is null
         or (((x->>'createdAt')::timestamptz at time zone 'America/Sao_Paulo')::date <> closing_date);
    exception when others then
      raise exception 'Fechamento % possui data inválida no snapshot',closing_date;
    end;

    if wrong_date_count > 0 then raise exception 'Fechamento % contém registro de outra data',closing_date; end if;

    insert into public.daily_closings(user_id,date,closed_at,reopened_at,details_v2,delivery_snapshot_v1,legacy_payload)
    values(
      current_user_id,closing_date,coalesce(nullif(item->>'closedAt','')::timestamptz,now()),
      null,details,snapshot,item
    );
    closing_count := closing_count + 1;
  end loop;

  return jsonb_build_object(
    'deliveries',delivery_count,'couriers',courier_count,'closings',closing_count,
    'nextDeliveryCode',greatest(maximum_code+1,requested_next,1)
  );
end;
$$;

revoke execute on function public.xb_restore_backup(jsonb,jsonb,jsonb,jsonb) from public;
grant execute on function public.xb_restore_backup(jsonb,jsonb,jsonb,jsonb) to authenticated;
