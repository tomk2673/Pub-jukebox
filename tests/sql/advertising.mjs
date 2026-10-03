import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
const stamp = Math.floor(Date.now() / 1000);
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema jukebox_private;
    grant usage on schema jukebox_private to anon, service_role;
    create function jukebox_private.secret_ok() returns boolean language sql stable as $$
      select coalesce(current_setting('request.headers', true), '{}')::jsonb->>'x-jukebox-secret' = 'test-only'
    $$;
  `);
  const source = fs.readFileSync(new URL('../../supabase/migrations/20261003235000_add_sponsor_campaigns.sql', import.meta.url), 'utf8');
  await db.exec(source);
  await db.exec(source); // Reapplying an additive migration must preserve campaigns.
  const rpc = async (action, payload = {}, venue_key = 'bar-a') => (await db.query(
    'select public.jukebox_ads_rpc($1, $2::jsonb) as result', [action, JSON.stringify({venue_key, ...payload})],
  )).rows[0].result;
  const create = id => rpc('create', {id, campaign: {sponsor: 'Test', headline: 'Test offer', body: 'Test campaign only', cta: 'Open offer', target_url: 'https://example.com/', starts_at: stamp - 60, ends_at: stamp + 86400}});
  const first = 'a'.repeat(32), second = 'b'.repeat(32), nonce = 'c'.repeat(32);
  await db.exec(`set role anon; set request.headers = '{}';`);
  assert.equal((await rpc('list'))._status, 401);
  assert.equal((await db.query('select * from jukebox_private.ad_campaigns')).rows.length, 0);
  await assert.rejects(create(first).then(result => { if (result._status === 401) throw new Error('Unauthorized'); }), /Unauthorized/);
  await db.exec(`set request.headers = '{"x-jukebox-secret":"test-only"}';`);
  assert.deepEqual(await rpc('list'), []);
  await create(first);
  assert.equal(await rpc('current'), null, 'draft hidden by default');
  assert.equal((await rpc('activate', {id: first}, 'bar-b'))._status, 404, 'cross-venue mutation blocked');
  assert.deepEqual(await rpc('activate', {id: first}), {ok: true});
  assert.equal((await rpc('current')).id, first);
  assert.equal(await rpc('current', {}, 'bar-b'), null);
  const event = {id: first, nonce, expires_at: stamp + 300, kind: 'click'};
  assert.deepEqual(await rpc('event', event), {ok: true, counted: true});
  assert.deepEqual(await rpc('event', event), {ok: true, counted: false});
  assert.deepEqual(await rpc('event', {...event, kind: 'impression'}), {ok: true, counted: false});
  let stats = (await rpc('list'))[0];
  assert.equal(stats.impressions, 1); assert.equal(stats.clicks, 1);
  assert.equal((await rpc('event', {...event, nonce: 'd'.repeat(32), expires_at: stamp - 1})).counted, false);
  assert.equal((await rpc('event', {...event, expires_at: 'invalid'}))._status, 422);
  assert.equal((await rpc('event', {...event, kind: 'reward'}))._status, 422);
  assert.equal((await rpc('event', {...event, nonce: 'bad'}))._status, 422);
  await create(second); await rpc('activate', {id: second});
  assert.equal((await rpc('current')).id, second);
  assert.equal((await rpc('list')).filter(row => row.active).length, 1);
  assert.equal((await rpc('event', {...event, nonce: 'e'.repeat(32)})).counted, false, 'paused campaigns cannot gain impressions');
  await rpc('pause', {id: second});
  assert.equal(await rpc('current'), null);
  // Counters and idempotency receipt must roll back together on any write failure.
  await rpc('activate', {id: second});
  await db.exec(`reset role;
    create function jukebox_private.fail_ad_counter() returns trigger language plpgsql as $$ begin raise exception 'test counter failure'; end $$;
    create trigger fail_counter before update on jukebox_private.ad_campaigns for each row execute function jukebox_private.fail_ad_counter();
    set role anon;`);
  const secondEvent = {...event, id: second};
  await assert.rejects(rpc('event', secondEvent), /test counter failure/);
  await db.exec(`reset role; drop trigger fail_counter on jukebox_private.ad_campaigns; set role anon;`);
  assert.deepEqual(await rpc('event', secondEvent), {ok: true, counted: true}, 'failed event remains retryable');
  await db.exec(`set request.headers = '{}';`);
  assert.equal((await db.query('select * from jukebox_private.ad_receipts')).rows.length, 0, 'RLS protects receipts without secret');
  assert.equal((await rpc('pause', {id: second}))._status, 401);
  await db.exec('reset role;');
  const access = (await db.query(`select prosecdef, has_function_privilege('authenticated', oid, 'execute') as authenticated_access from pg_proc where proname='jukebox_ads_rpc'`)).rows[0];
  assert.equal(access.prosecdef, false); assert.equal(access.authenticated_access, false);
  console.log('PostgreSQL advertising: RLS, secret, venue isolation, drafts, activation, deduplication and rollback verified.');
} finally { await db.close(); }
