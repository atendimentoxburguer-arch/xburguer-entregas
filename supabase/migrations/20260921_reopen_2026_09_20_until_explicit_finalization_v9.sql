-- O fechamento de 20/09/2026 foi criado automaticamente após a meia-noite
-- pelo fluxo antigo de recuperação. O usuário não havia finalizado esse dia.
-- Remove apenas esse fechamento para manter 20/09 operacionalmente aberto.
delete from public.daily_closings
where date = date '2026-09-20';
