-- Dia comercial persistente e ciclo de vida seguro das entregas.

alter table public.app_settings add column if not exists active_business_date date;
alter table public.deliveries add column if not exists business_date date;
alter table public.delivery_tombstones add column if not exists payload jsonb;

update public.deliveries
set business_date = (created_at at time zone 'America/Sao_Paulo')::date
where business_date is null;

alter table public.deliveries alter column business_date set not null;

create index if not exists deliveries_user_business_date_idx
  on public.deliveries(user_id, business_date, created_at desc);

update public.app_settings s
set active_business_date = coalesce(
  (select min(d.business_date) from public.deliveries d
   where d.user_id=s.user_id and not exists (
     select 1 from public.daily_closings c where c.user_id=d.user_id and c.date=d.business_date
   )),
  greatest(
    (now() at time zone 'America/Sao_Paulo')::date,
    coalesce((select max(c.date)+1 from public.daily_closings c where c.user_id=s.user_id),
             (now() at time zone 'America/Sao_Paulo')::date)
  )
)
where active_business_date is null;

create or replace function public.xb_get_active_business_date()
returns date language plpgsql security invoker set search_path=''
as $$
declare
  current_user_id uuid := auth.uid();
  active_date date;
  open_date date;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if current_user_id is null then raise exception 'Usuário não autenticado'; end if;
  insert into public.app_settings(user_id,store_name,default_fee,next_delivery_code,active_business_date)
  values(current_user_id,'X-Burguer Entregas',0,1,today)
  on conflict(user_id) do nothing;

  select active_business_date into active_date
  from public.app_settings where user_id=current_user_id for update;

  select min(d.business_date) into open_date
  from public.deliveries d
  where d.user_id=current_user_id
    and not exists (select 1 from public.daily_closings c where c.user_id=d.user_id and c.date=d.business_date);

  if open_date is not null and (active_date is null or open_date < active_date) then active_date := open_date; end if;

  if active_date is null then
    active_date := greatest(today,coalesce((select max(c.date)+1 from public.daily_closings c where c.user_id=current_user_id),today));
  end if;

  if exists (select 1 from public.daily_closings c where c.user_id=current_user_id and c.date=active_date) then
    select min(d.business_date) into open_date
    from public.deliveries d
    where d.user_id=current_user_id
      and not exists (select 1 from public.daily_closings c where c.user_id=d.user_id and c.date=d.business_date);
    active_date := coalesce(open_date,greatest(today,active_date+1));
  end if;

  update public.app_settings set active_business_date=active_date,updated_at=now()
  where user_id=current_user_id;
  return active_date;
end;
$$;

create or replace function public.xb_create_delivery(
  p_id text,p_client text,p_phone text,p_address text,p_reference text,p_courier_id text,
  p_order_value numeric,p_payment text,p_change_for numeric,p_notes text
)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
  current_user_id uuid := auth.uid();
  active_date date;
  reserved_code bigint;
  courier_fee numeric(12,2);
  default_fee numeric(12,2);
  existing public.deliveries%rowtype;
begin
  if current_user_id is null then raise exception 'Usuário não autenticado'; end if;
  if nullif(btrim(coalesce(p_id,'')),'') is null then raise exception 'Identificador da entrega é obrigatório'; end if;
  if nullif(btrim(coalesce(p_address,'')),'') is null then raise exception 'Endereço da entrega é obrigatório'; end if;
  if round(coalesce(p_order_value,0),2) <= 0 then raise exception 'O valor do pedido deve ser maior que zero'; end if;
  if coalesce(p_payment,'') not in ('Dinheiro','PIX','Cartão','Pago online') then raise exception 'Forma de pagamento inválida'; end if;
  if p_payment='Dinheiro' and p_change_for is not null and round(p_change_for,2) < round(p_order_value,2) then
    raise exception 'O valor para troco não pode ser menor que o valor do pedido';
  end if;
  if p_payment<>'Dinheiro' and p_change_for is not null then raise exception 'Troco só pode ser informado para pagamento em dinheiro'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(current_user_id::text || ':delivery-create',0));

  select * into existing from public.deliveries where user_id=current_user_id and id=p_id for update;
  if found then
    return jsonb_build_object(
      'id',existing.id,'code',existing.code,'client',existing.client,'phone',existing.phone,'address',existing.address,
      'reference',existing.reference,'courierId',existing.courier_id,'fee',existing.fee,'orderValue',existing.order_value,
      'payment',existing.payment,'changeFor',existing.change_for,'notes',existing.notes,'status',existing.status,
      'paymentConfirmedAt',existing.payment_confirmed_at,'createdAt',existing.created_at,'updatedAt',existing.updated_at,
      'businessDate',existing.business_date
    );
  end if;

  if p_courier_id is not null then
    select c.fee into courier_fee from public.couriers c
    where c.user_id=current_user_id and c.id=p_courier_id and c.active=true;
    if not found then raise exception 'Entregador selecionado não está disponível'; end if;
  else
    select default_fee into default_fee from public.app_settings where user_id=current_user_id for update;
    courier_fee := coalesce(default_fee,0);
  end if;

  active_date := public.xb_get_active_business_date();

  select greatest(1,coalesce(max(code)+1,1),coalesce((select next_delivery_code from public.app_settings where user_id=current_user_id),1))
    into reserved_code
  from public.deliveries where user_id=current_user_id;

  insert into public.app_settings(user_id,next_delivery_code,active_business_date)
  values(current_user_id,reserved_code+1,active_date)
  on conflict(user_id) do update set
    next_delivery_code=greatest(public.app_settings.next_delivery_code,excluded.next_delivery_code),
    active_business_date=excluded.active_business_date,updated_at=now();

  insert into public.deliveries(
    user_id,id,code,client,phone,address,reference,courier_id,fee,order_value,payment,change_for,notes,
    status,payment_confirmed_at,created_at,updated_at,business_date
  )
  values(
    current_user_id,p_id,reserved_code,btrim(coalesce(p_client,'')),btrim(coalesce(p_phone,'')),btrim(p_address),
    btrim(coalesce(p_reference,'')),nullif(btrim(coalesce(p_courier_id,'')),''),
    round(coalesce(courier_fee,0),2),round(p_order_value,2),p_payment,
    case when p_payment='Dinheiro' then nullif(round(p_change_for,2),0) else null end,
    btrim(coalesce(p_notes,'')),'Aguardando',case when p_payment='Pago online' then now() else null end,
    now(),now(),active_date
  )
  returning * into existing;

  return jsonb_build_object(
    'id',existing.id,'code',existing.code,'client',existing.client,'phone',existing.phone,'address',existing.address,
    'reference',existing.reference,'courierId',existing.courier_id,'fee',existing.fee,'orderValue',existing.order_value,
    'payment',existing.payment,'changeFor',existing.change_for,'notes',existing.notes,'status',existing.status,
    'paymentConfirmedAt',existing.payment_confirmed_at,'createdAt',existing.created_at,'updatedAt',existing.updated_at,
    'businessDate',existing.business_date
  );
end;
$$;

create or replace function public.xb_finalize_day_internal(p_date date,p_allow_pending boolean default false)
returns jsonb language plpgsql set search_path='public'
as $$
declare
  current_user_id uuid := auth.uid();
  business_today date := (now() at time zone 'America/Sao_Paulo')::date;
  pending_count integer:=0; invalid_count integer:=0; final_count integer:=0;
  delivered_count integer:=0; cancelled_count integer:=0;
  total_order_value numeric(12,2):=0; total_fees numeric(12,2):=0; cancelled_fees numeric(12,2):=0;
  payments jsonb:='[]'::jsonb; couriers jsonb:='[]'::jsonb; snapshot jsonb:='[]'::jsonb;
  details jsonb; result jsonb; existing public.daily_closings%rowtype; next_business_date date;
begin
  if current_user_id is null then raise exception 'Usuário não autenticado'; end if;
  if p_date is null then raise exception 'Data do fechamento é obrigatória'; end if;
  if p_date > business_today then raise exception 'Não é possível fechar uma data futura'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(current_user_id::text || ':closing:' || p_date::text,0));
  select * into existing from public.daily_closings where user_id=current_user_id and date=p_date;

  if found and public.xb_closing_is_consistent(existing.details_v2,existing.delivery_snapshot_v1) then
    return jsonb_build_object('date',existing.date,'closedAt',existing.closed_at,'detailsV2',existing.details_v2,'deliverySnapshotV1',existing.delivery_snapshot_v1);
  end if;

  select count(*) filter(where status='Aguardando'),
         count(*) filter(where status in('Entregue','Cancelada')),
         count(*) filter(where status='Entregue'),
         count(*) filter(where status='Cancelada'),
         coalesce(round(sum(order_value) filter(where status='Entregue'),2),0),
         coalesce(round(sum(fee) filter(where status in('Entregue','Cancelada')),2),0),
         coalesce(round(sum(fee) filter(where status='Cancelada'),2),0),
         count(*) filter(where status='Entregue' and(order_value<=0 or courier_id is null or btrim(coalesce(address,''))=''))
  into pending_count,final_count,delivered_count,cancelled_count,total_order_value,total_fees,cancelled_fees,invalid_count
  from public.deliveries where user_id=current_user_id and business_date=p_date;

  if final_count=0 and pending_count=0 then raise exception 'Nenhuma entrega encontrada para esta data'; end if;
  if pending_count>0 and not p_allow_pending then raise exception 'Existem % entrega(s) pendente(s). Conclua ou cancele antes de fechar o dia.',pending_count; end if;
  if invalid_count>0 then raise exception 'Existem % entrega(s) concluída(s) com dados inválidos. Corrija antes de fechar o dia.',invalid_count; end if;

  select coalesce(jsonb_agg(jsonb_build_object('name',method,'count',item_count,'value',item_value) order by ord),'[]'::jsonb)
  into payments
  from(
    select methods.ord,methods.method,count(d.id)::integer item_count,coalesce(round(sum(d.order_value),2),0)::numeric(12,2) item_value
    from(values(1,'Dinheiro'::text),(2,'PIX'::text),(3,'Cartão'::text),(4,'Pago online'::text))methods(ord,method)
    left join public.deliveries d on d.user_id=current_user_id and d.business_date=p_date and d.status='Entregue' and d.payment=methods.method
    group by methods.ord,methods.method
  )p;

  select coalesce(jsonb_agg(jsonb_build_object('id',courier_key,'name',courier_name,'count',delivered_qty,'cancelled',cancelled_qty,'cancelledFees',cancelled_fee_value,'fees',fee_value) order by courier_name),'[]'::jsonb)
  into couriers
  from(
    select coalesce(d.courier_id,'__without_courier__') courier_key,coalesce(max(c.name),'Sem entregador definido') courier_name,
           count(*) filter(where d.status='Entregue')::integer delivered_qty,count(*) filter(where d.status='Cancelada')::integer cancelled_qty,
           coalesce(round(sum(d.fee) filter(where d.status='Cancelada'),2),0)::numeric(12,2) cancelled_fee_value,
           coalesce(round(sum(d.fee),2),0)::numeric(12,2) fee_value
    from public.deliveries d left join public.couriers c on c.user_id=d.user_id and c.id=d.courier_id
    where d.user_id=current_user_id and d.business_date=p_date and d.status in('Entregue','Cancelada')
    group by coalesce(d.courier_id,'__without_courier__')
  )q;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'code',d.code,'client',d.client,'phone',d.phone,'address',d.address,'reference',d.reference,
    'courierId',d.courier_id,'courierName',coalesce(c.name,'Sem entregador definido'),'fee',d.fee,'orderValue',d.order_value,
    'payment',d.payment,'changeFor',d.change_for,'notes',d.notes,'status',d.status,'createdAt',d.created_at,'updatedAt',d.updated_at,
    'paymentConfirmedAt',d.payment_confirmed_at,'businessDate',d.business_date
  ) order by d.created_at,d.code),'[]'::jsonb)
  into snapshot
  from public.deliveries d left join public.couriers c on c.user_id=d.user_id and c.id=d.courier_id
  where d.user_id=current_user_id and d.business_date=p_date and d.status in('Entregue','Cancelada');

  details:=jsonb_build_object('totalDeliveries',delivered_count,'totalOrderValue',total_order_value,'totalFees',total_fees,
    'cancelledDeliveries',cancelled_count,'cancelledFees',cancelled_fees,'pending',pending_count,'payments',payments,'couriers',couriers);

  perform set_config('xburguer.closing_write','1',true);
  insert into public.daily_closings(user_id,date,closed_at,reopened_at,details_v2,delivery_snapshot_v1,legacy_payload)
  values(current_user_id,p_date,coalesce(existing.closed_at,now()),null,details,snapshot,
    jsonb_build_object('date',p_date,'closedAt',coalesce(existing.closed_at,now()),'detailsV2',details,'deliverySnapshotV1',snapshot))
  on conflict(user_id,date) do update set
    closed_at=coalesce(public.daily_closings.closed_at,excluded.closed_at),reopened_at=null,
    details_v2=excluded.details_v2,delivery_snapshot_v1=excluded.delivery_snapshot_v1,legacy_payload=excluded.legacy_payload
  returning jsonb_build_object('date',date,'closedAt',closed_at,'detailsV2',details_v2,'deliverySnapshotV1',delivery_snapshot_v1) into result;

  select min(d.business_date) into next_business_date
  from public.deliveries d
  where d.user_id=current_user_id and not exists(
    select 1 from public.daily_closings c where c.user_id=d.user_id and c.date=d.business_date
  );
  if next_business_date is null then next_business_date:=greatest(business_today,p_date+1); end if;

  update public.app_settings set active_business_date=next_business_date,updated_at=now()
  where user_id=current_user_id;
  return result;
end;
$$;

create or replace function public.xb_finalize_day_explicit(p_date date,p_allow_pending boolean default false)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare current_user_id uuid:=auth.uid();
begin
  if current_user_id is null then raise exception 'Usuário não autenticado'; end if;
  return public.xb_finalize_day_internal(p_date,p_allow_pending);
end; $$;

create or replace function public.xb_reopen_day(p_date date)
returns boolean language plpgsql set search_path=''
as $$ declare current_user_id uuid:=auth.uid(); deleted_count integer;
begin
  if current_user_id is null then raise exception 'Usuário não autenticado'; end if;
  if p_date is null then raise exception 'Data do fechamento é obrigatória'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(current_user_id::text || ':' || p_date::text,0));
  perform set_config('xburguer.closing_write','1',true);
  delete from public.daily_closings where user_id=current_user_id and date=p_date;
  get diagnostics deleted_count=row_count;
  if deleted_count>0 then update public.app_settings set active_business_date=p_date,updated_at=now() where user_id=current_user_id; end if;
  return deleted_count>0;
end; $$;

create or replace function public.xb_delete_delivery(p_id text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare current_user_id uuid:=auth.uid(); deleted_row public.deliveries%rowtype; deleted_count integer:=0;
begin
  if current_user_id is null then raise exception 'Usuário não autenticado'; end if;
  if nullif(btrim(coalesce(p_id,'')),'') is null then raise exception 'Entrega inválida'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(current_user_id::text || ':delivery-delete:' || p_id,0));
  select * into deleted_row from public.deliveries where user_id=current_user_id and id=p_id for update;
  if found then
    insert into public.delivery_tombstones(user_id,delivery_id,code,payload,deleted_at)
    values(current_user_id,deleted_row.id,deleted_row.code,to_jsonb(deleted_row),now())
    on conflict(user_id,delivery_id) do update set code=excluded.code,payload=excluded.payload,deleted_at=excluded.deleted_at;
    delete from public.deliveries where user_id=current_user_id and id=p_id;
    get diagnostics deleted_count=row_count;
  end if;
  return jsonb_build_object('deleted',deleted_count>0,'deliveryId',p_id,'code',deleted_row.code,'recoverable',deleted_count>0);
end; $$;

create or replace function public.xb_list_deleted_deliveries()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare current_user_id uuid:=auth.uid(); result jsonb;
begin
  if current_user_id is null then raise exception 'Usuário não autenticado'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.delivery_id,'code',t.code,'deletedAt',t.deleted_at,'businessDate',t.payload->>'business_date',
    'client',coalesce(t.payload->>'client',''),'address',coalesce(t.payload->>'address',''),
    'orderValue',coalesce((t.payload->>'order_value')::numeric,0),'status',coalesce(t.payload->>'status','')
  ) order by t.deleted_at desc),'[]'::jsonb) into result
  from public.delivery_tombstones t where t.user_id=current_user_id;
  return result;
end; $$;

create or replace function public.xb_restore_deleted_delivery(p_id text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare current_user_id uuid:=auth.uid(); payload jsonb; target_date date; existing public.deliveries%rowtype;
begin
  if current_user_id is null then raise exception 'Usuário não autenticado'; end if;
  select t.payload into payload from public.delivery_tombstones t
  where t.user_id=current_user_id and t.delivery_id=p_id for update;
  if payload is null then raise exception 'Entrega excluída não encontrada na lixeira'; end if;
  target_date:=(payload->>'business_date')::date;
  if exists(select 1 from public.daily_closings c where c.user_id=current_user_id and c.date=target_date) then
    raise exception 'O dia desta entrega está finalizado. Reabra o dia antes de restaurar o pedido.';
  end if;
  insert into public.deliveries(
    user_id,id,code,client,phone,address,reference,courier_id,fee,order_value,payment,change_for,notes,
    status,payment_confirmed_at,created_at,updated_at,business_date
  )
  values(
    current_user_id,p_id,(payload->>'code')::bigint,coalesce(payload->>'client',''),coalesce(payload->>'phone',''),
    coalesce(payload->>'address',''),coalesce(payload->>'reference',''),nullif(payload->>'courier_id',''),
    coalesce((payload->>'fee')::numeric,0),coalesce((payload->>'order_value')::numeric,0),coalesce(payload->>'payment','Dinheiro'),
    nullif(payload->>'change_for','')::numeric,coalesce(payload->>'notes',''),coalesce(payload->>'status','Aguardando'),
    nullif(payload->>'payment_confirmed_at','')::timestamptz,(payload->>'created_at')::timestamptz,
    (payload->>'updated_at')::timestamptz,target_date
  );
  delete from public.delivery_tombstones where user_id=current_user_id and delivery_id=p_id;
  select * into existing from public.deliveries where user_id=current_user_id and id=p_id;
  return jsonb_build_object(
    'id',existing.id,'code',existing.code,'client',existing.client,'phone',existing.phone,'address',existing.address,
    'reference',existing.reference,'courierId',existing.courier_id,'fee',existing.fee,'orderValue',existing.order_value,
    'payment',existing.payment,'changeFor',existing.change_for,'notes',existing.notes,'status',existing.status,
    'paymentConfirmedAt',existing.payment_confirmed_at,'createdAt',existing.created_at,'updatedAt',existing.updated_at,
    'businessDate',existing.business_date
  );
end; $$;

revoke execute on function public.xb_get_active_business_date() from public,anon;
revoke execute on function public.xb_create_delivery(text,text,text,text,text,text,numeric,text,numeric,text) from public,anon;
revoke execute on function public.xb_list_deleted_deliveries() from public,anon;
revoke execute on function public.xb_restore_deleted_delivery(text) from public,anon;
revoke execute on function public.xb_delete_delivery(text) from public,anon;
revoke execute on function public.xb_finalize_day_explicit(date,boolean) from public,anon;
revoke execute on function public.xb_reopen_day(date) from public,anon;

grant execute on function public.xb_get_active_business_date() to authenticated;
grant execute on function public.xb_create_delivery(text,text,text,text,text,text,numeric,text,numeric,text) to authenticated;
grant execute on function public.xb_list_deleted_deliveries() to authenticated;
grant execute on function public.xb_restore_deleted_delivery(text) to authenticated;
grant execute on function public.xb_delete_delivery(text) to authenticated;
grant execute on function public.xb_finalize_day_explicit(date,boolean) to authenticated;
grant execute on function public.xb_reopen_day(date) to authenticated;
