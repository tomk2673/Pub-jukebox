-- Uses the existing backend secret and row policies; no new public write access.
create or replace function public.jukebox_guest_skip_rpc(action text, payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  song_id bigint;
  requester text := coalesce(payload->>'requester_id', '');
  song jukebox_private.queue%rowtype;
  next_id bigint;
  stamp bigint := floor(extract(epoch from clock_timestamp()));
begin
  if jukebox_private.secret_ok() is not true then
    return jsonb_build_object('_error', 'Unauthorized', '_status', 401);
  end if;
  if action is distinct from 'skip' then
    return jsonb_build_object('_error', 'Unknown action', '_status', 400);
  end if;
  if requester = '' or requester = 'autodj' then
    return jsonb_build_object('_error', 'Otevři jukebox přes QR kód v baru.', '_status', 401);
  end if;
  begin
    song_id := (payload->>'song_id')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('_error', 'Neplatná skladba.', '_status', 422);
  end;
  if song_id is null or song_id <= 0 then
    return jsonb_build_object('_error', 'Neplatná skladba.', '_status', 422);
  end if;

  -- Same lock as add, vote, admin controls and TV deck transitions.
  perform pg_advisory_xact_lock(2673);
  select * into song from jukebox_private.queue where id = song_id for update;
  if song.id is null or song.requester_id <> requester then
    return jsonb_build_object('_error', 'Přeskočit můžeš jen skladbu, kterou jsi přidal/a.', '_status', 404);
  end if;
  if song.status in ('done', 'removed') then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;
  if song.status <> 'playing' then
    return jsonb_build_object('_error', 'Tahle skladba ještě nehraje. Ve frontě ji můžeš zrušit.', '_status', 409);
  end if;

  update jukebox_private.queue set status = 'removed', finished_at = stamp where id = song_id;
  select id into next_id from jukebox_private.queue
    where status = 'queued' order by priority desc, votes desc, id asc limit 1 for update;
  if next_id is not null then
    update jukebox_private.queue
      set status = 'playing', started_at = stamp, finished_at = null where id = next_id;
  end if;
  update jukebox_private.player_state
    set revision = revision + 1, action = 'load', updated_at = stamp where id = 1;
  return jsonb_build_object('ok', true, 'idempotent', false);
end;
$function$;

revoke all on function public.jukebox_guest_skip_rpc(text, jsonb) from public, authenticated;
grant execute on function public.jukebox_guest_skip_rpc(text, jsonb) to anon, service_role;
comment on function public.jukebox_guest_skip_rpc(text, jsonb)
  is 'Backend-authenticated, owner-only skip of one playing song; retries never skip its successor.';
notify pgrst, 'reload schema';
