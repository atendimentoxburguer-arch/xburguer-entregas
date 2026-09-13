-- Restrições declarativas adicionais para impedir inconsistências operacionais.
-- A primeira fica NOT VALID enquanto existir algum registro legado pendente com valor zero;
-- mesmo assim já é aplicada a todo INSERT/UPDATE novo.

alter table public.deliveries
  drop constraint if exists deliveries_positive_order_when_active;
alter table public.deliveries
  add constraint deliveries_positive_order_when_active
  check (status = 'Cancelada' or order_value > 0) not valid;

alter table public.deliveries
  drop constraint if exists deliveries_noncash_has_no_change;
alter table public.deliveries
  add constraint deliveries_noncash_has_no_change
  check (payment = 'Dinheiro' or change_for is null);

alter table public.deliveries
  drop constraint if exists deliveries_delivered_has_courier;
alter table public.deliveries
  add constraint deliveries_delivered_has_courier
  check (status <> 'Entregue' or courier_id is not null);

alter table public.deliveries
  drop constraint if exists deliveries_cash_change_covers_order;
alter table public.deliveries
  add constraint deliveries_cash_change_covers_order
  check (payment <> 'Dinheiro' or change_for is null or change_for >= order_value);
