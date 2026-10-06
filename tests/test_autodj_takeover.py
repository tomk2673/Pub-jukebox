from concurrent.futures import ThreadPoolExecutor

import app as jukebox
from test_app import VIDEO_A, VIDEO_B, VIDEO_C, add, join, login, make_client


def seed_auto():
    with jukebox.connection() as conn:
        conn.execute(
            "INSERT INTO queue(video_id,title,requested_by,requester_id,priority,status,created_at) "
            "VALUES(?, 'Auto', 'AutoDJ · Funk', 'autodj', -100, 'playing', ?)",
            (VIDEO_C, jukebox.now()),
        )


def test_concurrent_guests_only_interrupt_autodj_once(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        join(client)
        seed_auto()
        with ThreadPoolExecutor(max_workers=2) as pool:
            songs = list(pool.map(lambda video: add(client, video, 'Guest').json(), [VIDEO_A, VIDEO_B]))
        assert sorted(song['status'] for song in songs) == ['playing', 'queued']
        with jukebox.connection() as conn:
            assert conn.execute("SELECT COUNT(*) FROM queue WHERE status='playing'").fetchone()[0] == 1
            assert conn.execute("SELECT revision FROM player_state WHERE id=1").fetchone()[0] == 1
        login(client)
        assert client.get('/api/player/state').json()['now_playing']['is_autodj'] is False


def test_takeover_respects_existing_guest_queue_and_owner_skip(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        join(client)
        earlier = add(client, VIDEO_A, 'Earlier guest').json()
        with jukebox.connection() as conn:
            conn.execute("UPDATE queue SET status='queued' WHERE id=?", (earlier['id'],))
        seed_auto()
        incoming = add(client, VIDEO_B, 'Later guest').json()
        assert incoming['status'] == 'queued'
        queue = client.get('/api/queue').json()
        assert queue[0]['id'] == earlier['id']
        assert client.post(f"/api/queue/{earlier['id']}/skip").json()['idempotent'] is False
        assert client.get('/api/queue').json()[0]['id'] == incoming['id']
        assert client.post(f"/api/queue/{earlier['id']}/skip").json()['idempotent'] is True
        assert client.get('/api/queue').json()[0]['id'] == incoming['id']


def test_autodj_never_duplicates_a_live_guest_selection(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        join(client)
        add(client, VIDEO_A, 'Guest')
        prepared = jukebox.insert_autodj_candidate({'video_id': VIDEO_A, 'title': 'Funk'}, 'Party Funk')
        assert prepared == {'prepared': False, 'reason': 'recent'}
        assert len(client.get('/api/queue').json()) == 1
