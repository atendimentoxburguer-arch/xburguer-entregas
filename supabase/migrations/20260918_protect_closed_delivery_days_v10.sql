-- Impede alterar ou apagar uma entrega de dia já finalizado.
-- O fechamento passa a ser uma fronteira de integridade: para corrigir, primeiro reabra o dia.

create or replace function public.xb_guard_delivery_closed_day()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  allow_internal text := coalesce(current_setting('xburguer.closing_write', true),'');
  current_user_id uuid := auth.uid();
  target_date date;
begin
  if allow_internal = '1' then
    if tg_op='INSERT' then return new; end if;
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if tg_op='INSERT' then
    if new.user_id is null then raise exception 'Usuário da entrega é obrigatório'; end if;
    if new.business_date is null then new.business_date := public.xb_get_active_business_date(); end if;
    target_date := new.business_date;
  else
    target_date := old.business_date;
    if tg_op='UPDATE' and new.business_date is distinct from old.business_date then
      raise exception 'O dia comercial da entrega não pode ser alterado. Reabra o dia e use o fluxo de correção.';
    end if;
  end if;

  if exists(
    select 1 from public.daily_closings c
    where c.user_id=coalesce(old.user_id,new.user_id) and c.date=target_date
  ) then
    raise exception 'O dia % já foi finalizado. Reabra o dia antes de alterar esta entrega.',target_date;
  end if;

  if current_user_id is not null and coalesce(old.user_id,new.user_id) <> current_user_id then
    raise exception 'A entrega pertence a outro usuário.';
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists xb_guard_delivery_closed_day_trg on public.deliveries;
create trigger xb_guard_delivery_closed_day_trg
before insert or update or delete on public.deliveries
for each row execute function public.xb_guard_delivery_closed_day();

revoke execute on function public.xb_guard_delivery_closed_day() from public,anon,authenticated;
