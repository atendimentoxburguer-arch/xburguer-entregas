-- Garante que toda entrega persistida tenha valor positivo e endereço válido.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.deliveries'::regclass
      and conname='deliveries_order_value_positive'
  ) then
    alter table public.deliveries
      add constraint deliveries_order_value_positive
      check (order_value > 0)
      not valid;
    alter table public.deliveries validate constraint deliveries_order_value_positive;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.deliveries'::regclass
      and conname='deliveries_address_required'
  ) then
    alter table public.deliveries
      add constraint deliveries_address_required
      check (btrim(coalesce(address,'')) <> '')
      not valid;
    alter table public.deliveries validate constraint deliveries_address_required;
  end if;
end $$;
