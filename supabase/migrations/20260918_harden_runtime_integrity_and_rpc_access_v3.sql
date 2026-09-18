-- Revisão arquitetural 2026-09-18
-- Reforça integridade das entregas e limita RPCs críticos a usuários autenticados.

alter table public.deliveries
  validate constraint deliveries_positive_order_when_active;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deliveries'::regclass
      and conname = 'deliveries_courier_fk'
  ) then
    alter table public.deliveries
      add constraint deliveries_courier_fk
      foreign key (user_id, courier_id)
      references public.couriers(user_id, id)
      on update cascade
      on delete restrict
      not valid;
    alter table public.deliveries validate constraint deliveries_courier_fk;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deliveries'::regclass
      and conname = 'deliveries_online_requires_confirmation'
  ) then
    alter table public.deliveries
      add constraint deliveries_online_requires_confirmation
      check (payment <> 'Pago online' or payment_confirmed_at is not null)
      not valid;
    alter table public.deliveries validate constraint deliveries_online_requires_confirmation;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deliveries'::regclass
      and conname = 'deliveries_completed_requires_confirmation'
  ) then
    alter table public.deliveries
      add constraint deliveries_completed_requires_confirmation
      check (status <> 'Entregue' or payment_confirmed_at is not null)
      not valid;
    alter table public.deliveries validate constraint deliveries_completed_requires_confirmation;
  end if;
end $$;

revoke execute on function public.xb_next_delivery_code() from public;
revoke execute on function public.xb_finalize_day(date, boolean) from public;
revoke execute on function public.xb_reopen_day(date) from public;

grant execute on function public.xb_next_delivery_code() to authenticated;
grant execute on function public.xb_finalize_day(date, boolean) to authenticated;
grant execute on function public.xb_reopen_day(date) to authenticated;
