-- X-Burguer Entregas — reforços de produção
-- Complementa schema.sql sem alterar os dados operacionais existentes.

begin;

-- Impede que qualquer atualização comum de app_settings faça a sequência de
-- pedidos voltar para trás. A sequência também nunca fica abaixo do maior
-- código já gravado + 1.
create or replace function public.xb_guard_delivery_sequence()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  minimum_next bigint;
begin
  minimum_next := coalesce(
    (select max(code) + 1 from public.deliveries where user_id = new.user_id),
    1
  );

  if tg_op = 'UPDATE' then
    minimum_next := greatest(minimum_next, old.next_delivery_code);
  end if;

  new.next_delivery_code := greatest(
    coalesce(new.next_delivery_code, 1),
    minimum_next
  );

  return new;
end;
$$;

drop trigger if exists app_settings_guard_delivery_sequence on public.app_settings;
create trigger app_settings_guard_delivery_sequence
before insert or update of next_delivery_code on public.app_settings
for each row execute function public.xb_guard_delivery_sequence();

-- Corrige preventivamente qualquer sequência antiga que esteja abaixo dos
-- pedidos já existentes.
update public.app_settings settings
set next_delivery_code = greatest(
  settings.next_delivery_code,
  coalesce(
    (select max(deliveries.code) + 1
       from public.deliveries deliveries
      where deliveries.user_id = settings.user_id),
    1
  )
);

commit;
