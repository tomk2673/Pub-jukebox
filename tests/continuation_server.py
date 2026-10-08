"""Disposable local browser fixture. No production DB, YouTube calls or credentials."""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as jukebox
import uvicorn

jukebox.USE_SUPABASE = False
jukebox.DB_PATH = Path(tempfile.mkdtemp(prefix="jukebox-continuation-")) / "fixture.db"
jukebox.ADMIN_PIN = "test-only-pin"
jukebox.JOIN_CODE = "test-only-join"
jukebox.SECRET_KEY = b"test-only-signing-secret"


def search(query, limit, **kwargs):
    source = next((key for key, definition in jukebox.AUTO_DJ_PLAYLISTS.items()
                   if query in definition["queries"] or query == jukebox.DISCOVERY_QUERIES.get(key)), "cz_funk")
    base = (list(jukebox.AUTO_DJ_PLAYLISTS).index(source) + 1) * 100
    return ([{"video_id": f"track{base+n:06d}", "title": f"Fixture {source} {n}", "artist": "Test artist"}
             for n in range(1, min(limit, 50) + 1)], "local fixture")


jukebox.search_youtube_catalog = search
jukebox.init_db()
with jukebox.connection() as conn:
    conn.execute("INSERT INTO queue(video_id,title,artist,source_playlist,requester_id,status,started_at,created_at) "
                 "VALUES('track000001','Test Funk','Test artist','cz_funk','admin','playing',?,?)",
                 (jukebox.now(), jukebox.now()))

if __name__ == "__main__":
    uvicorn.run(jukebox.app, host="127.0.0.1", port=8769, log_level="warning")
