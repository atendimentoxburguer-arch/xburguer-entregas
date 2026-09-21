-- O corpo interno nunca deve ser chamado diretamente pela API.
-- O RPC explícito é o único ponto autorizado e valida auth.uid().
alter function public.xb_finalize_day_explicit(date, boolean)
  security definer
  set search_path = public;

revoke execute on function public.xb_finalize_day_internal(date, boolean) from public, anon, authenticated;
