-- Operações administrativas autoritativas para limpeza e restauração de backup.
-- Evita que o navegador trate como concluída uma escrita de fechamento bloqueada pelo trigger.

create or replace function public.xb_clear_operational_data()
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  delivery_count integer := 0;
  closing_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'Usuário não autenticado';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':admin-clear', 0));
  perform set_config('xburguer.closing_write','1',true);

  delete from public.daily_closings where user_id = current_user_id;
  get diagnostics closing_count = row_count;

  delete from public.deliveries where user_id = current_user_id;
  get diagnostics delivery_count = row_count;

  update public.app_settings
     set next_delivery_code = 1
   where user_id = current_user_id;

  return jsonb_build_object(
    'deliveriesDeleted', delivery_count,
    'closingsDeleted', closing_count
  );
end;
$$;

create or replace function public.xb_import_closing(
  p_date date,
  p_closed_at timestamptz,
  p_details jsonb,
  p_snapshot jsonb
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Usuário não autenticado';
  end if;
  if p_date is null then
    raise exception 'Data do fechamento é obrigatória';
  end if;
  if p_details is null or p_snapshot is null then
    raise exception 'Dados do fechamento são obrigatórios';
  end if;
  if not public.xb_closing_is_consistent(p_details, p_snapshot) then
    raise exception 'Fechamento importado está inconsistente';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':' || p_date::text, 0));
  perform set_config('xburguer.closing_write','1',true);

  insert into public.daily_closings(
    user_id,date,closed_at,reopened_at,details_v2,delivery_snapshot_v1,legacy_payload
  )
  values(
    current_user_id,
    p_date,
    coalesce(p_closed_at, now()),
    null,
    p_details,
    p_snapshot,
    jsonb_build_object(
      'date',p_date,
      'closedAt',coalesce(p_closed_at,now()),
      'detailsV2',p_details,
      'deliverySnapshotV1',p_snapshot
    )
  )
  on conflict(user_id,date) do update set
    closed_at = excluded.closed_at,
    reopened_at = null,
    details_v2 = excluded.details_v2,
    delivery_snapshot_v1 = excluded.delivery_snapshot_v1,
    legacy_payload = excluded.legacy_payload;

  return true;
end;
$$;

revoke execute on function public.xb_clear_operational_data() from public;
revoke execute on function public.xb_import_closing(date,timestamptz,jsonb,jsonb) from public;
grant execute on function public.xb_clear_operational_data() to authenticated;
grant execute on function public.xb_import_closing(date,timestamptz,jsonb,jsonb) to authenticated;
