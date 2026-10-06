-- Bring the cloud RPCs in line with SQLite without changing any queue rows.
-- Existing guest skip RPC and all unrelated actions remain available.
CREATE OR REPLACE FUNCTION public.jukebox_rpc(action text, payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_now bigint := floor(extract(epoch from clock_timestamp()));
  v_result jsonb;
  v_song jukebox_private.queue%rowtype;
  v_playing jukebox_private.queue%rowtype;
  v_next_id bigint;
  v_count integer;
  v_id bigint;
  v_status text;
  v_requester text;
  v_voter text;
  v_max_queue integer;
  v_max_guest integer;
  v_command text;
  v_volume integer;
  v_night boolean;
begin
  payload := coalesce(payload, '{}'::jsonb);

  if jukebox_private.secret_ok() is not true then
    return jsonb_build_object('_error', 'Unauthorized', '_status', 401);
  end if;

  if action = 'health' then
    return jsonb_build_object('status', 'ok', 'backend', 'supabase');
  end if;

  if action = 'queue_list' then
    v_voter := coalesce(payload->>'voter_id', '');
    select coalesce(
      jsonb_agg(
        (to_jsonb(q) - 'requester_id') ||
        jsonb_build_object(
          'voted_by_me',
          exists(
            select 1 from jukebox_private.votes v
            where v.queue_id = q.id and v.voter_id = v_voter
          ),
          'requested_by_me',
          (v_voter <> '' and q.requester_id = v_voter),
          'is_autodj', q.requester_id = 'autodj'
        )
        order by
          case when q.status = 'playing' then 0 else 1 end,
          q.priority desc,
          q.votes desc,
          q.id asc
      ),
      '[]'::jsonb
    )
    into v_result
    from jukebox_private.queue q
    where q.status in ('playing','queued');
    return v_result;
  end if;

  if action = 'add_song' then
    v_requester := coalesce(payload->>'requester_id', '');
    v_max_queue := greatest(5, least(200, coalesce((payload->>'max_queue')::integer, 50)));
    v_max_guest := greatest(1, least(20, coalesce((payload->>'max_guest')::integer, 3)));

    if v_requester = '' then
      return jsonb_build_object('_error', 'Otevři jukebox přes QR kód v baru.', '_status', 401);
    end if;
    if coalesce(payload->>'video_id', '') !~ '^[A-Za-z0-9_-]{11}$' then
      return jsonb_build_object('_error', 'Neplatné YouTube video.', '_status', 422);
    end if;
    if char_length(coalesce(payload->>'title', '')) not between 1 and 160 then
      return jsonb_build_object('_error', 'Chybí název skladby.', '_status', 422);
    end if;

    perform pg_advisory_xact_lock(2673);

    select count(*) into v_count
    from jukebox_private.queue
    where status in ('playing','queued');
    if v_count >= v_max_queue then
      return jsonb_build_object('_error', 'Fronta je teď plná.', '_status', 409);
    end if;

    select id into v_id
    from jukebox_private.queue
    where video_id = payload->>'video_id'
      and status in ('playing','queued')
    limit 1;
    if v_id is not null then
      return jsonb_build_object('_error', 'Tahle skladba už ve frontě je.', '_status', 409);
    end if;

    if v_requester <> 'admin' then
      select count(*) into v_count
      from jukebox_private.queue
      where requester_id = v_requester
        and status in ('playing','queued');
      if v_count >= v_max_guest then
        return jsonb_build_object(
          '_error',
          format('Máš už %s skladby ve frontě. Nech prostor i ostatním.', v_max_guest),
          '_status',
          429
        );
      end if;
    end if;

    begin
      insert into jukebox_private.queue(
        video_id, title, artist, thumbnail, requested_by, requester_id, created_at
      )
      values(
        payload->>'video_id',
        left(payload->>'title', 160),
        left(coalesce(payload->>'artist', ''), 100),
        left(coalesce(payload->>'thumbnail', ''), 500),
        left(coalesce(payload->>'requested_by', ''), 40),
        v_requester,
        v_now
      )
      returning * into v_song;
    exception when unique_violation then
      return jsonb_build_object('_error', 'Tahle skladba už ve frontě je.', '_status', 409);
    end;

    -- The same transaction and playback lock protects guest skip / TV transitions.
    -- A new request must not interrupt another guest or bypass an older guest.
    select * into v_playing from jukebox_private.queue
      where status = 'playing' limit 1 for update;
    if coalesce((payload->>'interrupt_autodj')::boolean, false)
       and v_requester <> 'autodj' and v_playing.requester_id = 'autodj' then
      update jukebox_private.queue
        set status = 'done', finished_at = v_now where id = v_playing.id;
      select id into v_next_id from jukebox_private.queue
        where status = 'queued' and requester_id <> 'autodj'
        order by priority desc, votes desc, id asc limit 1 for update;
      update jukebox_private.queue
        set status = 'playing', started_at = v_now, finished_at = null
        where id = v_next_id;
      update jukebox_private.player_state
        set revision = revision + 1, action = 'guest_takeover', updated_at = v_now
        where id = 1;
      select * into v_song from jukebox_private.queue where id = v_song.id;
    end if;

    return (to_jsonb(v_song) - 'requester_id') ||
      jsonb_build_object('requested_by_me', true, 'voted_by_me', false);
  end if;

  if action = 'vote' then
    v_voter := coalesce(payload->>'voter_id', '');
    v_id := (payload->>'song_id')::bigint;
    if v_voter = '' then
      return jsonb_build_object('_error', 'Otevři jukebox přes QR kód v baru.', '_status', 401);
    end if;

    perform pg_advisory_xact_lock(2673);
    if not exists(
      select 1 from jukebox_private.queue where id = v_id and status = 'queued'
    ) then
      return jsonb_build_object('_error', 'Skladba už není ve frontě.', '_status', 404);
    end if;

    insert into jukebox_private.votes(queue_id, voter_id, created_at)
    values(v_id, v_voter, v_now)
    on conflict(queue_id, voter_id) do nothing;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      return jsonb_build_object('_error', 'Pro tuhle skladbu už jsi hlasoval.', '_status', 409);
    end if;

    update jukebox_private.queue set votes = votes + 1 where id = v_id;
    return jsonb_build_object('ok', true);
  end if;

  if action = 'popular' then
    v_count := greatest(1, least(20, coalesce((payload->>'limit')::integer, 12)));
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'video_id', p.video_id,
          'title', p.title,
          'artist', p.artist,
          'thumbnail', p.thumbnail,
          'play_count', p.play_count
        )
        order by p.play_count desc, p.last_played desc
      ),
      '[]'::jsonb
    ) into v_result
    from (
      select video_id, max(title) as title, max(artist) as artist,
             max(thumbnail) as thumbnail, count(*) as play_count, max(id) as last_played
      from jukebox_private.queue
      where status = 'done' and requester_id <> 'autodj'
      group by video_id
      order by play_count desc, last_played desc
      limit v_count
    ) p;
    return v_result;
  end if;

  if action = 'guest_remove' then
    v_requester := coalesce(payload->>'requester_id', '');
    v_id := (payload->>'song_id')::bigint;
    if v_requester = '' or v_requester in ('admin', 'autodj') then
      return jsonb_build_object('_error', 'Otevři jukebox přes QR kód v baru.', '_status', 401);
    end if;

    perform pg_advisory_xact_lock(2673);
    update jukebox_private.queue
      set status = 'removed', finished_at = v_now
      where id = v_id
        and requester_id = v_requester
        and status = 'queued';
    get diagnostics v_count = row_count;
    if v_count = 0 then
      return jsonb_build_object(
        '_error',
        'Zrušit můžeš jen vlastní čekající skladbu.',
        '_status',
        404
      );
    end if;
    return jsonb_build_object('ok', true);
  end if;

  if action = 'priority_request' then
    v_requester := coalesce(payload->>'requester_id', '');
    v_id := (payload->>'song_id')::bigint;
    update jukebox_private.queue
      set priority_requested = true
      where id = v_id
        and requester_id = v_requester
        and status = 'queued'
        and priority = 0;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      return jsonb_build_object(
        '_error',
        'Přednost lze vyžádat jen pro vlastní skladbu ve frontě.',
        '_status',
        404
      );
    end if;
    return jsonb_build_object('ok', true);
  end if;

  if action = 'priority' then
    v_id := (payload->>'song_id')::bigint;
    update jukebox_private.queue
      set priority = priority + 1, priority_requested = false
      where id = v_id and status = 'queued';
    get diagnostics v_count = row_count;
    if v_count = 0 then
      return jsonb_build_object('_error', 'Skladba už není ve frontě.', '_status', 404);
    end if;
    update jukebox_private.player_state
      set revision = revision + 1, action = 'sync', updated_at = v_now
      where id = 1;
    return jsonb_build_object('ok', true);
  end if;

  if action = 'play' then
    v_id := (payload->>'song_id')::bigint;
    perform pg_advisory_xact_lock(2673);
    select status into v_status
    from jukebox_private.queue
    where id = v_id and status in ('queued','playing');
    if v_status is null then
      return jsonb_build_object('_error', 'Skladba už není ve frontě.', '_status', 404);
    end if;

    update jukebox_private.queue
      set status = 'queued', started_at = null
      where status = 'playing' and id <> v_id;
    update jukebox_private.queue
      set status = 'playing', started_at = v_now
      where id = v_id;
    update jukebox_private.player_state
      set revision = revision + 1, action = 'load', updated_at = v_now
      where id = 1;
    return jsonb_build_object('ok', true);
  end if;

  if action = 'remove' then
    v_id := (payload->>'song_id')::bigint;
    perform pg_advisory_xact_lock(2673);
    select status into v_status
    from jukebox_private.queue
    where id = v_id and status in ('queued','playing');
    if v_status is null then
      return jsonb_build_object('_error', 'Skladba už není ve frontě.', '_status', 404);
    end if;

    update jukebox_private.queue
      set status = 'removed', finished_at = v_now
      where id = v_id;

    if v_status = 'playing' then
      v_id := null;
      select id into v_id
      from jukebox_private.queue
      where status = 'queued'
      order by priority desc, votes desc, id asc
      limit 1;
      if v_id is not null then
        update jukebox_private.queue
          set status = 'playing', started_at = v_now
          where id = v_id;
      end if;
      update jukebox_private.player_state
        set revision = revision + 1, action = 'load', updated_at = v_now
        where id = 1;
    end if;
    return jsonb_build_object('ok', true);
  end if;

  if action = 'player_start' then
    perform pg_advisory_xact_lock(2673);
    select * into v_song
    from jukebox_private.queue
    where status = 'playing'
    limit 1;
    if found then
      return jsonb_build_object('ok', true, 'song', to_jsonb(v_song) - 'requester_id');
    end if;

    v_id := null;
    select id into v_id
    from jukebox_private.queue
    where status = 'queued'
    order by priority desc, votes desc, id asc
    limit 1;
    if v_id is not null then
      update jukebox_private.queue
        set status = 'playing', started_at = v_now
        where id = v_id
        returning * into v_song;
    end if;
    update jukebox_private.player_state
      set revision = revision + 1, action = 'load', updated_at = v_now
      where id = 1;
    return jsonb_build_object(
      'ok', true,
      'song', case when v_id is null then null else to_jsonb(v_song) - 'requester_id' end
    );
  end if;

  if action in ('player_next','player_ended') then
    perform pg_advisory_xact_lock(2673);
    update jukebox_private.queue
      set status = 'done', finished_at = v_now
      where status = 'playing';

    v_id := null;
    select id into v_id
    from jukebox_private.queue
    where status = 'queued'
    order by priority desc, votes desc, id asc
    limit 1;
    if v_id is not null then
      update jukebox_private.queue
        set status = 'playing', started_at = v_now
        where id = v_id
        returning * into v_song;
    end if;
    update jukebox_private.player_state
      set revision = revision + 1, action = 'load', updated_at = v_now
      where id = 1;
    return jsonb_build_object(
      'ok', true,
      'song', case when v_id is null then null else to_jsonb(v_song) - 'requester_id' end
    );
  end if;

  if action = 'player_state' then
    select
      to_jsonb(p) ||
      jsonb_build_object(
        'now_playing',
        (
          select (to_jsonb(q) - 'requester_id') ||
            jsonb_build_object('is_autodj', q.requester_id = 'autodj')
          from jukebox_private.queue q
          where q.status = 'playing'
          limit 1
        )
      )
    into v_result
    from jukebox_private.player_state p
    where p.id = 1;
    return v_result;
  end if;

  if action = 'player_control' then
    v_command := coalesce(payload->>'command', '');
    if v_command = 'volume' then
      v_volume := greatest(0, least(100, (payload->>'value')::integer));
      update jukebox_private.player_state
        set volume = v_volume, revision = revision + 1, action = 'volume', updated_at = v_now
        where id = 1;
    elsif v_command = 'night' then
      v_night := coalesce((payload->>'value')::boolean, false);
      update jukebox_private.player_state
        set night_mode = v_night, revision = revision + 1, action = 'night', updated_at = v_now
        where id = 1;
    elsif v_command in ('pause','resume') then
      update jukebox_private.player_state
        set revision = revision + 1, action = v_command, updated_at = v_now
        where id = 1;
    else
      return jsonb_build_object('_error', 'Neplatný příkaz přehrávače.', '_status', 422);
    end if;
    select to_jsonb(p) into v_result
    from jukebox_private.player_state p where p.id = 1;
    return v_result;
  end if;

  return jsonb_build_object('_error', 'Neplatná databázová operace.', '_status', 400);
exception
  when invalid_text_representation then
    return jsonb_build_object('_error', 'Neplatná data požadavku.', '_status', 422);
  when others then
    raise;
end
$function$;

CREATE OR REPLACE FUNCTION public.jukebox_autodj_rpc(action text, payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_now bigint := floor(extract(epoch from clock_timestamp()));
  v_song jukebox_private.queue%rowtype;
  v_completed bigint;
  v_recent jsonb;
  v_id bigint;
  v_removed integer;
  v_prepared boolean := false;
  v_video_id text;
  v_title text;
  v_artist text;
  v_thumbnail text;
  v_label text;
begin
  payload := coalesce(payload, '{}'::jsonb);
  if jukebox_private.secret_ok() is not true then
    return jsonb_build_object('_error', 'Unauthorized', '_status', 401);
  end if;

  if action = 'status' then
    select * into v_song
    from jukebox_private.queue
    where status = 'queued' and requester_id = 'autodj'
    order by id
    limit 1;
    v_prepared := found;

    select count(*) into v_completed
    from jukebox_private.queue
    where status = 'done' and requester_id = 'autodj';

    select coalesce(jsonb_agg(recent.video_id order by recent.id desc), '[]'::jsonb)
    into v_recent
    from (
      select video_id, max(id) as id
      from jukebox_private.queue
      where requester_id = 'autodj' and status in ('playing','queued','done')
      group by video_id
    ) recent;

    return jsonb_build_object(
      'prepared', v_prepared,
      'song', case when v_prepared then to_jsonb(v_song) - 'requester_id' else null end,
      'completed', v_completed,
      'recent_video_ids', v_recent
    );
  end if;

  if action = 'clear' then
    update jukebox_private.queue
    set status = 'removed', finished_at = v_now
    where status = 'queued' and requester_id = 'autodj';
    get diagnostics v_removed = row_count;
    return jsonb_build_object('ok', true, 'removed', v_removed);
  end if;

  if action = 'prepare' then
    v_video_id := coalesce(payload->>'video_id', '');
    v_title := left(btrim(coalesce(payload->>'title', '')), 160);
    v_artist := left(btrim(coalesce(payload->>'artist', '')), 100);
    v_thumbnail := left(coalesce(payload->>'thumbnail', ''), 500);
    v_label := left(btrim(coalesce(payload->>'playlist_label', 'AutoDJ')), 26);

    if v_video_id !~ '^[A-Za-z0-9_-]{11}$' or v_title = '' then
      return jsonb_build_object('_error', 'Neplatná AutoDJ skladba.', '_status', 422);
    end if;

    perform pg_advisory_xact_lock(2673);

    select * into v_song
    from jukebox_private.queue
    where status = 'queued' and requester_id = 'autodj'
    order by id
    limit 1;
    if found then
      return jsonb_build_object(
        'prepared', true,
        'existing', true,
        'song', to_jsonb(v_song) - 'requester_id'
      );
    end if;

    select id into v_id from jukebox_private.queue
    where video_id = v_video_id and (
      status in ('playing','queued')
      or (requester_id = 'autodj' and status = 'done')
    )
    limit 1;
    if v_id is not null then
      return jsonb_build_object('prepared', false, 'reason', 'recent');
    end if;

    insert into jukebox_private.queue(
      video_id, title, artist, thumbnail, requested_by, requester_id,
      votes, priority, priority_requested, status, created_at
    )
    values(
      v_video_id, v_title, v_artist, v_thumbnail,
      left('AutoDJ · ' || v_label, 40), 'autodj',
      0, -100, false, 'queued', v_now
    )
    returning * into v_song;

    return jsonb_build_object(
      'prepared', true,
      'existing', false,
      'song', to_jsonb(v_song) - 'requester_id'
    );
  end if;

  return jsonb_build_object('_error', 'Neplatná AutoDJ operace.', '_status', 400);
exception
  when invalid_text_representation then
    return jsonb_build_object('_error', 'Neplatná AutoDJ data.', '_status', 422);
end
$function$;

revoke all on function public.jukebox_rpc(text, jsonb) from public, authenticated;
grant execute on function public.jukebox_rpc(text, jsonb) to anon, service_role;
revoke all on function public.jukebox_autodj_rpc(text, jsonb) from public, authenticated;
grant execute on function public.jukebox_autodj_rpc(text, jsonb) to anon, service_role;
notify pgrst, 'reload schema';
