import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';

// A disposable PostgreSQL instance: this test never connects to the bar database.
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema jukebox_private;
    create function jukebox_private.secret_ok() returns boolean language sql stable as $$
      select coalesce(current_setting('request.headers', true), '{}')::jsonb->>'x-jukebox-secret' = 'test-only'
    $$;
    create table jukebox_private.queue (
      id bigint primary key, requester_id text not null, status text not null,
      priority integer not null default 0, votes integer not null default 0,
      started_at bigint, finished_at bigint
    );
    create table jukebox_private.player_state (
      id integer primary key, revision bigint not null default 0,
      action text not null default 'sync', updated_at bigint not null default 0
    );
    insert into jukebox_private.player_state(id) values(1);
    alter table jukebox_private.queue enable row level security;
    alter table jukebox_private.player_state enable row level security;
    create policy backend_queue on jukebox_private.queue to anon using(jukebox_private.secret_ok()) with check(jukebox_private.secret_ok());
    create policy backend_player on jukebox_private.player_state to anon using(jukebox_private.secret_ok()) with check(jukebox_private.secret_ok());
    grant usage on schema jukebox_private to anon;
    grant select, update on jukebox_private.queue, jukebox_private.player_state to anon;
  `);
  const migrations = new URL('../../supabase/migrations/', import.meta.url);
  const filename = fs.readdirSync(migrations).find(name => name.endsWith('_add_guest_skip_own_song.sql'));
  await db.exec(fs.readFileSync(new URL(filename, migrations), 'utf8'));
  const rpc = async (song_id, requester_id = 'guest-a') => (await db.query(
    'select public.jukebox_guest_skip_rpc($1, $2::jsonb) as result',
    ['skip', JSON.stringify({song_id, requester_id})],
  )).rows[0].result;
  const queue = async () => (await db.query('select id,status from jukebox_private.queue order by id')).rows;
  const player = async () => (await db.query('select revision,action from jukebox_private.player_state where id=1')).rows[0];
  await db.exec(`
    insert into jukebox_private.queue(id,requester_id,status,priority,votes) values
      (1,'guest-a','playing',0,0),(2,'autodj','queued',-100,100),
      (3,'guest-b','queued',0,0),(4,'guest-a','queued',0,4);
    set role anon;
    set request.headers = '{}';
  `);
  assert.equal((await rpc(1))._status, 401, 'missing backend secret rejected');
  await db.exec(`set request.headers = '{"x-jukebox-secret":"test-only"}';`);
  const original = await queue();
  assert.equal((await rpc(1, 'guest-b'))._status, 404, 'cannot skip another guest');
  assert.equal((await rpc(4))._status, 409, 'cannot skip a queued selection');
  assert.equal((await rpc(2, 'autodj'))._status, 401, 'AutoDJ is not a guest');
  assert.equal((await rpc('not-an-id'))._status, 422);
  assert.equal((await rpc('9999999999999999999999999'))._status, 422);
  assert.deepEqual(await queue(), original, 'rejected requests do not change playback');
  assert.deepEqual(await rpc(1), {ok: true, idempotent: false});
  assert.deepEqual(await queue(), [{id: 1, status: 'removed'}, {id: 2, status: 'queued'}, {id: 3, status: 'queued'}, {id: 4, status: 'playing'}]);
  assert.deepEqual(await player(), {revision: 1, action: 'load'});
  assert.deepEqual(await rpc(1), {ok: true, idempotent: true}, 'retry does not skip even the same owner’s next song');
  assert.equal((await rpc(1, 'guest-b'))._status, 404, 'terminal status does not bypass ownership');
  assert.deepEqual(await player(), {revision: 1, action: 'load'});

  await db.exec(`reset role; update jukebox_private.queue set status='done' where id=1; set role anon;`);
  assert.deepEqual(await rpc(1), {ok: true, idempotent: true}, 'natural completion makes late skip a no-op');
  await db.exec(`
    reset role;
    create function jukebox_private.fail_player_update() returns trigger language plpgsql as $$ begin raise exception 'test write failure'; end $$;
    create trigger fail_player before update on jukebox_private.player_state for each row execute function jukebox_private.fail_player_update();
    set role anon;
  `);
  const beforeFailure = await queue();
  await assert.rejects(rpc(4), /test write failure/);
  assert.deepEqual(await queue(), beforeFailure, 'failed player update rolls back the complete skip');
  await db.exec(`
    reset role;
    drop trigger fail_player on jukebox_private.player_state;
    delete from jukebox_private.queue;
    insert into jukebox_private.queue(id,requester_id,status) values(10,'guest-a','playing');
    set role anon;
  `);
  assert.deepEqual(await rpc(10), {ok: true, idempotent: false});
  assert.deepEqual(await queue(), [{id: 10, status: 'removed'}], 'empty queue leaves playback idle');
  await db.exec('reset role;');
  const flags = (await db.query(`select prosecdef, has_function_privilege('authenticated', oid, 'execute') as authenticated_access from pg_proc where proname='jukebox_guest_skip_rpc'`)).rows[0];
  assert.equal(flags.prosecdef, false);
  assert.equal(flags.authenticated_access, false);
  console.log('PostgreSQL guest skip: secret/RLS, ownership, ordering, stale retries, empty queue and atomic rollback verified.');
} finally { await db.close(); }
