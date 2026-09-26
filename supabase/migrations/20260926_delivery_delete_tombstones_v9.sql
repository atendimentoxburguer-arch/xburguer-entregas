-- Protege exclusões contra ressurreição por sincronização de outro aparelho.
-- O tombstone permanece mesmo depois da entrega ser fisicamente removida.

create table if not exists public.delivery_tombstones (
  user_id uuid not null references auth.users(id) on delete cascade,
  delivery_id text not null,
  code bigint,
  deleted_at timestamptz not null default now(),
  primary key (user_id, delivery_id)
);

alter table public.delivery_tombstones enable row level security;
revoke all on table public.delivery_tombstones from public, anon, authenticated;
grant select on table public.delivery_tombstones to authenticated;

drop policy if exists delivery_tombstones_owner_select on public.delivery_tombstones;
create policy delivery_tombstones_owner_select
on public.delivery_tombstones for select to authenticated
using ((select auth.uid()) = user_id);

create index if not exists delivery_tombstones_user_deleted_idx
on public.delivery_tombstones(user_id, deleted_at desc);

create or replace function public.xb_record_delivery_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.delivery_tombstones(user_id, delivery_id, code, deleted_at)
  values (old.user_id, old.id, old.code, pg_catalog.now())
  on conflict (user_id, delivery_id) do update
    set code = excluded.code, deleted_at = excluded.deleted_at;
  return old;
end;
$$;

revoke execute on function public.xb_record_delivery_delete() from public, anon, authenticated;

drop trigger if exists xb_delivery_delete_tombstone on public.deliveries;
create trigger xb_delivery_delete_tombstone
after delete on public.deliveries for each row
execute function public.xb_record_delivery_delete();

create or replace function public.xb_block_deleted_delivery_resurrection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('xburguer.restore_write', true), '') = '1' then
    return new;
  end if;
  if exists (
    select 1 from public.delivery_tombstones t
    where t.user_id = new.user_id and t.delivery_id = new.id
  ) then
    return null;
  end if;
  return new;
end;
$$;

revoke execute on function public.xb_block_deleted_delivery_resurrection() from public, anon, authenticated;

drop trigger if exists xb_delivery_block_deleted_resurrection on public.deliveries;
create trigger xb_delivery_block_deleted_resurrection
before insert or update on public.deliveries for each row
execute function public.xb_block_deleted_delivery_resurrection();

create or replace function public.xb_delete_delivery(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  deleted_code bigint;
  deleted_count integer := 0;
begin
  if current_user_id is null then raise exception 'Usuário não autenticado'; end if;
  if nullif(btrim(coalesce(p_id,'')),'') is null then raise exception 'Entrega inválida'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text || ':delivery-delete:' || p_id, 0)
  );

  select code into deleted_code
  from public.deliveries
  where user_id=current_user_id and id=p_id for update;

  if found then
    delete from public.deliveries where user_id=current_user_id and id=p_id;
    get diagnostics deleted_count = row_count;
  end if;

  if deleted_count=0 then
    select code into deleted_code
    from public.delivery_tombstones
    where user_id=current_user_id and delivery_id=p_id;
  end if;

  return jsonb_build_object('deleted',deleted_count>0,'deliveryId',p_id,'code',deleted_code);
end;
$$;

revoke execute on function public.xb_delete_delivery(text) from public, anon;
grant execute on function public.xb_delete_delivery(text) to authenticated;

-- A restauração é autoritativa e reabre somente os IDs presentes no backup.
create or replace function public.xb_restore_backup(
  p_settings jsonb, p_couriers jsonb, p_deliveries jsonb, p_closings jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  item jsonb; closing_date date; details jsonb; snapshot jsonb; wrong_date_count integer;
  delivery_count integer:=0; courier_count integer:=0; closing_count integer:=0;
  maximum_code bigint:=0; requested_next bigint:=1;
begin
  if current_user_id is null then raise exception 'Usuário não autenticado'; end if;
  if p_couriers is null or jsonb_typeof(p_couriers)<>'array'
     or p_deliveries is null or jsonb_typeof(p_deliveries)<>'array'
     or p_closings is null or jsonb_typeof(p_closings)<>'array' then
    raise exception 'Backup possui estrutura inválida';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(current_user_id::text || ':backup-restore',0));
  perform pg_catalog.set_config('xburguer.closing_write','1',true);
  perform pg_catalog.set_config('xburguer.restore_write','1',true);

  delete from public.daily_closings where user_id=current_user_id;
  delete from public.deliveries where user_id=current_user_id;

  delete from public.delivery_tombstones t
  where t.user_id=current_user_id
    and exists(select 1 from jsonb_array_elements(p_deliveries) x where x->>'id'=t.delivery_id);

  for item in select value from jsonb_array_elements(p_couriers) loop
    if btrim(coalesce(item->>'id',''))='' or btrim(coalesce(item->>'name',''))='' then
      raise exception 'Backup possui entregador sem ID ou nome';
    end if;
    insert into public.couriers(user_id,id,name,phone,fee,active,created_at,updated_at)
    values(current_user_id,item->>'id',item->>'name',coalesce(item->>'phone',''),
      coalesce(nullif(item->>'fee','')::numeric,0),coalesce(nullif(item->>'active','')::boolean,true),
      coalesce(nullif(item->>'createdAt','')::timestamptz,now()),
      coalesce(nullif(item->>'updatedAt','')::timestamptz,nullif(item->>'createdAt','')::timestamptz,now()));
    courier_count:=courier_count+1;
  end loop;

  for item in select value from jsonb_array_elements(p_deliveries) loop
    if btrim(coalesce(item->>'id',''))='' then raise exception 'Backup possui entrega sem ID'; end if;
    if nullif(item->>'createdAt','') is null then raise exception 'Backup possui entrega sem data de criação'; end if;
    insert into public.deliveries(
      user_id,id,code,client,phone,address,reference,courier_id,fee,order_value,payment,change_for,
      notes,status,payment_confirmed_at,created_at,updated_at
    ) values(
      current_user_id,item->>'id',(item->>'code')::bigint,coalesce(item->>'client',''),coalesce(item->>'phone',''),
      coalesce(item->>'address',''),coalesce(item->>'reference',''),nullif(item->>'courierId',''),
      coalesce(nullif(item->>'fee','')::numeric,0),coalesce(nullif(item->>'orderValue','')::numeric,0),
      coalesce(nullif(item->>'payment',''),'Dinheiro'),nullif(item->>'changeFor','')::numeric,coalesce(item->>'notes',''),
      case when item->>'status'='Em rota' then 'Aguardando' else coalesce(nullif(item->>'status',''),'Aguardando') end,
      nullif(item->>'paymentConfirmedAt','')::timestamptz,(item->>'createdAt')::timestamptz,
      coalesce(nullif(item->>'updatedAt','')::timestamptz,(item->>'createdAt')::timestamptz));
    delivery_count:=delivery_count+1;
  end loop;

  select coalesce(max(code),0) into maximum_code from public.deliveries where user_id=current_user_id;
  begin
    requested_next:=greatest(1,coalesce(nullif(p_settings->>'nextDeliveryCode','')::bigint,1));
  exception when others then requested_next:=1; end;

  insert into public.app_settings(user_id,store_name,default_fee,next_delivery_code)
  values(current_user_id,coalesce(nullif(btrim(p_settings->>'storeName'),''),'X-Burguer Entregas'),
    greatest(0,coalesce(nullif(p_settings->>'defaultFee','')::numeric,0)),greatest(maximum_code+1,requested_next,1))
  on conflict(user_id) do update set store_name=excluded.store_name,default_fee=excluded.default_fee,
    next_delivery_code=excluded.next_delivery_code,updated_at=now();

  for item in select value from jsonb_array_elements(p_closings) loop
    if nullif(item->>'date','') is null then raise exception 'Backup possui fechamento sem data'; end if;
    closing_date:=(item->>'date')::date; details:=item->'detailsV2'; snapshot:=item->'deliverySnapshotV1';
    if details is null or snapshot is null or jsonb_typeof(snapshot)<>'array' then
      raise exception 'Fechamento % não possui snapshot verificável',closing_date;
    end if;
    if not public.xb_closing_is_consistent(details,snapshot) then
      raise exception 'Fechamento % está inconsistente no backup',closing_date;
    end if;
    begin
      select count(*) into wrong_date_count from jsonb_array_elements(snapshot) x
      where nullif(x->>'createdAt','') is null
         or (((x->>'createdAt')::timestamptz at time zone 'America/Sao_Paulo')::date<>closing_date);
    exception when others then
      raise exception 'Fechamento % possui data inválida no snapshot',closing_date;
    end;
    if wrong_date_count>0 then raise exception 'Fechamento % contém registro de outra data',closing_date; end if;
    insert into public.daily_closings(user_id,date,closed_at,reopened_at,details_v2,delivery_snapshot_v1,legacy_payload)
    values(current_user_id,closing_date,coalesce(nullif(item->>'closedAt','')::timestamptz,now()),null,details,snapshot,item);
    closing_count:=closing_count+1;
  end loop;

  return jsonb_build_object('deliveries',delivery_count,'couriers',courier_count,'closings',closing_count,
    'nextDeliveryCode',greatest(maximum_code+1,requested_next,1));
end;
$$;

revoke execute on function public.xb_restore_backup(jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.xb_restore_backup(jsonb,jsonb,jsonb,jsonb) to authenticated;

-- Limpeza continua autoritativa; as exclusões geram tombstones automaticamente.
create or replace function public.xb_clear_operational_data()
returns jsonb language plpgsql set search_path='public'
as $$
declare current_user_id uuid:=auth.uid(); delivery_count integer:=0; closing_count integer:=0;
begin
  if current_user_id is null then raise exception 'Usuário não autenticado'; end if;
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':admin-clear',0));
  perform set_config('xburguer.closing_write','1',true);
  delete from public.daily_closings where user_id=current_user_id; get diagnostics closing_count=row_count;
  delete from public.deliveries where user_id=current_user_id; get diagnostics delivery_count=row_count;
  update public.app_settings set next_delivery_code=1 where user_id=current_user_id;
  return jsonb_build_object('deliveriesDeleted',delivery_count,'closingsDeleted',closing_count);
end;
$$;

revoke execute on function public.xb_clear_operational_data() from public, anon;
grant execute on function public.xb_clear_operational_data() to authenticated;
