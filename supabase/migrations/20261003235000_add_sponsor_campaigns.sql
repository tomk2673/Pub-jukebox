-- Additive advertising storage; never reads or changes queue/player tables.
create table if not exists jukebox_private.ad_campaigns (
  id text primary key check (id ~ '^[a-f0-9]{32}$'),
  venue_key text not null,
  sponsor text not null check (length(sponsor) between 2 and 80),
  headline text not null check (length(headline) between 2 and 100),
  body text not null check (length(body) between 2 and 320),
  cta text not null check (length(cta) between 2 and 32),
  target_url text not null check (length(target_url) <= 500 and target_url like 'https://%'),
  starts_at bigint not null,
  ends_at bigint not null check (ends_at > starts_at),
  created_at bigint not null,
  active boolean not null default false,
  impressions bigint not null default 0,
  clicks bigint not null default 0
);
create unique index if not exists ad_one_active_per_venue
  on jukebox_private.ad_campaigns(venue_key) where active;
create table if not exists jukebox_private.ad_receipts (
  campaign_id text not null references jukebox_private.ad_campaigns(id),
  nonce text not null check (nonce ~ '^[a-f0-9]{32}$'),
  kind text not null check (kind in ('impression', 'click')),
  expires_at bigint not null,
  primary key (campaign_id, nonce, kind)
);
create index if not exists ad_receipts_expiry on jukebox_private.ad_receipts(expires_at);

alter table jukebox_private.ad_campaigns enable row level security;
alter table jukebox_private.ad_receipts enable row level security;
drop policy if exists ad_campaigns_backend on jukebox_private.ad_campaigns;
create policy ad_campaigns_backend on jukebox_private.ad_campaigns to anon, service_role
  using (jukebox_private.secret_ok()) with check (jukebox_private.secret_ok());
drop policy if exists ad_receipts_backend on jukebox_private.ad_receipts;
create policy ad_receipts_backend on jukebox_private.ad_receipts to anon, service_role
  using (jukebox_private.secret_ok()) with check (jukebox_private.secret_ok());
revoke all on jukebox_private.ad_campaigns, jukebox_private.ad_receipts from public, anon, authenticated;
grant select, insert, update on jukebox_private.ad_campaigns to anon, service_role;
grant select, insert, delete on jukebox_private.ad_receipts to anon, service_role;

create or replace function public.jukebox_ads_rpc(action text, payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  venue text := coalesce(payload->>'venue_key', '');
  campaign_id text := coalesce(payload->>'id', '');
  campaign jukebox_private.ad_campaigns%rowtype;
  data jsonb := payload->'campaign';
  result jsonb;
  stamp bigint := floor(extract(epoch from clock_timestamp()));
  expiry bigint;
  changed integer;
  counted boolean := false;
  event_kind text;
begin
  if jukebox_private.secret_ok() is not true then
    return jsonb_build_object('_error', 'Unauthorized', '_status', 401);
  end if;
  if venue !~ '^[a-z0-9-]{1,64}$' then
    return jsonb_build_object('_error', 'Invalid venue', '_status', 422);
  end if;
  if action = 'list' then
    select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into result from (
      select * from jukebox_private.ad_campaigns where venue_key=venue order by created_at desc,id desc limit 50
    ) c;
    return result;
  elsif action = 'current' then
    select to_jsonb(c) into result from jukebox_private.ad_campaigns c
      where venue_key=venue and active and starts_at<=stamp and ends_at>stamp;
    return coalesce(result, 'null'::jsonb);
  end if;
  if campaign_id !~ '^[a-f0-9]{32}$' then
    return jsonb_build_object('_error', 'Invalid campaign', '_status', 422);
  end if;
  if action = 'create' then
    insert into jukebox_private.ad_campaigns(id,venue_key,sponsor,headline,body,cta,target_url,starts_at,ends_at,created_at)
      values(campaign_id,venue,data->>'sponsor',data->>'headline',data->>'body',data->>'cta',data->>'target_url',
        (data->>'starts_at')::bigint,(data->>'ends_at')::bigint,stamp);
    return jsonb_build_object('ok', true, 'id', campaign_id);
  end if;
  -- Serialise campaign activation independently of music operations.
  perform pg_advisory_xact_lock(hashtextextended('jukebox-ads:' || venue, 0));
  select * into campaign from jukebox_private.ad_campaigns where id=campaign_id and venue_key=venue for update;
  if campaign.id is null then
    return jsonb_build_object('_error', 'Kampaň nebyla nalezena.', '_status', 404);
  end if;
  if action = 'activate' then
    if campaign.ends_at<=stamp then
      return jsonb_build_object('_error', 'Tahle kampaň už skončila.', '_status', 409);
    end if;
    update jukebox_private.ad_campaigns set active=false where venue_key=venue and active;
    update jukebox_private.ad_campaigns set active=true where id=campaign_id;
  elsif action = 'pause' then
    update jukebox_private.ad_campaigns set active=false where id=campaign_id;
  elsif action = 'event' then
    if coalesce(payload->>'kind', '') not in ('impression','click') or coalesce(payload->>'nonce', '') !~ '^[a-f0-9]{32}$' then
      return jsonb_build_object('_error', 'Invalid event', '_status', 422);
    end if;
    begin
      expiry := (payload->>'expires_at')::bigint;
    exception when invalid_text_representation or numeric_value_out_of_range then
      return jsonb_build_object('_error', 'Invalid expiry', '_status', 422);
    end;
    if expiry is null or expiry>stamp+3600 then
      return jsonb_build_object('_error', 'Invalid expiry', '_status', 422);
    end if;
    if not campaign.active or stamp<campaign.starts_at or stamp>=campaign.ends_at or expiry<=stamp then
      return jsonb_build_object('ok', true, 'counted', false);
    end if;
    delete from jukebox_private.ad_receipts where expires_at<=stamp;
    foreach event_kind in array (case when payload->>'kind'='click' then array['impression','click'] else array['impression'] end) loop
      insert into jukebox_private.ad_receipts(campaign_id,nonce,kind,expires_at)
        values(campaign_id,payload->>'nonce',event_kind,expiry) on conflict do nothing;
      get diagnostics changed = row_count;
      if changed=1 then
        update jukebox_private.ad_campaigns
          set impressions=impressions + case when event_kind='impression' then 1 else 0 end,
              clicks=clicks + case when event_kind='click' then 1 else 0 end
          where id=campaign_id;
        counted := true;
      end if;
    end loop;
    return jsonb_build_object('ok', true, 'counted', counted);
  else
    return jsonb_build_object('_error', 'Unknown action', '_status', 400);
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.jukebox_ads_rpc(text,jsonb) from public, authenticated;
grant execute on function public.jukebox_ads_rpc(text,jsonb) to anon, service_role;
notify pgrst, 'reload schema';
