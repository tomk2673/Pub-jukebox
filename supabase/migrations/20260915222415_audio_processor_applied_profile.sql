alter table jukebox_private.audio_processors add column if not exists applied_profile jsonb;

CREATE OR REPLACE FUNCTION public.jukebox_settings_rpc(action text, payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_now bigint := floor(extract(epoch from clock_timestamp()));
  v_key text;
  v_name text;
  v_mode text;
  v_menu text;
  v_transition_mode text;
  v_transition_volume integer;
  v_autodj_enabled boolean;
  v_autodj_playlists jsonb;
  v_autodj_custom text;
  v_audio_mode text;
  v_target_lufs integer;
  v_limiter double precision;
  v_bass integer;
  v_allowed_network cidr;
  v_profile jukebox_private.venue_settings%rowtype;
  v_processor jukebox_private.audio_processors%rowtype;
  v_measured double precision;
  v_gain double precision;
  v_bass_reduction double precision;
  v_limiter_reduction double precision;
begin
  payload := coalesce(payload, '{}'::jsonb);

  if not jukebox_private.secret_ok() then
    return jsonb_build_object('_error', 'Unauthorized', '_status', 401);
  end if;

  v_key := coalesce(payload->>'venue_key', '');
  if v_key !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    return jsonb_build_object('_error', 'Neplatný identifikátor provozovny.', '_status', 422);
  end if;

  insert into jukebox_private.venue_settings(venue_key, business_name, updated_at)
  values(v_key, 'PUB JUKEBOX', v_now)
  on conflict (venue_key) do nothing;

  if action = 'get' then
    select * into v_profile
    from jukebox_private.venue_settings
    where venue_key = v_key;
    return to_jsonb(v_profile);
  end if;

  if action = 'network_update' then
    if nullif(payload->>'allowed_network', '') is null then
      v_allowed_network := null;
    else
      v_allowed_network := (payload->>'allowed_network')::cidr;
      if (family(v_allowed_network) = 4 and masklen(v_allowed_network) <> 32)
         or (family(v_allowed_network) = 6 and masklen(v_allowed_network) <> 64) then
        return jsonb_build_object('_error', 'Neplatný rozsah sítě baru.', '_status', 422);
      end if;
    end if;

    update jukebox_private.venue_settings
    set allowed_network = v_allowed_network,
        revision = revision + 1,
        updated_at = v_now
    where venue_key = v_key
    returning * into v_profile;
    return to_jsonb(v_profile);
  end if;

  if action = 'processor_status' then
    select * into v_processor
    from jukebox_private.audio_processors
    where venue_key = v_key;
    if not found then
      return '{}'::jsonb;
    end if;
    return to_jsonb(v_processor);
  end if;

  if action = 'processor_heartbeat' then
    v_measured := nullif(payload->>'measured_lufs', '')::double precision;
    v_gain := coalesce((payload->>'gain_db')::double precision, 0);
    v_bass_reduction := coalesce((payload->>'bass_reduction_db')::double precision, 0);
    v_limiter_reduction := coalesce((payload->>'limiter_reduction_db')::double precision, 0);

    if (v_measured is not null and v_measured not between -100 and 12)
       or v_gain not between -24 and 24
       or v_bass_reduction not between 0 and 30
       or v_limiter_reduction not between 0 and 30 then
      return jsonb_build_object('_error', 'Neplatná telemetrie zvukového procesoru.', '_status', 422);
    end if;

    insert into jukebox_private.audio_processors(
      venue_key, device_name, extension_version, measured_lufs, gain_db,
      bass_reduction_db, limiter_reduction_db, last_seen, applied_profile
    )
    values(
      v_key,
      left(coalesce(payload->>'device_name', ''), 80),
      left(coalesce(payload->>'extension_version', ''), 24),
      v_measured,
      v_gain,
      v_bass_reduction,
      v_limiter_reduction,
      v_now,
      nullif(payload->'applied_profile', 'null'::jsonb)
    )
    on conflict (venue_key) do update set
      device_name = excluded.device_name,
      extension_version = excluded.extension_version,
      measured_lufs = excluded.measured_lufs,
      gain_db = excluded.gain_db,
      bass_reduction_db = excluded.bass_reduction_db,
      limiter_reduction_db = excluded.limiter_reduction_db,
      last_seen = excluded.last_seen,
      applied_profile = excluded.applied_profile
    returning * into v_processor;
    return to_jsonb(v_processor);
  end if;

  if action = 'update' then
    select * into v_profile
    from jukebox_private.venue_settings
    where venue_key = v_key
    for update;

    v_name := btrim(coalesce(payload->>'business_name', v_profile.business_name));
    v_mode := coalesce(payload->>'tv_mode', v_profile.tv_mode);
    v_menu := coalesce(payload->>'menu_text', v_profile.menu_text);
    v_transition_mode := coalesce(payload->>'transition_mode', v_profile.transition_mode);
    v_transition_volume := coalesce((payload->>'transition_volume')::integer, v_profile.transition_volume);
    v_autodj_enabled := coalesce((payload->>'autodj_enabled')::boolean, v_profile.autodj_enabled);
    v_autodj_playlists := coalesce(payload->'autodj_playlists', v_profile.autodj_playlists);
    v_autodj_custom := coalesce(payload->>'autodj_custom_queries', v_profile.autodj_custom_queries);
    v_audio_mode := coalesce(payload->>'audio_mode', v_profile.audio_mode);
    v_target_lufs := coalesce((payload->>'target_lufs')::integer, v_profile.target_lufs);
    v_limiter := coalesce((payload->>'limiter_ceiling_db')::double precision, v_profile.limiter_ceiling_db);
    v_bass := coalesce((payload->>'bass_guard_strength')::integer, v_profile.bass_guard_strength);

    if char_length(v_name) not between 2 and 80 then
      return jsonb_build_object('_error', 'Název podniku je příliš krátký.', '_status', 422);
    end if;
    if v_mode not in ('clip','dj','menu') then
      return jsonb_build_object('_error', 'Neplatný režim TV.', '_status', 422);
    end if;
    if char_length(v_menu) > 4000 then
      return jsonb_build_object('_error', 'Nápojová nabídka je příliš dlouhá.', '_status', 422);
    end if;
    if v_transition_mode not in ('none','scratch') or v_transition_volume not between 0 and 100 then
      return jsonb_build_object('_error', 'Neplatné nastavení přechodu.', '_status', 422);
    end if;
    if jsonb_typeof(v_autodj_playlists) <> 'array'
       or jsonb_array_length(v_autodj_playlists) > 4
       or exists (
         select 1 from jsonb_array_elements_text(v_autodj_playlists) item
         where item not in ('cz_funk','cz_oldies','cz_hiphop','karaoke')
       )
       or char_length(v_autodj_custom) > 1000
       or (v_autodj_enabled and jsonb_array_length(v_autodj_playlists) = 0 and btrim(v_autodj_custom) = '') then
      return jsonb_build_object('_error', 'Neplatné nastavení AutoDJ playlistů.', '_status', 422);
    end if;
    if v_audio_mode not in ('standard','bass_guard') then
      return jsonb_build_object('_error', 'Neplatný zvukový režim.', '_status', 422);
    end if;
    if v_target_lufs not between -24 and -8
       or v_limiter not between -6.0 and 0.0
       or v_bass not between 0 and 100 then
      return jsonb_build_object('_error', 'Neplatné nastavení zvukového procesoru.', '_status', 422);
    end if;

    update jukebox_private.venue_settings
    set business_name = v_name,
        tv_mode = v_mode,
        menu_text = v_menu,
        transition_mode = v_transition_mode,
        transition_volume = v_transition_volume,
        autodj_enabled = v_autodj_enabled,
        autodj_playlists = v_autodj_playlists,
        autodj_custom_queries = v_autodj_custom,
        audio_mode = v_audio_mode,
        target_lufs = v_target_lufs,
        limiter_ceiling_db = v_limiter,
        bass_guard_strength = v_bass,
        revision = revision + 1,
        updated_at = v_now
    where venue_key = v_key
    returning * into v_profile;

    return to_jsonb(v_profile);
  end if;

  return jsonb_build_object('_error', 'Neplatná operace profilu.', '_status', 400);
exception
  when invalid_text_representation then
    return jsonb_build_object('_error', 'Neplatná data nastavení.', '_status', 422);
end
$function$
;

