-- Restringe RPCs críticos a sessões autenticadas.
-- As funções também validam auth.uid(), mas removemos EXECUTE do papel anon por defesa em profundidade.

revoke execute on function public.xb_next_delivery_code() from public, anon;
revoke execute on function public.xb_finalize_day(date, boolean) from public, anon;
revoke execute on function public.xb_reopen_day(date) from public, anon;
revoke execute on function public.xb_clear_operational_data() from public, anon;
revoke execute on function public.xb_import_closing(date,timestamptz,jsonb,jsonb) from public, anon;
revoke execute on function public.xb_restore_backup(jsonb,jsonb,jsonb,jsonb) from public, anon;

grant execute on function public.xb_next_delivery_code() to authenticated;
grant execute on function public.xb_finalize_day(date, boolean) to authenticated;
grant execute on function public.xb_reopen_day(date) to authenticated;
grant execute on function public.xb_clear_operational_data() to authenticated;
grant execute on function public.xb_import_closing(date,timestamptz,jsonb,jsonb) to authenticated;
grant execute on function public.xb_restore_backup(jsonb,jsonb,jsonb,jsonb) to authenticated;
