import app as jukebox
from fastapi.testclient import TestClient


VIDEO_A = "dQw4w9WgXcQ"
VIDEO_B = "9bZkp7q19f0"


def make_client(tmp_path, monkeypatch):
    monkeypatch.setattr(jukebox, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(jukebox, "USE_SUPABASE", False)
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


def test_admin_manages_venue_tv_and_audio_profile(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        default_display = client.get("/api/display")
        assert default_display.status_code == 200
        assert default_display.json()["tv_mode"] == "clip"
        assert client.put(
            "/api/admin/display",
            json={"business_name": "Ztracený bar", "tv_mode": "dj", "menu_text": "Pivo | 49 Kč"},
        ).status_code == 401

        login(client)
        saved = client.put(
            "/api/admin/display",
            json={
                "business_name": "Ztracený <bar>",
                "tv_mode": "menu",
                "menu_text": "PIVO\nRadegast 10 | 49 Kč\nGin & tonic | 115 Kč",
                "audio_mode": "bass_guard",
                "target_lufs": -15,
                "limiter_ceiling_db": -1.5,
                "bass_guard_strength": 72,
            },
        )
        assert saved.status_code == 200
        assert saved.json()["business_name"] == "Ztracený bar"
        assert saved.json()["revision"] == 1

        display = client.get("/api/display").json()
        assert display["business_name"] == "Ztracený bar"
        assert display["tv_mode"] == "menu"
        assert "Radegast 10 | 49 Kč" in display["menu_text"]
        assert client.get("/api/config").json()["bar_name"] == "Ztracený bar"

        config = client.get("/api/admin/config").json()
        assert config["audio_mode"] == "bass_guard"
        assert config["target_lufs"] == -15
        assert config["limiter_ceiling_db"] == -1.5
        assert config["bass_guard_strength"] == 72
        assert config["audio_processor"]["connected"] is False

        invalid = client.put(
            "/api/admin/display",
            json={"business_name": "Bar", "tv_mode": "invalid", "menu_text": ""},
        )
        assert invalid.status_code == 422


def test_supabase_routes_use_rpc(tmp_path, monkeypatch):
    calls = []

    def fake_rpc(action, payload=None):
        calls.append((action, payload or {}))
        if action == "health":
            return {"status": "ok", "backend": "supabase"}
        if action == "add_song":
            return {"id": 7, "video_id": payload["video_id"], "title": payload["title"]}
        if action == "queue_list":
            return []
        return {"ok": True}

    monkeypatch.setattr(jukebox, "USE_SUPABASE", True)
    monkeypatch.setattr(jukebox, "db_rpc", fake_rpc)
    with TestClient(jukebox.app) as client:
        join(client)
        assert client.get("/health").json()["backend"] == "supabase"
        created = add(client, VIDEO_A, "Persistent song")
        assert created.status_code == 201
        assert created.json()["id"] == 7
        assert client.get("/api/queue").status_code == 200

    assert [action for action, _ in calls] == ["health", "add_song", "queue_list"]
    assert calls[1][1]["max_queue"] == jukebox.MAX_QUEUE_LENGTH
