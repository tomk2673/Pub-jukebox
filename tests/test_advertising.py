from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import app as jukebox
from test_app import VIDEO_A, add, join, login, make_client


def campaign(**overrides):
    return {
        'sponsor': 'Testovací partner', 'headline': 'Ukázková nabídka',
        'body': 'Pouze test, nejde o skutečného inzerenta.', 'cta': 'Zobrazit nabídku',
        'target_url': 'https://example.com/nabidka',
        'starts_at': jukebox.now() - 10, 'ends_at': jukebox.now() + 86400,
        **overrides,
    }


def set_menu():
    with jukebox.connection() as conn:
        conn.execute('UPDATE venue_settings SET menu_text=? WHERE venue_key=?', ('Pivo\nTestovací nápoj | 50 Kč', jukebox.VENUE_KEY))


def create(client, **overrides):
    response = client.post('/api/admin/ads', json=campaign(**overrides))
    assert response.status_code == 201, response.text
    return response.json()['id']


def activate(client, identity):
    return client.post(f'/api/admin/ads/{identity}/activate', json={})


def event(client, token, kind='impression'):
    return client.post('/api/ads/event', json={'token': token, 'kind': kind})


def test_off_by_default_and_admin_permissions(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as guest:
        assert guest.get('/api/menu').status_code == 401
        assert guest.get('/api/admin/ads').status_code == 401
        join(guest)
        assert guest.get('/api/menu').json()['sponsor'] is None
        assert guest.post('/api/admin/ads', json=campaign()).status_code == 401
        assert guest.get('/api/menu?preview=' + 'a' * 32).status_code == 401
        login(guest)
        config = guest.get('/api/admin/ads').json()
        assert config['campaigns'] == []
        assert config['venue_revenue_share_percent'] == 0
        assert config['programmatic_enabled'] is config['rewarded_enabled'] is False


def test_drafts_preview_menu_gate_and_no_admin_impressions(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as admin:
        login(admin)
        identity = create(admin)
        assert activate(admin, identity).status_code == 409
        preview = admin.get('/api/menu?preview=' + identity).json()['sponsor']
        assert preview['preview'] is True and 'event_token' not in preview
        set_menu()
        with TestClient(jukebox.app) as guest:
            join(guest)
            assert guest.get('/api/menu').json()['sponsor'] is None
            assert activate(admin, identity).status_code == 200
            ad = guest.get('/api/menu').json()['sponsor']
            assert ad['id'] == identity and ad['event_token']
            assert event(admin, ad['event_token']).json()['counted'] is False
            assert admin.get('/api/admin/ads').json()['campaigns'][0]['impressions'] == 0
        assert 'event_token' not in admin.get('/api/menu').json()['sponsor']


@pytest.mark.parametrize('url', ['javascript:alert(1)', 'http://example.com', 'https://a@evil.example', 'https://example.com\\@evil.example', 'https://example.com\n', 'https://example.com:invalid', 'https://example.com:8443'])
def test_reject_unsafe_links(tmp_path, monkeypatch, url):
    with make_client(tmp_path, monkeypatch) as admin:
        login(admin)
        assert admin.post('/api/admin/ads', json=campaign(target_url=url)).status_code == 422


def test_reject_script_markup_bad_dates_and_cross_origin_changes(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as admin:
        login(admin)
        assert admin.post('/api/admin/ads', json=campaign(headline='<script>x</script>')).status_code == 422
        assert admin.post('/api/admin/ads', json=campaign(ends_at=1)).status_code == 422
        assert admin.post('/api/admin/ads', json=campaign(), headers={'origin': 'https://attacker.example'}).status_code == 403
        identity = create(admin)
        assert admin.post(f'/api/admin/ads/{identity}/pause').status_code == 415


def test_measurement_signed_deduplicated_concurrent_and_never_changes_playback(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as admin:
        login(admin); set_menu()
        identity = create(admin); activate(admin, identity)
        with TestClient(jukebox.app) as guest:
            join(guest); add(guest, VIDEO_A, 'Playing during ads')
            before = guest.get('/api/queue').json()
            token = guest.get('/api/menu').json()['sponsor']['event_token']
            assert event(guest, token[:-10] + 'tamperedxx').status_code == 422
            with ThreadPoolExecutor(max_workers=4) as pool:
                responses = list(pool.map(lambda _: event(guest, token, 'click'), range(8)))
            assert all(response.status_code == 200 for response in responses)
            assert sum(response.json()['counted'] for response in responses) == 1
            assert event(guest, token).json()['counted'] is False
            stats = admin.get('/api/admin/ads').json()['campaigns'][0]
            assert (stats['impressions'], stats['clicks']) == (1, 1)
            assert guest.get('/api/queue').json() == before
            # Tokens are one-hour capabilities; they cannot be replayed after expiry.
            stamp = jukebox.now()
            monkeypatch.setattr(jukebox, 'now', lambda: stamp + 3601)
            assert event(guest, token).status_code == 422


def test_pause_replace_and_scheduled_expiry(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as admin:
        login(admin); set_menu()
        first = create(admin); activate(admin, first)
        with TestClient(jukebox.app) as guest:
            join(guest)
            token = guest.get('/api/menu').json()['sponsor']['event_token']
            second = create(admin, headline='Další kampaň'); activate(admin, second)
            assert event(guest, token).json()['counted'] is False
            assert guest.get('/api/menu').json()['sponsor']['id'] == second
            assert sum(bool(c['active']) for c in admin.get('/api/admin/ads').json()['campaigns']) == 1
            assert admin.post(f'/api/admin/ads/{second}/pause', json={}).status_code == 200
            assert guest.get('/api/menu').json()['sponsor'] is None
            future = create(admin, starts_at=jukebox.now()+300, ends_at=jukebox.now()+600)
            activate(admin, future)
            assert guest.get('/api/menu').json()['sponsor'] is None
            stamp = jukebox.now()
            monkeypatch.setattr(jukebox, 'now', lambda: stamp + 301)
            assert guest.get('/api/menu').json()['sponsor']['id'] == future
            monkeypatch.setattr(jukebox, 'now', lambda: stamp + 601)
            assert guest.get('/api/menu').json()['sponsor'] is None
            assert activate(admin, future).status_code == 409


def test_cloud_failure_isolated_from_menu_and_payload_scoped(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as admin:
        login(admin); set_menu()
        profile = jukebox.venue_settings()
        monkeypatch.setattr(jukebox, 'venue_settings', lambda: profile)
        monkeypatch.setattr(jukebox, 'USE_SUPABASE', True)
        calls = []
        def fail(name, action, payload):
            calls.append((name, action, payload))
            raise HTTPException(503, 'Ad store unavailable')
        monkeypatch.setattr(jukebox, 'supabase_rpc', fail)
        response = admin.get('/api/menu')
        assert response.status_code == 200 and response.json()['sponsor'] is None
        assert response.json()['menu_text'] == profile['menu_text']
        assert calls[0][0:2] == ('jukebox_ads_rpc', 'current')
        assert calls[0][2]['venue_key'] == jukebox.VENUE_KEY
        assert admin.get('/api/admin/ads').status_code == 503
