import app as jukebox
from fastapi.testclient import TestClient


def song_id(number):
    return f"track{number:06d}"


def client_for(tmp_path, monkeypatch):
    monkeypatch.setattr(jukebox, "DB_PATH", tmp_path / "continuation.db")
    monkeypatch.setattr(jukebox, "USE_SUPABASE", False)
    jukebox.SEARCH_CACHE.clear()
    jukebox.NETWORK_CACHE.update(expires=0.0, allowed="")
    return TestClient(jukebox.app)


def login(client):
    assert client.post("/api/admin/login", json={"pin": jukebox.ADMIN_PIN}).status_code == 200


def add(client, number, source="", name="Guest"):
    result = client.post("/api/queue", json={"video_id": song_id(number), "title": f"Song {number}",
                                              "source_playlist": source, "requested_by": name})
    assert result.status_code == 201
    return result.json()


def catalog(monkeypatch, numbers):
    calls = []

    def search(query, limit, **kwargs):
        calls.append(query)
        return ([{"video_id": song_id(n), "title": f"New music {n}", "artist": f"Artist {n}"}
                 for n in numbers], "fixture catalog")

    monkeypatch.setattr(jukebox, "search_youtube_catalog", search)
    return calls


def test_playlist_stays_after_completion_and_unlabelled_guest(tmp_path, monkeypatch):
    catalog(monkeypatch, [3, 4, 5, 6])
    with client_for(tmp_path, monkeypatch) as client:
        login(client)
        first = add(client, 1, "cz_funk")
        guest = add(client, 2)
        prepared = client.post("/api/player/autodj/prepare").json()
        assert prepared["playlist"] == "Český funk"
        assert prepared["song"]["source_playlist"] == "cz_funk"
        assert client.post("/api/player/ended").json()["song"]["id"] == guest["id"]
        assert jukebox.autodj_status()["continuation"]["id"] == first["id"]
        automatic = client.post("/api/player/ended").json()["song"]
        assert automatic["source_playlist"] == "cz_funk"
        # After several completions, other enabled genres must never take over.
        for _ in range(2):
            assert client.post("/api/player/autodj/prepare").json()["song"]["source_playlist"] == "cz_funk"
            assert client.post("/api/player/ended").json()["song"]["source_playlist"] == "cz_funk"


def test_playing_selection_replaces_wrong_buffer_but_waiting_selection_does_not(tmp_path, monkeypatch):
    catalog(monkeypatch, [3, 4])
    with client_for(tmp_path, monkeypatch) as client:
        login(client)
        add(client, 1, "cz_funk")
        buffer = client.post("/api/player/autodj/prepare").json()["song"]
        new_choice = add(client, 2, "cz_oldies")
        assert client.post("/api/player/autodj/prepare").json()["song"]["id"] == buffer["id"]
        assert client.post("/api/player/ended").json()["song"]["id"] == new_choice["id"]
        result = client.post("/api/player/autodj/prepare").json()
        assert result["playlist"] == "České oldies"
        queue = client.get("/api/queue").json()
        assert len(queue) == 2
        assert not any(song["id"] == buffer["id"] for song in queue)
        assert queue[0]["id"] == new_choice["id"]
        assert queue[1]["source_playlist"] == "cz_oldies"


def test_full_history_not_only_last_six_and_no_active_guest_duplicates(tmp_path, monkeypatch):
    catalog(monkeypatch, list(range(1, 11)))
    with client_for(tmp_path, monkeypatch) as client:
        login(client)
        with jukebox.connection() as conn:
            for n in range(1, 9):
                conn.execute("INSERT INTO queue(video_id,title,requester_id,status,started_at,finished_at,source_playlist) "
                             "VALUES(?,?,'autodj','done',?,?,'cz_funk')",
                             (song_id(n), f"Past {n}", n, n))
        add(client, 9)  # An active guest song is also excluded, even though it was never AutoDJ.
        result = client.post("/api/player/autodj/prepare").json()
        assert result["song"]["video_id"] == song_id(10)
        assert result["song"]["source_playlist"] == "cz_funk"
        rejected = jukebox.insert_autodj_candidate({"video_id": song_id(1), "title": "Repeat"}, "Český funk", "cz_funk")
        # The already-valid buffer stays; a repeat can never create a second one.
        assert rejected["existing"] is True
        assert len(client.get("/api/queue").json()) == 2


def test_stale_background_search_cannot_overwrite_new_playlist(tmp_path, monkeypatch):
    with client_for(tmp_path, monkeypatch) as client:
        login(client)
        first = add(client, 1, "cz_funk")
        add(client, 2, "cz_oldies")
        client.post("/api/player/ended")
        result = jukebox.insert_autodj_candidate({"video_id": song_id(3), "title": "Late search"},
                                                 "Český funk", "cz_funk", first["id"])
        assert result == {"prepared": False, "reason": "stale"}
        assert len(client.get("/api/queue").json()) == 1


def test_recommendations_follow_playlist_and_exclude_previous_offer(tmp_path, monkeypatch):
    catalog(monkeypatch, [1, 2, 3, 4])
    with client_for(tmp_path, monkeypatch) as client:
        assert client.get("/api/discover?category=continue").status_code == 401
        login(client)
        add(client, 1, "cz_hiphop")
        response = client.get(f"/api/discover?category=continue&exclude={song_id(2)}&offset=1")
        data = response.json()
        assert data["playlist"] == "Český hip-hop 90/00"
        assert {song["video_id"] for song in data["items"]} == {song_id(3), song_id(4)}
        assert all(song["source_playlist"] == "cz_hiphop" for song in data["items"])
        client.post("/api/queue", json=data["items"][0])
        assert client.get("/api/queue").json()[1]["source_playlist"] == "cz_hiphop"
        assert client.get("/api/discover?category=continue&offset=-1").status_code == 422


def test_legacy_autodj_context_and_guest_name_spoofing(tmp_path, monkeypatch):
    catalog(monkeypatch, [2])
    with client_for(tmp_path, monkeypatch) as client:
        login(client)
        add(client, 1, name="AutoDJ · České oldies")
        assert jukebox.autodj_status()["continuation"] is None
        with jukebox.connection() as conn:
            conn.execute("UPDATE queue SET requester_id='autodj',requested_by='AutoDJ · Retro Soul & Blues'")
            conn.execute("UPDATE venue_settings SET autodj_playlists='[\"soul_blues\",\"cz_funk\"]'")
        result = client.post("/api/player/autodj/prepare").json()
        assert result["playlist"] == "Retro Soul & Blues"
        assert result["song"]["source_playlist"] == "soul_blues"


def test_custom_playlist_and_disabled_source(tmp_path, monkeypatch):
    catalog(monkeypatch, [2])
    with client_for(tmp_path, monkeypatch) as client:
        login(client)
        add(client, 1, "custom:rock 80. let")
        with jukebox.connection() as conn:
            conn.execute("UPDATE venue_settings SET autodj_custom_queries='rock 80. let'")
        result = client.post("/api/player/autodj/prepare").json()
        assert result["song"]["source_playlist"] == "custom:rock 80. let"
        assert jukebox.autodj_program({"autodj_playlists": ["cz_oldies"]}, 0,
                                     {"source_playlist": "cz_funk"})[2] == "cz_oldies"
        assert client.post("/api/queue", json={"video_id": song_id(3), "title": "Invalid",
                                               "source_playlist": "unknown"}).status_code == 422
        with jukebox.connection() as conn:
            conn.execute("UPDATE venue_settings SET autodj_enabled=0")
        assert client.post("/api/player/autodj/prepare").json() == {"enabled": False, "prepared": False}
        assert len(client.get("/api/queue").json()) == 1


def test_exhausted_pool_discards_wrong_playlist_without_repeating(tmp_path, monkeypatch):
    catalog(monkeypatch, [1, 2])
    with client_for(tmp_path, monkeypatch) as client:
        login(client)
        add(client, 1, "cz_oldies")
        jukebox.insert_autodj_candidate({"video_id": song_id(2), "title": "Wrong buffer"}, "Český funk", "cz_funk")
        result = client.post("/api/player/autodj/prepare").json()
        assert result["prepared"] is False
        assert result["reason"] == "no_fresh_track"
        assert len(client.get("/api/queue").json()) == 1


def test_supabase_sourced_add_is_atomic_rpc(monkeypatch):
    calls = []
    monkeypatch.setattr(jukebox, "USE_SUPABASE", True)
    monkeypatch.setattr(jukebox, "network_matches", lambda request: True)

    def rpc(function_name, action, payload=None):
        calls.append((function_name, action, payload))
        return {"id": 1, **(payload or {})}

    monkeypatch.setattr(jukebox, "supabase_rpc", rpc)
    with TestClient(jukebox.app) as client:
        login(client)
        result = add(client, 1, "cz_oldies")
        assert result["source_playlist"] == "cz_oldies"
    assert calls == [("jukebox_continuation_rpc", "add_song", {
        "requester_id": "admin", "video_id": song_id(1), "title": "Song 1", "artist": "",
        "thumbnail": "", "requested_by": "Guest", "max_queue": jukebox.MAX_QUEUE_LENGTH,
        "max_guest": jukebox.MAX_ACTIVE_PER_GUEST, "source_playlist": "cz_oldies",
    })]
