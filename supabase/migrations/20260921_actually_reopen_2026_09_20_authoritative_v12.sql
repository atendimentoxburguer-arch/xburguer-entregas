-- A trigger de escrita autoritativa protege daily_closings e cancela DELETEs
-- sem o sinal interno. Este DELETE usa o mesmo sinal reservado ao fluxo oficial.
select set_config('xburguer.closing_write','1',true);

delete from public.daily_closings
where date = date '2026-09-20';
