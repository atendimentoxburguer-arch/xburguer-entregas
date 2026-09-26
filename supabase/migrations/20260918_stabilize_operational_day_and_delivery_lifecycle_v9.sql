-- Mantém o dia comercial aberto até a ação explícita de finalizar.
-- Entregas novas são criadas em uma transação no banco, preservadas entre meia-noite
-- e protegidas contra exclusão irreversível por meio da lixeira.

alter table public.app_settings add column if not exists active_business_date date;
alter table public.deliveries add column if not exists business_date date;
alter table public.delivery_tombstones add column if not exists payload jsonb;

update public.deliveries
set business_date = (created_at at time zone 'America/Sao_Paulo')::date
where business_date is null;

alter table public.deliveries alter column business_date set not null;

create index if not exists deliveries_user_business_date_idx
  on public.deliveries(user_id, business_date, created_at desc);

-- A implementação autoritativa está aplicada no projeto Supabase pela migration v9.
-- Este arquivo mantém a intenção registrada no repositório; o histórico SQL completo
-- está em 20260918_stabilize_operational_day_and_delivery_lifecycle_v9.sql.
