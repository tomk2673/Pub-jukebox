-- Extend playlist sources; keep legacy requests valid during the rolling release.
-- Patch only playlist validation in the installed settings RPC; preserve all other
-- profile, audio, network, authentication and permission behavior.
do $migration$
declare
  definition text := pg_get_functiondef('public.jukebox_settings_rpc(text,jsonb)'::regprocedure);
  old_sources text := $old$where item not in ('cz_funk','cz_oldies','cz_hiphop','karaoke')$old$;
  new_sources text := $new$where item not in ('world_hits','funk','hiphop','house','soul_blues','karaoke','cz_funk','cz_oldies','cz_hiphop')$new$;
begin
  if strpos(definition, old_sources) > 0 then
    definition := replace(definition, old_sources, new_sources);
  elsif strpos(definition, new_sources) = 0 then
    raise exception 'Unexpected jukebox settings playlist validation; review before changing it.';
  end if;
  if strpos(definition, 'jsonb_array_length(v_autodj_playlists) > 4') > 0 then
    definition := replace(definition, 'jsonb_array_length(v_autodj_playlists) > 4',
                                      'jsonb_array_length(v_autodj_playlists) > 6');
  elsif strpos(definition, 'jsonb_array_length(v_autodj_playlists) > 6') = 0 then
    raise exception 'Unexpected jukebox settings playlist limit; review before changing it.';
  end if;
  execute definition;
end;
$migration$;

create or replace function public.jukebox_continuation_rpc(action text, payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_source text;
  v_context jsonb;
  v_song jukebox_private.queue%rowtype;
  v_result jsonb;
  v_recent jsonb;
  v_completed bigint;
  v_prepared boolean;
  v_now bigint := floor(extract(epoch from clock_timestamp()));
begin
  payload := coalesce(payload, '{}'::jsonb);
  if not coalesce(jukebox_private.secret_ok(),false) then
    return jsonb_build_object('_error', 'Unauthorized', '_status', 401);
  end if;
  v_source := coalesce(payload->>'source_playlist', '');
  if v_source not in ('','world_hits','funk','hiphop','house','soul_blues','karaoke','cz_funk','cz_oldies','cz_hiphop')
     and (v_source !~ '^custom:[^[:cntrl:]]{2,100}$') then
    return jsonb_build_object('_error', 'Neplatný zdrojový playlist.', '_status', 422);
  end if;

  if action = 'add_song' then
    -- Delegate queue limits, ownership and active duplicates to the existing RPC.
    perform pg_advisory_xact_lock(2673);
    v_result := public.jukebox_rpc('add_song', payload);
    if v_result ? '_error' then return v_result; end if;
    update jukebox_private.queue set source_playlist=v_source
      where id=(v_result->>'id')::bigint;
    return v_result || jsonb_build_object('source_playlist',v_source);
  end if;

  if action in ('prepare','discard_stale') then
    -- Same playback lock as guest additions/transitions, then the existing AutoDJ lock.
    perform pg_advisory_xact_lock(2673);
    perform pg_advisory_xact_lock(2674);
  end if;

  select jsonb_build_object('id',q.id,'video_id',q.video_id,'title',q.title,
                           'artist',q.artist,'source_playlist',s.source)
    into v_context
    from jukebox_private.queue q
    cross join lateral (select case
      when q.source_playlist <> '' then q.source_playlist
      when q.requester_id = 'autodj' then case q.requested_by
        when 'AutoDJ · Celosvětové hity' then 'world_hits'
        when 'AutoDJ · Funk' then 'funk'
        when 'AutoDJ · Hip hop' then 'hiphop'
        when 'AutoDJ · House / Techno' then 'house'
        when 'AutoDJ · Retro Soul & Blues' then 'soul_blues'
        when 'AutoDJ · Český funk' then 'cz_funk'
        when 'AutoDJ · České oldies' then 'cz_oldies'
        when 'AutoDJ · Český hip-hop 90/00' then 'cz_hiphop'
        when 'AutoDJ · Karaoke s originálem' then 'karaoke'
        else '' end
      else '' end as source) s
    where s.source <> '' and
      (q.status='playing' or (q.status in ('done','removed') and q.started_at is not null))
    order by case when q.status='playing' then 0 else 1 end,
             coalesce(q.finished_at,q.started_at,q.created_at) desc,q.id desc limit 1;

  if action = 'status' then
    select * into v_song from jukebox_private.queue
      where status='queued' and requester_id='autodj' order by id limit 1;
    v_prepared := found;
    select count(*) into v_completed from jukebox_private.queue
      where status='done' and requester_id='autodj';
    select coalesce(jsonb_agg(h.video_id order by h.last_id desc),'[]'::jsonb) into v_recent
      from (select video_id,max(id) as last_id from jukebox_private.queue
            where status in ('playing','queued','done') or
              (status='removed' and (started_at is not null or requester_id='autodj'))
            group by video_id) h;
    return jsonb_build_object('prepared',v_prepared,'completed',v_completed,
      'song',case when v_prepared then (to_jsonb(v_song)-'requester_id') || jsonb_build_object('is_autodj',true) else null end,
      'recent_video_ids',v_recent,'continuation',v_context);
  end if;

  if action in ('prepare','discard_stale') then
    if payload->>'continuation_id' is not null and
       (payload->>'continuation_id')::bigint <> coalesce((v_context->>'id')::bigint,0) then
      return jsonb_build_object('prepared',false,'reason','stale');
    end if;
    select * into v_song from jukebox_private.queue
      where status='queued' and requester_id='autodj' order by id limit 1;
    if found and v_song.id <> coalesce((payload->>'replace_song_id')::bigint,0) and (v_source='' or v_song.source_playlist=v_source or
       (v_song.source_playlist='' and v_song.requested_by='AutoDJ · ' || case v_source
         when 'world_hits' then 'Celosvětové hity' when 'funk' then 'Funk'
         when 'hiphop' then 'Hip hop' when 'house' then 'House / Techno'
         when 'soul_blues' then 'Retro Soul & Blues' when 'cz_funk' then 'Český funk'
         when 'cz_oldies' then 'České oldies' when 'cz_hiphop' then 'Český hip-hop 90/00'
         when 'karaoke' then 'Karaoke s originálem' else '' end)) then
      return jsonb_build_object('prepared',true,'existing',true,
        'song',(to_jsonb(v_song)-'requester_id') || jsonb_build_object('is_autodj',true));
    end if;
    if action = 'prepare' then
      if coalesce(payload->>'video_id','') !~ '^[A-Za-z0-9_-]{11}$' or
         btrim(coalesce(payload->>'title',''))='' then
        return jsonb_build_object('_error','Neplatná AutoDJ skladba.','_status',422);
      end if;
      if exists(select 1 from jukebox_private.queue where video_id=payload->>'video_id' and
          (status in ('playing','queued','done') or
           (status='removed' and (started_at is not null or requester_id='autodj')))) then
        return jsonb_build_object('prepared',false,'reason','recent');
      end if;
    end if;
    if v_song.id is not null then
      update jukebox_private.queue set status='removed',finished_at=v_now where id=v_song.id;
    end if;
    if action = 'discard_stale' then return jsonb_build_object('ok',true); end if;
    v_result := public.jukebox_autodj_rpc('prepare',payload);
    if coalesce((v_result->>'prepared')::boolean,false) and not coalesce((v_result->>'existing')::boolean,false) then
      update jukebox_private.queue set source_playlist=v_source
        where id=(v_result->'song'->>'id')::bigint;
      v_result := jsonb_set(v_result,'{song,source_playlist}',to_jsonb(v_source));
    end if;
    return v_result;
  end if;
  return jsonb_build_object('_error','Neplatná operace pokračování.','_status',400);
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('_error','Neplatná data pokračování.','_status',422);
end;
$$;

revoke all on function public.jukebox_continuation_rpc(text,jsonb) from public,anon,authenticated;
grant execute on function public.jukebox_continuation_rpc(text,jsonb) to anon,service_role;
