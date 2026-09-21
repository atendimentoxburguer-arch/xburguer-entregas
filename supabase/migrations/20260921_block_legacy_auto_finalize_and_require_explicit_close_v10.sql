-- Protege a finalização do dia contra clientes antigos que ainda executavam
-- o RPC legado automaticamente após a meia-noite.
alter function public.xb_finalize_day(date, boolean) rename to xb_finalize_day_internal;

create or replace function public.xb_finalize_day(
  p_date date,
  p_allow_pending boolean default false
)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Finalização automática/legada bloqueada. Atualize o sistema e finalize o dia pelo botão Finalizar dia.';
end;
$$;

create or replace function public.xb_finalize_day_explicit(
  p_date date,
  p_allow_pending boolean default false
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Usuário não autenticado';
  end if;
  return public.xb_finalize_day_internal(p_date, p_allow_pending);
end;
$$;

revoke execute on function public.xb_finalize_day(date, boolean) from public, anon, authenticated;
grant execute on function public.xb_finalize_day(date, boolean) to authenticated;

revoke execute on function public.xb_finalize_day_internal(date, boolean) from public, anon;
grant execute on function public.xb_finalize_day_internal(date, boolean) to authenticated;

revoke execute on function public.xb_finalize_day_explicit(date, boolean) from public, anon;
grant execute on function public.xb_finalize_day_explicit(date, boolean) to authenticated;

-- O fechamento criado automaticamente em 21/09/2026 para 20/09 é removido
-- para que o dia permaneça aberto até uma ação explícita do usuário.
delete from public.daily_closings
where date = date '2026-09-20';
