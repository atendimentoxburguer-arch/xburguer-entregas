-- X-Burguer Entregas — esquema inicial para Supabase
-- Execute este arquivo em um projeto Supabase antes de ativar a sincronização no aplicativo.

begin;

create table if not exists public.app_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  store_name text not null default 'X-Burguer Entregas',
  default_fee numeric(10,2) not null default 0 check (default_fee >= 0),
  next_delivery_code bigint not null default 1 check (next_delivery_code > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.couriers (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  name text not null,
  phone text not null default '',
  fee numeric(10,2) not null default 0 check (fee >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.deliveries (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  code bigint not null check (code > 0),
  client text not null default '',
  phone text not null default '',
  address text not null default '',
  reference text not null default '',
  courier_id text null,
  fee numeric(10,2) not null default 0 check (fee >= 0),
  order_value numeric(12,2) not null default 0 check (order_value >= 0),
  payment text not null check (payment in ('Dinheiro','PIX','Cartão','Pago online')),
  change_for numeric(12,2) null check (change_for is null or change_for >= 0),
  notes text not null default '',
  status text not null default 'Aguardando' check (status in ('Aguardando','Entregue','Cancelada')),
  payment_confirmed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, code)
);

-- courier_id é mantido como referência histórica em texto de propósito.
-- Assim, remover/inativar um entregador não apaga nem bloqueia entregas antigas.

create table if not exists public.daily_closings (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  closed_at timestamptz null,
  reopened_at timestamptz null,
  details_v2 jsonb null,
  delivery_snapshot_v1 jsonb null,
  legacy_payload jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create index if not exists deliveries_user_created_idx
  on public.deliveries (user_id, created_at desc);
create index if not exists deliveries_user_status_idx
  on public.deliveries (user_id, status);
create index if not exists deliveries_user_courier_idx
  on public.deliveries (user_id, courier_id);

-- Mantém updated_at consistente sem depender do navegador.
create or replace function public.xb_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
before update on public.app_settings
for each row execute function public.xb_set_updated_at();

drop trigger if exists couriers_set_updated_at on public.couriers;
create trigger couriers_set_updated_at
before update on public.couriers
for each row execute function public.xb_set_updated_at();

drop trigger if exists deliveries_set_updated_at on public.deliveries;
create trigger deliveries_set_updated_at
before update on public.deliveries
for each row execute function public.xb_set_updated_at();

drop trigger if exists daily_closings_set_updated_at on public.daily_closings;
create trigger daily_closings_set_updated_at
before update on public.daily_closings
for each row execute function public.xb_set_updated_at();

-- Gera números de pedido de forma atômica para evitar duplicidade em vários aparelhos.
create or replace function public.xb_next_delivery_code()
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  next_code bigint;
begin
  if current_user_id is null then
    raise exception 'Usuário não autenticado';
  end if;

  insert into public.app_settings (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;

  update public.app_settings
     set next_delivery_code = next_delivery_code + 1
   where user_id = current_user_id
   returning next_delivery_code - 1 into next_code;

  return next_code;
end;
$$;

-- Row Level Security: cada usuário autenticado acessa apenas seus próprios dados.
alter table public.app_settings enable row level security;
alter table public.couriers enable row level security;
alter table public.deliveries enable row level security;
alter table public.daily_closings enable row level security;

drop policy if exists app_settings_owner_all on public.app_settings;
create policy app_settings_owner_all on public.app_settings
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists couriers_owner_all on public.couriers;
create policy couriers_owner_all on public.couriers
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists deliveries_owner_all on public.deliveries;
create policy deliveries_owner_all on public.deliveries
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists daily_closings_owner_all on public.daily_closings;
create policy daily_closings_owner_all on public.daily_closings
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select, insert, update, delete on public.app_settings to authenticated;
grant select, insert, update, delete on public.couriers to authenticated;
grant select, insert, update, delete on public.deliveries to authenticated;
grant select, insert, update, delete on public.daily_closings to authenticated;
grant execute on function public.xb_next_delivery_code() to authenticated;

-- Realtime para que alterações feitas em um aparelho apareçam automaticamente nos demais.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_settings'
  ) then
    alter publication supabase_realtime add table public.app_settings;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'couriers'
  ) then
    alter publication supabase_realtime add table public.couriers;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deliveries'
  ) then
    alter publication supabase_realtime add table public.deliveries;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daily_closings'
  ) then
    alter publication supabase_realtime add table public.daily_closings;
  end if;
end $$;

commit;
