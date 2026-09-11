create or replace function public.jukebox_transition_rpc(
  action text,
  payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_song_id bigint;
  next_song_id bigint;
  playing jukebox_private.queue%rowtype;
  selected jukebox_private.queue%rowtype;
  finished_status text;
  stamp bigint := extract(epoch from clock_timestamp())::bigint;
begin
  if not jukebox_private.secret_ok() then
    return jsonb_build_object('_error', 'Unauthorized', '_status', 401);
  end if;
  if action <> 'transition' then
    return jsonb_build_object('_error', 'Unknown action', '_status', 400);
  end if;

  begin
    current_song_id := nullif(payload->>'current_song_id', '')::bigint;
    next_song_id := nullif(payload->>'next_song_id', '')::bigint;
  exception when invalid_text_representation then
    return jsonb_build_object('_error', 'Invalid song id', '_status', 422);
  end;
  if current_song_id is null or current_song_id <= 0 or (next_song_id is not null and next_song_id <= 0) then
    return jsonb_build_object('_error', 'Invalid song id', '_status', 422);
  end if;

  perform pg_advisory_xact_lock(2673);
  select * into playing
  from jukebox_private.queue
  where status = 'playing'
  order by id
  limit 1
  for update;

  if next_song_id is null then
    if playing.id is null then
      select status into finished_status from jukebox_private.queue where id = current_song_id;
      if finished_status in ('done', 'removed') then
        return jsonb_build_object('ok', true, 'song', null, 'idempotent', true);
      end if;
      return jsonb_build_object('_error', 'Current song changed', '_status', 409);
    end if;
    if playing.id <> current_song_id then
      return jsonb_build_object('_error', 'Current song changed', '_status', 409);
    end if;
    update jukebox_private.queue
      set status = 'done', finished_at = stamp
      where status = 'playing';
    update jukebox_private.player_state
      set revision = revision + 1, action = 'load', updated_at = stamp
      where id = 1;
    return jsonb_build_object('ok', true, 'song', null, 'idempotent', false);
  end if;

  select * into selected
  from jukebox_private.queue
  where id = next_song_id
  for update;
  if selected.id is not null and selected.status = 'playing' then
    return jsonb_build_object('ok', true, 'song', to_jsonb(selected), 'idempotent', true);
  end if;
  if playing.id is null or playing.id <> current_song_id then
    return jsonb_build_object('_error', 'Current song changed', '_status', 409);
  end if;
  if selected.id is null or selected.status <> 'queued' then
    return jsonb_build_object('_error', 'Next song is no longer queued', '_status', 409);
  end if;

  update jukebox_private.queue
    set status = 'done', finished_at = stamp
    where status = 'playing';
  update jukebox_private.queue
    set status = 'playing', started_at = stamp, finished_at = null
    where id = next_song_id
    returning * into selected;
  update jukebox_private.player_state
    set revision = revision + 1, action = 'load', updated_at = stamp
    where id = 1;

  return jsonb_build_object('ok', true, 'song', to_jsonb(selected), 'idempotent', false);
end;
$$;

revoke all on function public.jukebox_transition_rpc(text, jsonb) from public;
grant execute on function public.jukebox_transition_rpc(text, jsonb) to anon;
comment on function public.jukebox_transition_rpc(text, jsonb)
  is 'Atomically and idempotently commits the exact preloaded TV deck transition.';
