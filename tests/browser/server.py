"""Offline browser fixture with a disposable SQLite database and local song metadata."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import app as jukebox
import uvicorn

jukebox.USE_SUPABASE = False
catalog = [
    {"video_id": "A1234567890", "title": "Guest funk", "artist": "Test band", "thumbnail": ""},
    {"video_id": "B1234567890", "title": "Next guest", "artist": "Test band", "thumbnail": ""},
]
jukebox.search_youtube_catalog = lambda *args, **kwargs: (catalog, "offline fixture")
jukebox.fallback_youtube_search = lambda *args, **kwargs: catalog
jukebox.init_db()
with jukebox.connection() as conn:
    conn.execute(
        "INSERT INTO queue(video_id,title,requested_by,requester_id,priority,status,created_at) "
        "VALUES('Z1234567890','AutoDJ fixture','AutoDJ · Funk','autodj',-100,'playing',?)",
        (jukebox.now(),),
    )
uvicorn.run(jukebox.app, host="127.0.0.1", port=int(sys.argv[1]), log_level="warning")
