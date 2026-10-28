import importlib
import sys

import pytest
from fastapi.testclient import TestClient

import app as jukebox
import demo_server
from test_app import make_client, login
from test_advertising import set_menu, create, activate, event


def test_fresh_menu_qr_never_creates_music_identity(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as admin:
        login(admin)
        set_menu()
        identity = create(admin)
        activate(admin, identity)
        with TestClient(jukebox.app) as fresh:
            assert fresh.get('/menu').status_code == 200
            data = fresh.get('/api/menu').json()
            assert data['menu_text'] and data['sponsor']['event_token']
            assert event(fresh, data['sponsor']['event_token'], 'click').json()['counted']
            assert fresh.get('/api/me').json()['guest'] is False
            assert fresh.post('/api/queue', json={'video_id': 'dQw4w9WgXcQ', 'title': 'Unauthorized'}).status_code == 401
            assert not fresh.cookies.get('jukebox_guest')
            assert fresh.get('/api/menu?preview=' + identity).status_code == 401


def test_menu_keeps_existing_network_restriction(tmp_path, monkeypatch):
    with make_client(tmp_path, monkeypatch) as fresh:
        monkeypatch.setattr(jukebox, 'network_matches', lambda request: False)
        assert fresh.get('/api/menu').status_code == 403
        assert event(fresh, 'not-a-token').status_code == 403


def test_demo_never_imports_live_app_or_uses_its_configuration(monkeypatch):
    # Re-importing the read-only application never evaluates live app.py.
    monkeypatch.setenv('SUPABASE_URL', 'https://production.invalid')
    monkeypatch.setenv('JUKEBOX_DB', '/must/not/be/used.db')
    monkeypatch.setitem(sys.modules, 'app', None)
    isolated = importlib.reload(demo_server)
    with TestClient(isolated.app) as client:
        assert client.get('/health').json()['database'] == 'none'
        data = client.get('/api/menu').json()
        assert data['demo'] and data['sponsor']['preview']
        assert 'event_token' not in data['sponsor']
        assert client.get('/api/admin/ads').json()['campaigns'][0]['active'] is False
        assert 'SUPABASE' not in client.get('/api/config').text


@pytest.mark.parametrize('path', ['/api/admin/login', '/api/admin/ads', '/api/admin/ads/' + 'd'*32 + '/activate', '/api/ads/event', '/api/queue', '/api/player/control', '/api/player/next'])
def test_public_demo_blocks_every_write(path):
    with TestClient(demo_server.app) as client:
        for method in ['POST', 'PUT', 'PATCH', 'DELETE']:
            assert client.request(method, path, json={}).status_code == 405
        assert client.get('/api/queue').json() == []
        assert client.get('/api/admin/ads').json()['campaigns'][0]['impressions'] == 0


def test_demo_headers_fixture_and_navigation():
    with TestClient(demo_server.app, base_url='https://demo.test') as client:
        response = client.get('/menu')
        assert response.headers['x-frame-options'] == 'DENY'
        assert response.headers['cache-control'] == 'no-store'
        assert "connect-src 'self'" in response.headers['content-security-policy']
        assert not response.headers.get('set-cookie')
        assert 'fiktivní' in response.text
        assert 'href="/menu"' in client.get('/guest').text
        assert '/static/install.js' not in client.get('/guest').text
        assert client.get('/api/menu?preview=wrong').status_code == 404
        assert client.get('/demo/qr.svg').headers['content-type'].startswith('image/svg+xml')
        assert client.get('/tv').status_code == 404
        assert client.get('/api/player/state').status_code == 404
        assert client.get('/api/search?q=cokoliv').json()['items'] == []
