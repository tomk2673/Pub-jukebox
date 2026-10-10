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
        first = add(client, 1, "funk")
        guest = add(client, 2)
        prepared = client.post("/api/player/autodj/prepare").json()
        assert prepared["playlist"] == "Funk"
        assert prepared["song"]["source_playlist"] == "funk"
        assert client.post("/api/player/ended").json()["song"]["id"] == guest["id"]
        assert jukebox.autodj_status()["continuation"]["id"] == first["id"]
        automatic = client.post("/api/player/ended").json()["song"]
        assert automatic["source_playlist"] == "funk"
        # After several completions, other enabled genres must never take over.
        for _ in range(2):
            assert client.post("/api/player/autodj/prepare").json()["song"]["source_playlist"] == "funk"
            assert client.post("/api/player/ended").json()["song"]["source_playlist"] == "funk"


def test_playing_selection_replaces_wrong_buffer_but_waiting_selection_does_not(tmp_path, monkeypatch):
    catalog(monkeypatch, [3, 4])
    with client_for(tmp_path, monkeypatch) as client:
        login(client)
        add(client, 1, "funk")
        buffer = client.post("/api/player/autodj/prepare").json()["song"]
        new_choice = add(client, 2, "house")
        assert client.post("/api/player/autodj/prepare").json()["song"]["id"] == buffer["id"]
        assert client.post("/api/player/ended").json()["song"]["id"] == new_choice["id"]
        result = client.post("/api/player/autodj/prepare").json()
        assert result["playlist"] == "House / Techno"
        queue = client.get("/api/queue").json()
        assert len(queue) == 2
        assert not any(song["id"] == buffer["id"] for song in queue)
        assert queue[0]["id"] == new_choice["id"]
        assert queue[1]["source_playlist"] == "house"


def test_full_history_not_only_last_six_and_no_active_guest_duplicates(tmp_path, monkeypatch):
    catalog(monkeypatch, list(range(1, 11)))
    with client_for(tmp_path, monkeypatch) as client:
        login(client)
        with jukebox.connection() as conn:
            for n in range(1, 9):
                conn.execute("INSERT INTO queue(video_id,title,requester_id,status,started_at,finished_at,source_playlist) "
                             "VALUES(?,?,'autodj','done',?,?,'funk')",
                             (song_id(n), f"Past {n}", n, n))
        add(client, 9)  # An active guest song is also excluded, even though it was never AutoDJ.
        result = client.post("/api/player/autodj/prepare").json()
        assert result["song"]["video_id"] == song_id(10)
        assert result["song"]["source_playlist"] == "funk"
        rejected = jukebox.insert_autodj_candidate({"video_id": song_id(1), "title": "Repeat"}, "Funk", "funk")
        # The already-valid buffer stays; a repeat can never create a second one.
        assert rejected["existing"] is True
        assert len(client.get("/api/queue").json()) == 2


def test_stale_background_search_cannot_overwrite_new_playlist(tmp_path, monkeypatch):
    with client_for(tmp_path, monkeypatch) as client:
        login(client)
        first = add(client, 1, "funk")
        add(client, 2, "house")
        client.post("/api/player/ended")
        result = jukebox.insert_autodj_candidate({"video_id": song_id(3), "title": "Late search"},
                                                 "Funk", "funk", first["id"])
        assert result == {"prepared": False, "reason": "stale"}
        assert len(client.get("/api/queue").json()) == 1


def test_recommendations_follow_playlist_and_exclude_previous_offer(tmp_path, monkeypatch):
    catalog(monkeypatch, [1, 2, 3, 4])
    with client_for(tmp_path, monkeypatch) as client:
        assert client.get("/api/discover?category=continue").status_code == 401
        login(client)
        add(client, 1, "hiphop")
        response = client.get(f"/api/discover?category=continue&exclude={song_id(2)}&offset=1")
        data = response.json()
        assert data["playlist"] == "Hip hop"
        assert {song["video_id"] for song in data["items"]} == {song_id(3), song_id(4)}
        assert all(song["source_playlist"] == "hiphop" for song in data["items"])
        client.post("/api/queue", json=data["items"][0])
        assert client.get("/api/queue").json()[1]["source_playlist"] == "hiphop"
        assert client.get("/api/discover?category=continue&offset=-1").status_code == 422


def test_legacy_autodj_context_and_guest_name_spoofing(tmp_path, monkeypatch):
    catalog(monkeypatch, [2])
    with client_for(tmp_path, monkeypatch) as client:
        login(client)
        add(client, 1, name="AutoDJ · House / Techno")
        assert jukebox.autodj_status()["continuation"] is None
        with jukebox.connection() as conn:
            conn.execute("UPDATE queue SET requester_id='autodj',requested_by='AutoDJ · Retro Soul & Blues'")
            conn.execute("UPDATE venue_settings SET autodj_playlists='[\"soul_blues\",\"funk\"]'")
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
        assert jukebox.autodj_program({"autodj_playlists": ["house"]}, 0,
                                     {"source_playlist": "funk"})[2] == "house"
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
        add(client, 1, "house")
        jukebox.insert_autodj_candidate({"video_id": song_id(2), "title": "Wrong buffer"}, "Funk", "funk")
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
        result = add(client, 1, "house")
        assert result["source_playlist"] == "house"
    assert calls == [("jukebox_continuation_rpc", "add_song", {
        "requester_id": "admin", "video_id": song_id(1), "title": "Song 1", "artist": "",
        "thumbnail": "", "requested_by": "Guest", "max_queue": jukebox.MAX_QUEUE_LENGTH,
        "max_guest": jukebox.MAX_ACTIVE_PER_GUEST, "source_playlist": "house",
    })]


def test_preview_and_album_are_not_auto_tracks_and_old_buffer_is_replaced(tmp_path, monkeypatch):
    catalog(monkeypatch, [3, 4])
    with client_for(tmp_path, monkeypatch) as client:
        login(client)
        add(client, 1, "funk")
        old = jukebox.insert_autodj_candidate({"video_id": song_id(2), "title": "Monkey Business (Upoutávka)"},
                                             "Funk", "funk")["song"]
        result = client.post("/api/player/autodj/prepare").json()
        assert result["song"]["id"] != old["id"]
        assert result["song"]["source_playlist"] == "funk"
        assert old["id"] not in [song["id"] for song in client.get("/api/queue").json()]
    assert not jukebox.is_autodj_music_candidate({"title": "PSH (Full Album)"})
    assert not jukebox.is_autodj_music_candidate({"title": "Nová upoutavka"})
    assert jukebox.is_music_candidate({"title": "PSH (Full Album)"})  # explicit guest music remains available
    assert jukebox.is_autodj_music_candidate({"title": "PSH - Parket"})


def test_saved_czech_preset_and_buffer_move_to_world_music_without_losing_guest(tmp_path, monkeypatch):
    catalog(monkeypatch, [4, 5, 6])
    with client_for(tmp_path, monkeypatch) as client:
        login(client)
        playing = add(client, 1, "funk")
        guest = add(client, 2)
        with jukebox.connection() as conn:
            conn.execute("UPDATE venue_settings SET autodj_playlists='[\"cz_funk\",\"cz_oldies\",\"cz_hiphop\"]'")
            conn.execute("UPDATE queue SET source_playlist='cz_funk' WHERE id=?", (playing["id"],))
            cursor = conn.execute(
                "INSERT INTO queue(video_id,title,requester_id,requested_by,source_playlist,priority,created_at) "
                "VALUES(?,'Old Czech buffer','autodj','AutoDJ · Český funk','cz_funk',-100,?)",
                (song_id(3), jukebox.now()),
            )
            old_buffer = cursor.lastrowid
        assert client.get("/api/display").json()["autodj_playlists"] == ["world_hits", "funk", "hiphop", "house"]
        result = client.post("/api/player/autodj/prepare").json()
        assert result["playlist"] == "Celosvětové hity"
        assert result["song"]["source_playlist"] == "world_hits"
        queue = client.get("/api/queue").json()
        assert old_buffer not in [song["id"] for song in queue]
        assert guest["id"] in [song["id"] for song in queue]
        assert client.post("/api/player/ended").json()["song"]["id"] == guest["id"]
        assert client.post("/api/player/ended").json()["song"]["source_playlist"] == "world_hits"


def test_open_legacy_discovery_tabs_use_new_sources_and_czech_search_stays_available(tmp_path, monkeypatch):
    queries = catalog(monkeypatch, [1, 2, 3])
    with client_for(tmp_path, monkeypatch) as client:
        login(client)
        for legacy, replacement in (("cz_funk", "world_hits"), ("cz_oldies", "world_hits"), ("cz_hiphop", "hiphop")):
            result = client.get(f"/api/discover?category={legacy}")
            assert result.status_code == 200
            assert result.json()["category"] == replacement
            assert all(song["source_playlist"] == replacement for song in result.json()["items"])
        assert client.get("/api/search?q=Karel%20Gott").status_code == 200
        assert queries[-1] == "Karel Gott"
