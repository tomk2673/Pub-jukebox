from concurrent.futures import ThreadPoolExecutor

import app as jukebox
from fastapi.testclient import TestClient
from test_app import VIDEO_A, VIDEO_B, VIDEO_C, add, join, make_client


def test_skip_requires_signed_guest_and_only_accepts_owner(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as owner:
        assert owner.post('/api/queue/1/skip').status_code == 401
        join(owner)
        first = add(owner, VIDEO_A, 'My song').json()
        waiting = add(owner, VIDEO_B, 'Waiting').json()
        with TestClient(jukebox.app) as stranger:
            join(stranger)
            # A posted requester ID cannot replace the signed cookie identity.
            with jukebox.connection() as conn:
                identity = conn.execute('SELECT requester_id FROM queue WHERE id=?', (first['id'],)).fetchone()[0]
            assert stranger.post(f"/api/queue/{first['id']}/skip", json={'requester_id': identity}).status_code == 404
        assert owner.post(f"/api/queue/{waiting['id']}/skip").status_code == 409
        assert owner.get('/api/queue').json()[0]['id'] == first['id']


def test_skip_advances_by_votes_and_repeated_taps_do_not_skip_successor(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as owner:
        join(owner)
        first = add(owner, VIDEO_A, 'Wrong song').json()
        second = add(owner, VIDEO_B, 'Earlier but fewer votes').json()
        third = add(owner, VIDEO_C, 'Most votes').json()
        with jukebox.connection() as conn:
            conn.execute('UPDATE queue SET votes=4 WHERE id=?', (third['id'],))
            before = conn.execute('SELECT revision FROM player_state WHERE id=1').fetchone()[0]
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: owner.post(f"/api/queue/{first['id']}/skip").json(), range(2)))
        assert sorted(r['idempotent'] for r in results) == [False, True]
        queue = owner.get('/api/queue').json()
        assert [s['id'] for s in queue] == [third['id'], second['id']]
        assert queue[0]['status'] == 'playing'
        with jukebox.connection() as conn:
            assert conn.execute('SELECT status FROM queue WHERE id=?', (first['id'],)).fetchone()[0] == 'removed'
            assert conn.execute('SELECT revision FROM player_state WHERE id=1').fetchone()[0] == before + 1


def test_stale_skip_after_song_ended_keeps_new_song(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as owner:
        join(owner)
        first = add(owner, VIDEO_A, 'Finished').json()
        second = add(owner, VIDEO_B, 'Already next').json()
        jukebox.advance_queue()
        response = owner.post(f"/api/queue/{first['id']}/skip")
        assert response.json() == {'ok': True, 'idempotent': True}
        assert owner.get('/api/queue').json()[0]['id'] == second['id']


def test_skip_last_song_allows_new_selection_and_leaves_autodj_to_player(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as owner:
        join(owner)
        first = add(owner, VIDEO_A, 'Wrong song').json()
        assert owner.post(f"/api/queue/{first['id']}/skip").status_code == 200
        assert owner.get('/api/queue').json() == []
        assert add(owner, VIDEO_B, 'New selection').json()['status'] == 'playing'


def test_skip_respects_bar_network_restriction(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as owner:
        join(owner)
        first = add(owner, VIDEO_A, 'My song').json()
        monkeypatch.setattr(jukebox, 'network_matches', lambda request: False)
        assert owner.post(f"/api/queue/{first['id']}/skip").status_code == 403


def test_cloud_skip_uses_verified_cookie_and_atomic_rpc(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as owner:
        join(owner)
        identity = jukebox.read_token(owner.cookies.get('jukebox_guest'), 'guest', 180 * 24 * 3600)
        calls = []
        monkeypatch.setattr(jukebox, 'USE_SUPABASE', True)
        monkeypatch.setattr(jukebox, 'network_matches', lambda request: True)
        def rpc(function, action, payload):
            calls.append((function, action, payload))
            return {'ok': True, 'idempotent': False}
        monkeypatch.setattr(jukebox, 'supabase_rpc', rpc)
        assert owner.post('/api/queue/42/skip', json={'requester_id': 'someone-else', 'next_song_id': 99}).status_code == 200
        assert calls == [('jukebox_guest_skip_rpc', 'skip', {'song_id': 42, 'requester_id': identity})]
