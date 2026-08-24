import app as jukebox
from fastapi.testclient import TestClient


VIDEO_A = "dQw4w9WgXcQ"
VIDEO_B = "9bZkp7q19f0"


def make_client(tmp_path, monkeypatch):
    monkeypatch.setattr(jukebox, "DB_PATH", tmp_path / "test.db")
    jukebox.LOGIN_FAILURES.clear()
    jukebox.SEARCH_CACHE.clear()
    return TestClient(jukebox.app)


def join(client):
    response = client.get(f"/guest?code={jukebox.JOIN_CODE}")
    assert response.status_code == 200
    assert client.cookies.get("jukebox_guest")


def login(client):
    response = client.post("/api/admin/login", json={"pin": jukebox.ADMIN_PIN})
    assert response.status_code == 200
    assert client.cookies.get("jukebox_admin")


def add(client, video_id, title):
    return client.post(
        "/api/queue",
        json={"video_id": video_id, "title": title, "artist": "Test artist"},
    )


def test_guest_search_add_and_duplicate_protection(tmp_path, monkeypatch):
    monkeypatch.setattr(
        jukebox,
        "fallback_youtube_search",
        lambda query, limit: [
            {"video_id": VIDEO_A, "title": f"Result {query}", "artist": "Artist", "thumbnail": ""}
        ],
    )
    with make_client(tmp_path, monkeypatch) as client:
        assert client.get("/api/search?q=test").status_code == 401
        join(client)
        search = client.get("/api/search?q=test").json()
        assert search["items"][0]["video_id"] == VIDEO_A
        first = add(client, VIDEO_A, "First song")
        assert first.status_code == 201
        duplicate = add(client, VIDEO_A, "First song again")
        assert duplicate.status_code == 409
        public_song = client.get("/api/queue").json()[0]
        assert public_song["requested_by_me"] == 1
        assert "requester_id" not in public_song
        requested = client.post(f"/api/queue/{public_song['id']}/priority-request")
        assert requested.status_code == 200
        assert client.get("/api/queue").json()[0]["priority_requested"] == 1


def test_one_vote_per_device_and_queue_order(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as owner:
        join(owner)
        song_a = add(owner, VIDEO_A, "Song A").json()
        song_b = add(owner, VIDEO_B, "Song B").json()

        with TestClient(jukebox.app) as voter:
            join(voter)
            assert voter.post(f"/api/queue/{song_b['id']}/vote").status_code == 200
            assert voter.post(f"/api/queue/{song_b['id']}/vote").status_code == 409

        queue = owner.get("/api/queue").json()
        assert [song["id"] for song in queue] == [song_b["id"], song_a["id"]]


def test_admin_controls_player_and_qr(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        join(client)
        song = add(client, VIDEO_A, "Song A").json()
        assert client.post("/api/player/start").status_code == 401
        login(client)
        started = client.post("/api/player/start")
        assert started.status_code == 200
        assert started.json()["song"]["id"] == song["id"]
        state = client.get("/api/player/state").json()
        assert state["now_playing"]["video_id"] == VIDEO_A
        assert client.post("/api/player/control", json={"action": "volume", "value": 42}).status_code == 200
        assert client.get("/api/player/state").json()["volume"] == 42
        qr = client.get("/api/admin/qr.svg")
        assert qr.status_code == 200
        assert "svg" in qr.headers["content-type"]


def test_invalid_pin_and_video_are_rejected(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        assert client.post("/api/admin/login", json={"pin": "wrong"}).status_code == 401
        join(client)
        assert add(client, "bad", "Bad").status_code == 422
