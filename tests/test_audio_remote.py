import app as jukebox
from fastapi.testclient import TestClient
from test_app import make_client, login


PROFILE = dict(audio_mode="bass_guard", target_lufs=-17,
               limiter_ceiling_db=-4, bass_guard_strength=100)


def test_mobile_settings_need_real_dsp_confirmation(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as pc:
        login(pc)
        with TestClient(jukebox.app) as mobile:
            login(mobile)
            before = jukebox.venue_settings()
            saved = mobile.put("/api/admin/audio/settings", json=PROFILE)
            assert saved.status_code == 200
            assert saved.json()["settings_confirmed"] is False
            after = jukebox.venue_settings()
            for key in ("business_name", "tv_mode", "autodj_enabled", "menu_text"):
                assert before[key] == after[key]
            pc.post("/api/admin/audio/heartbeat", json={"applied_profile": PROFILE})
            actual = mobile.get("/api/admin/audio/status").json()
            assert actual["settings_confirmed"] and actual["processing"]
            changed = {**PROFILE, "target_lufs": -20}
            assert not mobile.put("/api/admin/audio/settings", json=changed).json()["settings_confirmed"]
            pc.post("/api/admin/audio/heartbeat", json={"applied_profile": changed})
            assert mobile.get("/api/admin/audio/status").json()["settings_confirmed"]
            clock = jukebox.now()
            monkeypatch.setattr(jukebox, "now", lambda: clock + 19)
            stale = mobile.get("/api/admin/audio/status").json()
            assert not stale["connected"]
            assert not stale["settings_confirmed"]
            assert not stale["processing"]


def test_telemetry_pairing_cannot_control_bar(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as pc:
        assert pc.post("/api/admin/audio/heartbeat", json={}).status_code == 401
        assert pc.put("/api/admin/audio/settings", json=PROFILE).status_code == 401
        login(pc)
        assert pc.post("/api/admin/audio/heartbeat", json={}).status_code == 200
        assert pc.cookies.get("jukebox_audio")
        clock = jukebox.now()
        monkeypatch.setattr(jukebox, "now", lambda: clock + 13 * 3600)
        assert pc.post("/api/admin/audio/heartbeat", json={}).status_code == 200
        assert pc.put("/api/admin/audio/settings", json=PROFILE).status_code == 401
        assert pc.get("/api/admin/config").status_code == 401
        pc.post("/api/admin/logout")
        assert pc.post("/api/admin/audio/heartbeat", json={}).status_code == 401


def test_old_extension_and_bypass_never_claim_active_protection(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as client:
        login(client)
        client.put("/api/admin/audio/settings", json=PROFILE)
        legacy = client.post("/api/admin/audio/heartbeat", json={}).json()
        assert legacy["connected"] and not legacy["processing"]
        assert not legacy["settings_confirmed"]
        bypass = {**PROFILE, "audio_mode": "standard"}
        client.put("/api/admin/audio/settings", json=bypass)
        actual = client.post("/api/admin/audio/heartbeat", json={"applied_profile": bypass}).json()
        assert actual["settings_confirmed"] and not actual["processing"]
        assert client.put("/api/admin/audio/settings", json={**PROFILE, "target_lufs": 0}).status_code == 422
