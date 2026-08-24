from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import io
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qs, quote, urlparse

import httpx
import qrcode
import qrcode.image.svg
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


BASE = Path(__file__).resolve().parent
STATIC = BASE / "static"
DB_PATH = Path(os.getenv("JUKEBOX_DB", str(BASE / "jukebox.db")))
ADMIN_PIN = os.getenv("ADMIN_PIN", "2673")
JOIN_CODE = os.getenv("JOIN_CODE", "ztraceny-bar")
SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-change-me").encode("utf-8")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "").strip()
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
JUKEBOX_DB_SECRET = os.getenv("JUKEBOX_DB_SECRET", "").strip()
USE_SUPABASE = bool(SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY and JUKEBOX_DB_SECRET)
BAR_NAME = os.getenv("BAR_NAME", "PUB JUKEBOX")
VENUE_KEY = re.sub(r"[^a-z0-9-]", "-", os.getenv("VENUE_KEY", "ztraceny-bar").lower()).strip("-")[:64] or "venue"
DEFAULT_MENU_TEXT = os.getenv("DEFAULT_MENU_TEXT", "").strip()
PRIORITY_PRICE_CZK = max(0, int(os.getenv("PRIORITY_PRICE_CZK", "5")))
MAX_QUEUE_LENGTH = max(5, int(os.getenv("MAX_QUEUE_LENGTH", "50")))
MAX_ACTIVE_PER_GUEST = max(1, int(os.getenv("MAX_ACTIVE_PER_GUEST", "3")))
NIGHT_VOLUME = min(100, max(0, int(os.getenv("NIGHT_VOLUME", "55"))))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "").lower() in {"1", "true", "yes"}
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
SEARCH_CACHE: dict[str, tuple[float, list[dict]]] = {}
SEARCH_LOCK = threading.Lock()
LOGIN_FAILURES: dict[str, list[float]] = {}
SEARCH_ACTIVITY: dict[str, list[float]] = {}
NETWORK_CACHE: dict[str, float | str] = {"expires": 0.0, "allowed": ""}
AUTO_DJ_PLAYLISTS = {
    "cz_funk": {
        "label": "Český funk",
        "queries": [
            "J.A.R. český funk official",
            "Monkey Business CZ official",
            "Roman Holý Sexy Dancers official",
        ],
    },
    "cz_oldies": {
        "label": "České oldies",
        "queries": [
            "Hana Zagorová hity official",
            "Karel Gott hity official",
            "Marie Rottrová Olympic české hity official",
        ],
    },
    "cz_hiphop": {
        "label": "Český hip-hop 90/00",
        "queries": [
            "PSH starý český hip hop official",
            "Indy Wich český hip hop official",
            "Chaozz český hip hop official",
        ],
    },
    "karaoke": {
        "label": "Karaoke hity",
        "queries": [
            "české karaoke hity s textem",
            "Karel Gott karaoke s textem",
            "Hana Zagorová karaoke s textem",
        ],
    },
}
DEFAULT_AUTO_DJ_PLAYLISTS = ["cz_funk", "cz_oldies", "cz_hiphop"]


def connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    with connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS queue(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                video_id TEXT NOT NULL,
                title TEXT NOT NULL,
                artist TEXT NOT NULL DEFAULT '',
                thumbnail TEXT NOT NULL DEFAULT '',
                requested_by TEXT NOT NULL DEFAULT '',
                requester_id TEXT NOT NULL DEFAULT '',
                votes INTEGER NOT NULL DEFAULT 0,
                priority INTEGER NOT NULL DEFAULT 0,
                priority_requested INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'queued',
                created_at INTEGER NOT NULL DEFAULT 0,
                started_at INTEGER,
                finished_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS votes(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                queue_id INTEGER NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
                voter_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(queue_id, voter_id)
            );
            CREATE TABLE IF NOT EXISTS player_state(
                id INTEGER PRIMARY KEY CHECK(id=1),
                revision INTEGER NOT NULL DEFAULT 0,
                action TEXT NOT NULL DEFAULT 'sync',
                volume INTEGER NOT NULL DEFAULT 80,
                night_mode INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            );
            INSERT OR IGNORE INTO player_state(id, updated_at) VALUES(1, 0);
            CREATE TABLE IF NOT EXISTS venue_settings(
                venue_key TEXT PRIMARY KEY,
                business_name TEXT NOT NULL,
                tv_mode TEXT NOT NULL DEFAULT 'clip' CHECK(tv_mode IN ('clip','dj','menu')),
                menu_text TEXT NOT NULL DEFAULT '',
                transition_mode TEXT NOT NULL DEFAULT 'scratch' CHECK(transition_mode IN ('none','scratch')),
                transition_volume INTEGER NOT NULL DEFAULT 55,
                autodj_enabled INTEGER NOT NULL DEFAULT 1,
                autodj_playlists TEXT NOT NULL DEFAULT '["cz_funk","cz_oldies","cz_hiphop"]',
                autodj_custom_queries TEXT NOT NULL DEFAULT '',
                audio_mode TEXT NOT NULL DEFAULT 'standard' CHECK(audio_mode IN ('standard','bass_guard')),
                target_lufs INTEGER NOT NULL DEFAULT -16,
                limiter_ceiling_db REAL NOT NULL DEFAULT -1.0,
                bass_guard_strength INTEGER NOT NULL DEFAULT 65,
                allowed_network TEXT NOT NULL DEFAULT '',
                plan TEXT NOT NULL DEFAULT 'pilot',
                features TEXT NOT NULL DEFAULT '{"search":true,"voting":true,"priority":true,"tv_modes":true,"drink_menu":true,"bass_guard":true}',
                is_active INTEGER NOT NULL DEFAULT 1,
                revision INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS audio_processors(
                venue_key TEXT PRIMARY KEY,
                device_name TEXT NOT NULL DEFAULT '',
                extension_version TEXT NOT NULL DEFAULT '',
                measured_lufs REAL,
                gain_db REAL NOT NULL DEFAULT 0,
                bass_reduction_db REAL NOT NULL DEFAULT 0,
                limiter_reduction_db REAL NOT NULL DEFAULT 0,
                last_seen INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS queue_active_idx
                ON queue(status, priority DESC, votes DESC, id ASC);
            """
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO venue_settings(venue_key,business_name,menu_text,updated_at)
            VALUES(?,?,?,?)
            """,
            (VENUE_KEY, BAR_NAME, DEFAULT_MENU_TEXT, now()),
        )

        # Upgrade databases made by the original prototype without losing their queue.
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(queue)")}
        migrations = {
            "thumbnail": "TEXT NOT NULL DEFAULT ''",
            "requested_by": "TEXT NOT NULL DEFAULT ''",
            "requester_id": "TEXT NOT NULL DEFAULT ''",
            "priority_requested": "INTEGER NOT NULL DEFAULT 0",
            "created_at": "INTEGER NOT NULL DEFAULT 0",
            "started_at": "INTEGER",
            "finished_at": "INTEGER",
        }
        for column, definition in migrations.items():
            if column not in existing:
                conn.execute(f"ALTER TABLE queue ADD COLUMN {column} {definition}")
        venue_columns = {row["name"] for row in conn.execute("PRAGMA table_info(venue_settings)")}
        venue_migrations = {
            "audio_mode": "TEXT NOT NULL DEFAULT 'standard'",
            "target_lufs": "INTEGER NOT NULL DEFAULT -16",
            "limiter_ceiling_db": "REAL NOT NULL DEFAULT -1.0",
            "bass_guard_strength": "INTEGER NOT NULL DEFAULT 65",
            "allowed_network": "TEXT NOT NULL DEFAULT ''",
            "transition_mode": "TEXT NOT NULL DEFAULT 'scratch'",
            "transition_volume": "INTEGER NOT NULL DEFAULT 55",
            "autodj_enabled": "INTEGER NOT NULL DEFAULT 1",
            "autodj_playlists": "TEXT NOT NULL DEFAULT '[\"cz_funk\",\"cz_oldies\",\"cz_hiphop\"]'",
            "autodj_custom_queries": "TEXT NOT NULL DEFAULT ''",
        }
        for column, definition in venue_migrations.items():
            if column not in venue_columns:
                conn.execute(f"ALTER TABLE venue_settings ADD COLUMN {column} {definition}")
        conn.execute("UPDATE queue SET created_at=id WHERE created_at=0")
        conn.commit()


def supabase_rpc(function_name: str, action: str, payload: dict | None = None):
    """Call a private jukebox RPC through Supabase PostgREST."""
    if not USE_SUPABASE:
        raise RuntimeError("Supabase is not configured")
    try:
        with httpx.Client(trust_env=False) as client:
            response = client.post(
                f"{SUPABASE_URL}/rest/v1/rpc/{function_name}",
                headers={
                    "apikey": SUPABASE_PUBLISHABLE_KEY,
                    "Authorization": f"Bearer {SUPABASE_PUBLISHABLE_KEY}",
                    "x-jukebox-secret": JUKEBOX_DB_SECRET,
                    "Content-Type": "application/json",
                },
                json={"action": action, "payload": payload or {}},
                timeout=12,
            )
        response.raise_for_status()
        result = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(503, "Databáze jukeboxu je dočasně nedostupná.") from exc
    if isinstance(result, dict) and result.get("_error"):
        raise HTTPException(int(result.get("_status", 400)), str(result["_error"]))
    return result


def db_rpc(action: str, payload: dict | None = None):
    return supabase_rpc("jukebox_rpc", action, payload)


def settings_rpc(action: str, payload: dict | None = None):
    body = {"venue_key": VENUE_KEY, **(payload or {})}
    return supabase_rpc("jukebox_settings_rpc", action, body)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not USE_SUPABASE:
        init_db()
    yield


app = FastAPI(title="PUB Jukebox", version="1.5.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


class PinLogin(BaseModel):
    pin: str = Field(min_length=1, max_length=32)


class Song(BaseModel):
    video_id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=160)
    artist: str = Field(default="", max_length=100)
    thumbnail: str = Field(default="", max_length=500)
    requested_by: str = Field(default="", max_length=40)


class PlayerControl(BaseModel):
    action: Literal["pause", "resume", "volume", "night"]
    value: int | bool | None = None


class VenueSettingsUpdate(BaseModel):
    business_name: str = Field(min_length=2, max_length=80)
    tv_mode: Literal["clip", "dj", "menu"] = "clip"
    menu_text: str = Field(default="", max_length=4000)
    transition_mode: Literal["none", "scratch"] = "scratch"
    transition_volume: int = Field(default=55, ge=0, le=100)
    autodj_enabled: bool = True
    autodj_playlists: list[Literal["cz_funk", "cz_oldies", "cz_hiphop", "karaoke"]] = Field(
        default_factory=lambda: list(DEFAULT_AUTO_DJ_PLAYLISTS), max_length=4
    )
    autodj_custom_queries: str = Field(default="", max_length=1000)
    audio_mode: Literal["standard", "bass_guard"] = "standard"
    target_lufs: int = Field(default=-16, ge=-24, le=-8)
    limiter_ceiling_db: float = Field(default=-1.0, ge=-6.0, le=0.0)
    bass_guard_strength: int = Field(default=65, ge=0, le=100)


class AudioProcessorHeartbeat(BaseModel):
    device_name: str = Field(default="Windows Chrome", max_length=80)
    extension_version: str = Field(default="", max_length=24)
    measured_lufs: float | None = Field(default=None, ge=-100.0, le=12.0)
    gain_db: float = Field(default=0.0, ge=-24.0, le=24.0)
    bass_reduction_db: float = Field(default=0.0, ge=0.0, le=30.0)
    limiter_reduction_db: float = Field(default=0.0, ge=0.0, le=30.0)


class NetworkLockUpdate(BaseModel):
    action: Literal["capture", "disable"]


def now() -> int:
    return int(time.time())


def clean_text(value: str, limit: int) -> str:
    return " ".join(value.replace("<", "").replace(">", "").split())[:limit]


def clean_menu(value: str) -> str:
    lines = [clean_text(line, 140) for line in value.splitlines()]
    return "\n".join(line for line in lines if line)[:4000]


def normalize_autodj_playlists(value) -> list[str]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            value = value.split(",")
    if not isinstance(value, list):
        return list(DEFAULT_AUTO_DJ_PLAYLISTS)
    result = []
    for item in value:
        key = str(item).strip()
        if key in AUTO_DJ_PLAYLISTS and key not in result:
            result.append(key)
    return result


def clean_autodj_queries(value: str) -> str:
    lines = [clean_text(line, 100) for line in value.splitlines()]
    return "\n".join(line for line in lines if len(line) >= 2)[:1000]


def client_ip(request: Request) -> str:
    candidates = [
        request.headers.get("x-real-ip", ""),
        request.headers.get("x-vercel-forwarded-for", ""),
        request.headers.get("x-forwarded-for", ""),
        request.client.host if request.client else "",
    ]
    for candidate in candidates:
        raw = candidate.split(",", 1)[0].strip().strip("[]")
        try:
            address = ipaddress.ip_address(raw)
            if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
                return str(address.ipv4_mapped)
            return str(address)
        except ValueError:
            continue
    return ""


def network_for_ip(value: str) -> str:
    try:
        address = ipaddress.ip_address(value)
    except ValueError as exc:
        raise HTTPException(422, "Veřejnou IP této sítě se nepodařilo zjistit.") from exc
    prefix = 32 if isinstance(address, ipaddress.IPv4Address) else 64
    return str(ipaddress.ip_network(f"{address}/{prefix}", strict=False))


def venue_settings() -> dict:
    if USE_SUPABASE:
        result = settings_rpc("get")
        if not isinstance(result, dict):
            raise HTTPException(503, "Profil provozovny není dostupný.")
        return result
    with connection() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO venue_settings(venue_key,business_name,menu_text,updated_at)
            VALUES(?,?,?,?)
            """,
            (VENUE_KEY, BAR_NAME, DEFAULT_MENU_TEXT, now()),
        )
        row = conn.execute(
            "SELECT * FROM venue_settings WHERE venue_key=?", (VENUE_KEY,)
        ).fetchone()
        conn.commit()
    result = dict(row)
    if isinstance(result.get("features"), str):
        result["features"] = json.loads(result["features"])
    result["autodj_enabled"] = bool(result.get("autodj_enabled", True))
    result["autodj_playlists"] = normalize_autodj_playlists(result.get("autodj_playlists"))
    result["is_active"] = bool(result.get("is_active", True))
    return result


def allowed_venue_network(refresh: bool = False) -> str:
    if not refresh and float(NETWORK_CACHE.get("expires", 0)) > time.monotonic():
        return str(NETWORK_CACHE.get("allowed", ""))
    profile = venue_settings()
    allowed = str(profile.get("allowed_network") or "")
    NETWORK_CACHE.update(expires=time.monotonic() + 10, allowed=allowed)
    return allowed


def network_matches(request: Request, allowed: str | None = None) -> bool:
    allowed = allowed if allowed is not None else allowed_venue_network()
    if not allowed:
        return True
    try:
        return ipaddress.ip_address(client_ip(request)) in ipaddress.ip_network(allowed, strict=False)
    except ValueError:
        return False


def network_status(request: Request, refresh: bool = False) -> dict:
    allowed = allowed_venue_network(refresh=refresh)
    current = client_ip(request)
    return {
        "enabled": bool(allowed),
        "allowed_network": allowed,
        "current_ip": current,
        "current_matches": network_matches(request, allowed),
    }


def update_network_lock(action: str, request: Request) -> dict:
    allowed = network_for_ip(client_ip(request)) if action == "capture" else ""
    if USE_SUPABASE:
        result = settings_rpc("network_update", {"allowed_network": allowed})
        if not isinstance(result, dict):
            raise HTTPException(503, "Síť baru se nepodařilo uložit.")
    else:
        with connection() as conn:
            conn.execute(
                "UPDATE venue_settings SET allowed_network=?, revision=revision+1, updated_at=? WHERE venue_key=?",
                (allowed, now(), VENUE_KEY),
            )
            conn.commit()
    NETWORK_CACHE.update(expires=0.0, allowed="")
    return network_status(request, refresh=True)


def update_venue_settings(payload: VenueSettingsUpdate) -> dict:
    business_name = clean_text(payload.business_name, 80)
    menu_text = clean_menu(payload.menu_text)
    autodj_playlists = normalize_autodj_playlists(payload.autodj_playlists)
    autodj_custom_queries = clean_autodj_queries(payload.autodj_custom_queries)
    if len(business_name) < 2:
        raise HTTPException(422, "Název podniku je příliš krátký.")
    if payload.autodj_enabled and not autodj_playlists and not autodj_custom_queries:
        raise HTTPException(422, "Pro AutoDJ vyber alespoň jeden playlist nebo přidej vlastní téma.")
    if USE_SUPABASE:
        result = settings_rpc(
            "update",
            {
                "business_name": business_name,
                "tv_mode": payload.tv_mode,
                "menu_text": menu_text,
                "transition_mode": payload.transition_mode,
                "transition_volume": payload.transition_volume,
                "autodj_enabled": payload.autodj_enabled,
                "autodj_playlists": autodj_playlists,
                "autodj_custom_queries": autodj_custom_queries,
                "audio_mode": payload.audio_mode,
                "target_lufs": payload.target_lufs,
                "limiter_ceiling_db": payload.limiter_ceiling_db,
                "bass_guard_strength": payload.bass_guard_strength,
            },
        )
        if not isinstance(result, dict):
            raise HTTPException(503, "Nastavení se nepodařilo uložit.")
        return result
    with connection() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO venue_settings(venue_key,business_name,menu_text,updated_at)
            VALUES(?,?,?,?)
            """,
            (VENUE_KEY, BAR_NAME, DEFAULT_MENU_TEXT, now()),
        )
        conn.execute(
            """
            UPDATE venue_settings
            SET business_name=?, tv_mode=?, menu_text=?, transition_mode=?, transition_volume=?,
                autodj_enabled=?, autodj_playlists=?, autodj_custom_queries=?, audio_mode=?, target_lufs=?,
                limiter_ceiling_db=?, bass_guard_strength=?, revision=revision+1, updated_at=?
            WHERE venue_key=?
            """,
            (
                business_name,
                payload.tv_mode,
                menu_text,
                payload.transition_mode,
                payload.transition_volume,
                int(payload.autodj_enabled),
                json.dumps(autodj_playlists, ensure_ascii=False, separators=(",", ":")),
                autodj_custom_queries,
                payload.audio_mode,
                payload.target_lufs,
                payload.limiter_ceiling_db,
                payload.bass_guard_strength,
                now(),
                VENUE_KEY,
            ),
        )
        row = conn.execute(
            "SELECT * FROM venue_settings WHERE venue_key=?", (VENUE_KEY,)
        ).fetchone()
        conn.commit()
    result = dict(row)
    if isinstance(result.get("features"), str):
        result["features"] = json.loads(result["features"])
    result["autodj_enabled"] = bool(result.get("autodj_enabled", True))
    result["autodj_playlists"] = normalize_autodj_playlists(result.get("autodj_playlists"))
    result["is_active"] = bool(result.get("is_active", True))
    return result


def audio_processor_status() -> dict:
    if USE_SUPABASE:
        result = settings_rpc("processor_status")
        if not isinstance(result, dict):
            result = {}
    else:
        with connection() as conn:
            row = conn.execute(
                "SELECT * FROM audio_processors WHERE venue_key=?", (VENUE_KEY,)
            ).fetchone()
        result = dict(row) if row else {}
    last_seen = int(result.get("last_seen") or 0)
    connected = last_seen > 0 and now() - last_seen <= 18
    return {
        "connected": connected,
        "status": "Aktivní na Windows" if connected else "Čeká na Windows modul",
        "device_name": result.get("device_name", ""),
        "extension_version": result.get("extension_version", ""),
        "measured_lufs": result.get("measured_lufs"),
        "gain_db": float(result.get("gain_db") or 0),
        "bass_reduction_db": float(result.get("bass_reduction_db") or 0),
        "limiter_reduction_db": float(result.get("limiter_reduction_db") or 0),
        "last_seen": last_seen,
    }


def record_audio_heartbeat(payload: AudioProcessorHeartbeat) -> dict:
    values = {
        "device_name": clean_text(payload.device_name, 80),
        "extension_version": clean_text(payload.extension_version, 24),
        "measured_lufs": payload.measured_lufs,
        "gain_db": round(payload.gain_db, 2),
        "bass_reduction_db": round(payload.bass_reduction_db, 2),
        "limiter_reduction_db": round(payload.limiter_reduction_db, 2),
    }
    if USE_SUPABASE:
        result = settings_rpc("processor_heartbeat", values)
        if not isinstance(result, dict):
            raise HTTPException(503, "Stav zvukového procesoru se nepodařilo uložit.")
    else:
        with connection() as conn:
            conn.execute(
                """
                INSERT INTO audio_processors(
                    venue_key,device_name,extension_version,measured_lufs,gain_db,
                    bass_reduction_db,limiter_reduction_db,last_seen
                ) VALUES(?,?,?,?,?,?,?,?)
                ON CONFLICT(venue_key) DO UPDATE SET
                    device_name=excluded.device_name,
                    extension_version=excluded.extension_version,
                    measured_lufs=excluded.measured_lufs,
                    gain_db=excluded.gain_db,
                    bass_reduction_db=excluded.bass_reduction_db,
                    limiter_reduction_db=excluded.limiter_reduction_db,
                    last_seen=excluded.last_seen
                """,
                (
                    VENUE_KEY,
                    values["device_name"],
                    values["extension_version"],
                    values["measured_lufs"],
                    values["gain_db"],
                    values["bass_reduction_db"],
                    values["limiter_reduction_db"],
                    now(),
                ),
            )
            conn.commit()
    return audio_processor_status()


def make_token(kind: str, subject: str) -> str:
    payload = f"{kind}|{subject}|{now()}".encode("utf-8")
    signature = hmac.new(SECRET_KEY, payload, hashlib.sha256).digest()
    payload_part = base64.urlsafe_b64encode(payload).decode("ascii")
    signature_part = base64.urlsafe_b64encode(signature).decode("ascii")
    return f"{payload_part}.{signature_part}"


def read_token(token: str | None, kind: str, max_age: int) -> str | None:
    if not token:
        return None
    try:
        payload_part, signature_part = token.split(".", 1)
        payload = base64.urlsafe_b64decode(payload_part.encode("ascii"))
        signature = base64.urlsafe_b64decode(signature_part.encode("ascii"))
        expected = hmac.new(SECRET_KEY, payload, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            return None
        token_kind, subject, issued = payload.decode("utf-8").split("|", 2)
        if token_kind != kind or now() - int(issued) > max_age:
            return None
        return subject
    except (ValueError, TypeError, UnicodeDecodeError):
        return None


def is_admin(request: Request) -> bool:
    return read_token(request.cookies.get("jukebox_admin"), "admin", 12 * 3600) == "admin"


def require_admin(request: Request) -> None:
    if not is_admin(request):
        raise HTTPException(401, "Nejdřív zadej admin PIN.")


def guest_id(request: Request) -> str | None:
    if is_admin(request):
        return "admin"
    return read_token(request.cookies.get("jukebox_guest"), "guest", 180 * 24 * 3600)


def require_guest(request: Request) -> str:
    if not is_admin(request) and not network_matches(request):
        raise HTTPException(403, "Připoj se k Wi‑Fi tohoto podniku.")
    identity = guest_id(request)
    if not identity:
        raise HTTPException(401, "Otevři jukebox přes QR kód v baru.")
    return identity


def cookie_secure(request: Request) -> bool:
    forwarded = request.headers.get("x-forwarded-proto", "")
    return COOKIE_SECURE or request.url.scheme == "https" or forwarded == "https"


def set_guest_cookie(response: Response, request: Request) -> None:
    identity = secrets.token_urlsafe(18)
    response.set_cookie(
        "jukebox_guest",
        make_token("guest", identity),
        max_age=180 * 24 * 3600,
        httponly=True,
        secure=cookie_secure(request),
        samesite="lax",
    )


def extract_video_id(value: str) -> str | None:
    value = value.strip()
    if VIDEO_ID_RE.fullmatch(value):
        return value
    try:
        parsed = urlparse(value if "://" in value else f"https://{value}")
        host = parsed.netloc.lower().removeprefix("www.")
        if host == "youtu.be":
            candidate = parsed.path.strip("/").split("/")[0]
        elif host in {"youtube.com", "m.youtube.com", "music.youtube.com"}:
            if parsed.path == "/watch":
                candidate = parse_qs(parsed.query).get("v", [""])[0]
            elif parsed.path.startswith(("/shorts/", "/embed/", "/live/")):
                candidate = parsed.path.strip("/").split("/")[1]
            else:
                candidate = ""
        else:
            candidate = ""
        return candidate if VIDEO_ID_RE.fullmatch(candidate) else None
    except (ValueError, IndexError):
        return None


def queue_rows(request: Request | None = None) -> list[dict]:
    voter = guest_id(request) if request else None
    if USE_SUPABASE:
        result = db_rpc("queue_list", {"voter_id": voter or ""})
        return result if isinstance(result, list) else []
    with connection() as conn:
        rows = conn.execute(
            """
            SELECT q.id, q.video_id, q.title, q.artist, q.thumbnail, q.requested_by,
                   q.votes, q.priority, q.priority_requested, q.status, q.created_at,
                   CASE WHEN v.id IS NULL THEN 0 ELSE 1 END AS voted_by_me,
                   CASE WHEN q.requester_id=? THEN 1 ELSE 0 END AS requested_by_me,
                   CASE WHEN q.requester_id='autodj' THEN 1 ELSE 0 END AS is_autodj
            FROM queue q
            LEFT JOIN votes v ON v.queue_id=q.id AND v.voter_id=?
            WHERE q.status IN ('playing','queued')
            ORDER BY CASE WHEN q.status='playing' THEN 0 ELSE 1 END,
                     q.priority DESC, q.votes DESC, q.id ASC
            """,
            (voter or "", voter or ""),
        ).fetchall()
    return [dict(row) for row in rows]


def current_song(conn: sqlite3.Connection) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM queue WHERE status='playing' LIMIT 1").fetchone()


def bump_player(conn: sqlite3.Connection, action: str) -> None:
    conn.execute(
        "UPDATE player_state SET revision=revision+1, action=?, updated_at=? WHERE id=1",
        (action, now()),
    )


def advance_queue() -> dict | None:
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        timestamp = now()
        conn.execute(
            "UPDATE queue SET status='done', finished_at=? WHERE status='playing'",
            (timestamp,),
        )
        next_row = conn.execute(
            """
            SELECT id FROM queue WHERE status='queued'
            ORDER BY priority DESC, votes DESC, id ASC LIMIT 1
            """
        ).fetchone()
        if next_row:
            conn.execute(
                "UPDATE queue SET status='playing', started_at=? WHERE id=?",
                (timestamp, next_row["id"]),
            )
        bump_player(conn, "load")
        conn.commit()
        return (
            dict(conn.execute("SELECT * FROM queue WHERE id=?", (next_row["id"],)).fetchone())
            if next_row
            else None
        )


def autodj_status() -> dict:
    if USE_SUPABASE:
        result = supabase_rpc("jukebox_autodj_rpc", "status")
        return result if isinstance(result, dict) else {}
    with connection() as conn:
        prepared = conn.execute(
            "SELECT * FROM queue WHERE status='queued' AND requester_id='autodj' ORDER BY id LIMIT 1"
        ).fetchone()
        completed = conn.execute(
            "SELECT COUNT(*) AS n FROM queue WHERE requester_id='autodj' AND status='done'"
        ).fetchone()["n"]
        recent = conn.execute(
            "SELECT video_id FROM queue WHERE status IN ('playing','queued','done') ORDER BY id DESC LIMIT 30"
        ).fetchall()
    return {
        "prepared": bool(prepared),
        "song": dict(prepared) if prepared else None,
        "completed": int(completed),
        "recent_video_ids": [row["video_id"] for row in recent],
    }


def clear_autodj_buffer() -> dict:
    if USE_SUPABASE:
        result = supabase_rpc("jukebox_autodj_rpc", "clear")
        return result if isinstance(result, dict) else {"ok": True}
    with connection() as conn:
        removed = conn.execute(
            "UPDATE queue SET status='removed', finished_at=? WHERE status='queued' AND requester_id='autodj'",
            (now(),),
        ).rowcount
        conn.commit()
    return {"ok": True, "removed": removed}


def insert_autodj_candidate(song: dict, playlist_label: str) -> dict:
    payload = {
        "video_id": song["video_id"],
        "title": clean_text(song.get("title", ""), 160),
        "artist": clean_text(song.get("artist", ""), 100),
        "thumbnail": song.get("thumbnail", "") if str(song.get("thumbnail", "")).startswith("https://") else "",
        "playlist_label": clean_text(playlist_label, 26),
    }
    if USE_SUPABASE:
        result = supabase_rpc("jukebox_autodj_rpc", "prepare", payload)
        return result if isinstance(result, dict) else {"prepared": False}
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute(
            "SELECT * FROM queue WHERE status='queued' AND requester_id='autodj' ORDER BY id LIMIT 1"
        ).fetchone()
        if existing:
            conn.commit()
            return {"prepared": True, "song": dict(existing), "existing": True}
        duplicate = conn.execute(
            """
            SELECT id FROM queue
            WHERE video_id=? AND id IN (
                SELECT id FROM queue WHERE status IN ('playing','queued','done') ORDER BY id DESC LIMIT 30
            ) LIMIT 1
            """,
            (payload["video_id"],),
        ).fetchone()
        if duplicate:
            conn.commit()
            return {"prepared": False, "reason": "recent"}
        cursor = conn.execute(
            """
            INSERT INTO queue(
                video_id,title,artist,thumbnail,requested_by,requester_id,priority,created_at
            ) VALUES(?,?,?,?,?,'autodj',-100,?)
            """,
            (
                payload["video_id"],
                payload["title"],
                payload["artist"],
                payload["thumbnail"],
                f"AutoDJ · {payload['playlist_label']}",
                now(),
            ),
        )
        row = dict(conn.execute("SELECT * FROM queue WHERE id=?", (cursor.lastrowid,)).fetchone())
        conn.commit()
    row.pop("requester_id", None)
    return {"prepared": True, "song": row, "existing": False}


def autodj_program(profile: dict, completed: int) -> tuple[str, str] | None:
    programs = []
    selected = normalize_autodj_playlists(profile.get("autodj_playlists"))
    for key in selected:
        definition = AUTO_DJ_PLAYLISTS[key]
        queries = definition["queries"]
        query_index = (completed // max(1, len(selected))) % len(queries)
        programs.append((definition["label"], queries[query_index]))
    for query in clean_autodj_queries(str(profile.get("autodj_custom_queries", ""))).splitlines():
        programs.append(("Vlastní mix", f"{query} music official"))
    if not programs:
        return None
    return programs[completed % len(programs)]


def public_base(request: Request) -> str:
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL
    forwarded_proto = request.headers.get("x-forwarded-proto")
    forwarded_host = request.headers.get("x-forwarded-host")
    if forwarded_host:
        return f"{forwarded_proto or request.url.scheme}://{forwarded_host}"
    return str(request.base_url).rstrip("/")


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    return RedirectResponse("/guest", status_code=302)


@app.get("/guest", include_in_schema=False)
def guest_page(request: Request, code: str = ""):
    if not is_admin(request) and not network_matches(request):
        return FileResponse(STATIC / "network.html", status_code=403)
    authorized = guest_id(request) is not None
    if not authorized and not hmac.compare_digest(code, JOIN_CODE):
        return FileResponse(STATIC / "join.html")
    response = FileResponse(STATIC / "guest.html")
    if not authorized:
        set_guest_cookie(response, request)
    return response


@app.get("/admin", include_in_schema=False)
def admin_page():
    return FileResponse(STATIC / "admin.html")


@app.get("/tv", include_in_schema=False)
def tv_page():
    return FileResponse(STATIC / "tv.html")


@app.get("/health")
def health():
    if USE_SUPABASE:
        result = db_rpc("health")
        return {**result, "version": app.version}
    with connection() as conn:
        conn.execute("SELECT 1").fetchone()
    return {"status": "ok", "version": app.version}


@app.get("/api/config")
def config():
    profile = venue_settings()
    return {
        "bar_name": profile["business_name"],
        "priority_price_czk": PRIORITY_PRICE_CZK,
        "max_active_per_guest": MAX_ACTIVE_PER_GUEST,
        "search_enabled": True,
        "official_youtube_search": bool(YOUTUBE_API_KEY),
    }


@app.get("/api/display")
def display_settings():
    profile = venue_settings()
    if not profile.get("is_active", True):
        raise HTTPException(403, "Provozovna není aktivní.")
    return {
        "business_name": profile["business_name"],
        "tv_mode": profile["tv_mode"],
        "menu_text": profile.get("menu_text", ""),
        "transition_mode": profile.get("transition_mode", "scratch"),
        "transition_volume": int(profile.get("transition_volume", 55)),
        "autodj_enabled": bool(profile.get("autodj_enabled", True)),
        "autodj_playlists": normalize_autodj_playlists(profile.get("autodj_playlists")),
        "autodj_custom_queries": profile.get("autodj_custom_queries", ""),
        "audio_mode": profile.get("audio_mode", "standard"),
        "target_lufs": int(profile.get("target_lufs", -16)),
        "limiter_ceiling_db": float(profile.get("limiter_ceiling_db", -1.0)),
        "bass_guard_strength": int(profile.get("bass_guard_strength", 65)),
        "revision": profile.get("revision", 0),
    }


@app.get("/api/me")
def me(request: Request):
    admin = is_admin(request)
    allowed = admin or network_matches(request)
    return {"guest": allowed and guest_id(request) is not None, "admin": admin, "network_allowed": allowed}


@app.post("/api/admin/login")
def admin_login(payload: PinLogin, request: Request, response: Response):
    client = client_ip(request) or "unknown"
    cutoff = time.time() - 300
    failures = [stamp for stamp in LOGIN_FAILURES.get(client, []) if stamp > cutoff]
    if len(failures) >= 6:
        raise HTTPException(429, "Příliš mnoho pokusů. Zkus to za 5 minut.")
    if not hmac.compare_digest(payload.pin, ADMIN_PIN):
        failures.append(time.time())
        LOGIN_FAILURES[client] = failures
        raise HTTPException(401, "Nesprávný PIN.")
    LOGIN_FAILURES.pop(client, None)
    response.set_cookie(
        "jukebox_admin",
        make_token("admin", "admin"),
        max_age=12 * 3600,
        httponly=True,
        secure=cookie_secure(request),
        samesite="strict",
    )
    return {"ok": True}


@app.post("/api/admin/logout")
def admin_logout(response: Response):
    response.delete_cookie("jukebox_admin")
    return {"ok": True}


@app.get("/api/admin/config")
def admin_config(request: Request):
    require_admin(request)
    profile = venue_settings()
    join_url = f"{public_base(request)}/guest?code={quote(JOIN_CODE)}"
    return {
        "bar_name": profile["business_name"],
        "business_name": profile["business_name"],
        "tv_mode": profile["tv_mode"],
        "menu_text": profile.get("menu_text", ""),
        "transition_mode": profile.get("transition_mode", "scratch"),
        "transition_volume": int(profile.get("transition_volume", 55)),
        "autodj_enabled": bool(profile.get("autodj_enabled", True)),
        "autodj_playlists": normalize_autodj_playlists(profile.get("autodj_playlists")),
        "autodj_custom_queries": profile.get("autodj_custom_queries", ""),
        "plan": profile.get("plan", "pilot"),
        "features": profile.get("features", {}),
        "is_active": bool(profile.get("is_active", True)),
        "audio_mode": profile.get("audio_mode", "standard"),
        "target_lufs": int(profile.get("target_lufs", -16)),
        "limiter_ceiling_db": float(profile.get("limiter_ceiling_db", -1.0)),
        "bass_guard_strength": int(profile.get("bass_guard_strength", 65)),
        "audio_processor": audio_processor_status(),
        "network_lock": network_status(request),
        "join_url": join_url,
        "priority_price_czk": PRIORITY_PRICE_CZK,
        "night_volume": NIGHT_VOLUME,
        "search_provider": "YouTube Data API" if YOUTUBE_API_KEY else "automatický záložní vyhledávač",
        "production_secrets_ready": SECRET_KEY != b"dev-only-change-me" and ADMIN_PIN != "2673",
    }


@app.put("/api/admin/display")
def save_display_settings(payload: VenueSettingsUpdate, request: Request):
    require_admin(request)
    saved = update_venue_settings(payload)
    if not payload.autodj_enabled:
        clear_autodj_buffer()
    return saved


@app.get("/api/admin/audio/status")
def get_audio_processor_status(request: Request):
    require_admin(request)
    return audio_processor_status()


@app.post("/api/admin/audio/heartbeat")
def audio_processor_heartbeat(payload: AudioProcessorHeartbeat, request: Request):
    require_admin(request)
    return record_audio_heartbeat(payload)


@app.put("/api/admin/network")
def save_network_lock(payload: NetworkLockUpdate, request: Request):
    require_admin(request)
    return update_network_lock(payload.action, request)


@app.get("/api/admin/qr.svg")
def admin_qr(request: Request):
    require_admin(request)
    join_url = f"{public_base(request)}/guest?code={quote(JOIN_CODE)}"
    factory = qrcode.image.svg.SvgPathImage
    image = qrcode.make(join_url, image_factory=factory, box_size=12, border=2)
    output = io.BytesIO()
    image.save(output)
    return Response(output.getvalue(), media_type="image/svg+xml")


@app.get("/api/queue")
def get_queue(request: Request):
    if not is_admin(request) and not network_matches(request):
        raise HTTPException(403, "Připoj se k Wi‑Fi tohoto podniku.")
    return queue_rows(request)


@app.post("/api/queue", status_code=201)
def add_to_queue(song: Song, request: Request):
    requester = require_guest(request)
    video_id = extract_video_id(song.video_id)
    if not video_id:
        raise HTTPException(422, "Neplatné YouTube video.")
    title = clean_text(song.title, 160)
    if not title:
        raise HTTPException(422, "Chybí název skladby.")
    artist = clean_text(song.artist, 100)
    requested_by = clean_text(song.requested_by, 40)
    thumbnail = song.thumbnail if song.thumbnail.startswith("https://") else ""

    if USE_SUPABASE:
        return db_rpc(
            "add_song",
            {
                "requester_id": requester,
                "video_id": video_id,
                "title": title,
                "artist": artist,
                "thumbnail": thumbnail,
                "requested_by": requested_by,
                "max_queue": MAX_QUEUE_LENGTH,
                "max_guest": MAX_ACTIVE_PER_GUEST,
            },
        )

    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        active_count = conn.execute(
            "SELECT COUNT(*) AS n FROM queue WHERE status IN ('playing','queued')"
        ).fetchone()["n"]
        if active_count >= MAX_QUEUE_LENGTH:
            raise HTTPException(409, "Fronta je teď plná.")
        duplicate = conn.execute(
            "SELECT id FROM queue WHERE video_id=? AND status IN ('playing','queued') LIMIT 1",
            (video_id,),
        ).fetchone()
        if duplicate:
            raise HTTPException(409, f"Tahle skladba už ve frontě je (#{duplicate['id']}).")
        if requester != "admin":
            own_count = conn.execute(
                "SELECT COUNT(*) AS n FROM queue WHERE requester_id=? AND status IN ('playing','queued')",
                (requester,),
            ).fetchone()["n"]
            if own_count >= MAX_ACTIVE_PER_GUEST:
                raise HTTPException(
                    429,
                    f"Máš už {MAX_ACTIVE_PER_GUEST} skladby ve frontě. Nech prostor i ostatním.",
                )
        cursor = conn.execute(
            """
            INSERT INTO queue(video_id,title,artist,thumbnail,requested_by,requester_id,created_at)
            VALUES(?,?,?,?,?,?,?)
            """,
            (video_id, title, artist, thumbnail, requested_by, requester, now()),
        )
        row = dict(conn.execute("SELECT * FROM queue WHERE id=?", (cursor.lastrowid,)).fetchone())
        conn.commit()
    row.pop("requester_id", None)
    row["requested_by_me"] = 1
    row["voted_by_me"] = 0
    return row


@app.post("/api/queue/{song_id}/vote")
def vote(song_id: int, request: Request):
    voter = require_guest(request)
    public_song = next((song for song in queue_rows(request) if song["id"] == song_id), None)
    if public_song and str(public_song.get("requested_by", "")).startswith("AutoDJ"):
        raise HTTPException(409, "AutoDJ zásoba se nehlasuje; vlastní skladba ji vždy předběhne.")
    if USE_SUPABASE:
        return db_rpc("vote", {"song_id": song_id, "voter_id": voter})
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        song = conn.execute(
            "SELECT id FROM queue WHERE id=? AND status='queued'", (song_id,)
        ).fetchone()
        if not song:
            raise HTTPException(404, "Skladba už není ve frontě.")
        try:
            conn.execute(
                "INSERT INTO votes(queue_id,voter_id,created_at) VALUES(?,?,?)",
                (song_id, voter, now()),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Pro tuhle skladbu už jsi hlasoval.")
        conn.execute("UPDATE queue SET votes=votes+1 WHERE id=?", (song_id,))
        conn.commit()
    return {"ok": True}


@app.post("/api/queue/{song_id}/priority")
def priority(song_id: int, request: Request):
    require_admin(request)
    if USE_SUPABASE:
        return db_rpc("priority", {"song_id": song_id})
    with connection() as conn:
        changed = conn.execute(
            """
            UPDATE queue SET priority=priority+1, priority_requested=0
            WHERE id=? AND status='queued'
            """,
            (song_id,),
        ).rowcount
        if not changed:
            raise HTTPException(404, "Skladba už není ve frontě.")
        bump_player(conn, "sync")
        conn.commit()
    return {"ok": True}


@app.post("/api/queue/{song_id}/priority-request")
def request_priority(song_id: int, request: Request):
    requester = require_guest(request)
    if requester == "admin":
        raise HTTPException(400, "Admin může přednost potvrdit rovnou.")
    if USE_SUPABASE:
        db_rpc("priority_request", {"song_id": song_id, "requester_id": requester})
        return {"ok": True, "message": f"Zaplať {PRIORITY_PRICE_CZK} Kč u baru. Obsluha pak přednost potvrdí."}
    with connection() as conn:
        changed = conn.execute(
            """
            UPDATE queue SET priority_requested=1
            WHERE id=? AND requester_id=? AND status='queued' AND priority=0
            """,
            (song_id, requester),
        ).rowcount
        if not changed:
            raise HTTPException(404, "Přednost lze vyžádat jen pro vlastní skladbu ve frontě.")
        conn.commit()
    return {"ok": True, "message": f"Zaplať {PRIORITY_PRICE_CZK} Kč u baru. Obsluha pak přednost potvrdí."}


@app.post("/api/queue/{song_id}/play")
def play(song_id: int, request: Request):
    require_admin(request)
    if USE_SUPABASE:
        return db_rpc("play", {"song_id": song_id})
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        selected = conn.execute(
            "SELECT id FROM queue WHERE id=? AND status IN ('queued','playing')", (song_id,)
        ).fetchone()
        if not selected:
            raise HTTPException(404, "Skladba už není ve frontě.")
        conn.execute("UPDATE queue SET status='queued', started_at=NULL WHERE status='playing'")
        conn.execute(
            "UPDATE queue SET status='playing', started_at=? WHERE id=?", (now(), song_id)
        )
        bump_player(conn, "load")
        conn.commit()
    return {"ok": True}


@app.delete("/api/queue/{song_id}")
def remove_song(song_id: int, request: Request):
    require_admin(request)
    if USE_SUPABASE:
        return db_rpc("remove", {"song_id": song_id})
    with connection() as conn:
        existing = conn.execute("SELECT status FROM queue WHERE id=?", (song_id,)).fetchone()
        if not existing or existing["status"] not in {"queued", "playing"}:
            raise HTTPException(404, "Skladba už není ve frontě.")
        conn.execute(
            "UPDATE queue SET status='removed', finished_at=? WHERE id=?", (now(), song_id)
        )
        if existing["status"] == "playing":
            bump_player(conn, "load")
        conn.commit()
    if existing["status"] == "playing":
        advance_queue()
    return {"ok": True}


@app.post("/api/player/start")
def player_start(request: Request):
    require_admin(request)
    if USE_SUPABASE:
        return db_rpc("player_start")
    with connection() as conn:
        playing = current_song(conn)
    if playing:
        return {"ok": True, "song": dict(playing)}
    return {"ok": True, "song": advance_queue()}


@app.post("/api/player/next")
def player_next(request: Request):
    require_admin(request)
    if USE_SUPABASE:
        return db_rpc("player_next")
    return {"ok": True, "song": advance_queue()}


@app.post("/api/player/ended")
def player_ended(request: Request):
    require_admin(request)
    if USE_SUPABASE:
        return db_rpc("player_ended")
    return {"ok": True, "song": advance_queue()}


@app.post("/api/player/autodj/prepare")
def prepare_autodj(request: Request):
    require_admin(request)
    profile = venue_settings()
    if not bool(profile.get("autodj_enabled", True)):
        clear_autodj_buffer()
        return {"enabled": False, "prepared": False}

    status = autodj_status()
    if status.get("prepared"):
        return {"enabled": True, **status}
    completed = int(status.get("completed", 0))
    program = autodj_program(profile, completed)
    if not program:
        return {"enabled": True, "prepared": False, "reason": "no_playlist"}
    playlist_label, query = program
    results, provider = search_youtube_catalog(query, 10, fallback_first=True)
    recent = set(status.get("recent_video_ids") or [])
    for song in results:
        if song.get("video_id") in recent:
            continue
        prepared = insert_autodj_candidate(song, playlist_label)
        if prepared.get("prepared"):
            return {
                "enabled": True,
                "playlist": playlist_label,
                "provider": provider,
                **prepared,
            }
    return {"enabled": True, "prepared": False, "reason": "no_fresh_track"}


@app.get("/api/player/state")
def get_player_state(request: Request):
    require_admin(request)
    if USE_SUPABASE:
        return db_rpc("player_state")
    with connection() as conn:
        state = dict(conn.execute("SELECT * FROM player_state WHERE id=1").fetchone())
        playing = current_song(conn)
    state["now_playing"] = dict(playing) if playing else None
    return state


@app.post("/api/player/control")
def player_control(payload: PlayerControl, request: Request):
    require_admin(request)
    if USE_SUPABASE:
        if payload.action == "volume" and (
            not isinstance(payload.value, int) or isinstance(payload.value, bool)
        ):
            raise HTTPException(422, "Hlasitost musí být číslo 0–100.")
        return db_rpc(
            "player_control",
            {"command": payload.action, "value": payload.value},
        )
    with connection() as conn:
        if payload.action == "volume":
            if not isinstance(payload.value, int) or isinstance(payload.value, bool):
                raise HTTPException(422, "Hlasitost musí být číslo 0–100.")
            volume = min(100, max(0, payload.value))
            conn.execute(
                "UPDATE player_state SET volume=?, revision=revision+1, action='volume', updated_at=? WHERE id=1",
                (volume, now()),
            )
        elif payload.action == "night":
            night = 1 if bool(payload.value) else 0
            conn.execute(
                "UPDATE player_state SET night_mode=?, revision=revision+1, action='night', updated_at=? WHERE id=1",
                (night, now()),
            )
        else:
            bump_player(conn, payload.action)
        conn.commit()
        state = dict(conn.execute("SELECT * FROM player_state WHERE id=1").fetchone())
    return state


@app.get("/api/videos/resolve")
def resolve_video(request: Request, url: str = Query(min_length=1, max_length=500)):
    require_guest(request)
    video_id = extract_video_id(url)
    if not video_id:
        raise HTTPException(422, "Vlož platný odkaz na YouTube.")
    try:
        response = httpx.get(
            "https://www.youtube.com/oembed",
            params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"},
            timeout=8,
        )
        response.raise_for_status()
        data = response.json()
        return {
            "video_id": video_id,
            "title": clean_text(data.get("title", video_id), 160),
            "artist": clean_text(data.get("author_name", ""), 100),
            "thumbnail": data.get("thumbnail_url", ""),
        }
    except (httpx.HTTPError, ValueError):
        return {
            "video_id": video_id,
            "title": video_id,
            "artist": "",
            "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        }


def official_youtube_search(query: str, limit: int) -> list[dict]:
    response = httpx.get(
        "https://www.googleapis.com/youtube/v3/search",
        params={
            "part": "snippet",
            "q": query,
            "type": "video",
            "maxResults": limit,
            "safeSearch": "moderate",
            "videoEmbeddable": "true",
            "regionCode": "CZ",
            "relevanceLanguage": "cs",
            "key": YOUTUBE_API_KEY,
        },
        timeout=10,
    )
    response.raise_for_status()
    results = []
    for item in response.json().get("items", []):
        video_id = item.get("id", {}).get("videoId", "")
        snippet = item.get("snippet", {})
        if VIDEO_ID_RE.fullmatch(video_id):
            results.append(
                {
                    "video_id": video_id,
                    "title": clean_text(snippet.get("title", ""), 160),
                    "artist": clean_text(snippet.get("channelTitle", ""), 100),
                    "thumbnail": snippet.get("thumbnails", {}).get("medium", {}).get("url", ""),
                }
            )
    return results


def fallback_youtube_search(query: str, limit: int) -> list[dict]:
    # Metadata-only search: yt-dlp does not download the audio or video.
    from yt_dlp import YoutubeDL

    options = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": "in_playlist",
        "socket_timeout": 10,
        "noplaylist": True,
    }
    with YoutubeDL(options) as ydl:
        data = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
    results = []
    for item in (data or {}).get("entries", []):
        video_id = str(item.get("id", ""))
        if not VIDEO_ID_RE.fullmatch(video_id):
            continue
        thumbnail = item.get("thumbnail") or f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"
        results.append(
            {
                "video_id": video_id,
                "title": clean_text(item.get("title", video_id), 160),
                "artist": clean_text(item.get("channel") or item.get("uploader") or "", 100),
                "thumbnail": thumbnail if str(thumbnail).startswith("https://") else "",
            }
        )
    return results


def search_youtube_catalog(query: str, limit: int, fallback_first: bool = False) -> tuple[list[dict], str]:
    cache_key = f"{'fallback' if fallback_first else 'official'}|{query.lower()}|{limit}"
    with SEARCH_LOCK:
        cached = SEARCH_CACHE.get(cache_key)
    if cached and cached[0] > time.time():
        return cached[1], "cache"

    results: list[dict] = []
    provider = "záložní vyhledávač"
    errors = []
    if fallback_first:
        try:
            results = fallback_youtube_search(query, limit)
        except Exception as exc:  # yt-dlp can change when YouTube changes upstream.
            errors.append(str(exc))
    if not results and YOUTUBE_API_KEY:
        try:
            results = official_youtube_search(query, limit)
            provider = "YouTube"
        except (httpx.HTTPError, ValueError) as exc:
            errors.append(str(exc))
    if not results and not fallback_first:
        try:
            results = fallback_youtube_search(query, limit)
        except Exception as exc:  # yt-dlp can change when YouTube changes upstream.
            errors.append(str(exc))
    if not results:
        if errors:
            raise HTTPException(503, "Vyhledávání YouTube je dočasně nedostupné.")
        raise HTTPException(404, "Pro tento dotaz jsem nenašel žádnou skladbu.")

    with SEARCH_LOCK:
        SEARCH_CACHE[cache_key] = (time.time() + 900, results)
        if len(SEARCH_CACHE) > 120:
            oldest = min(SEARCH_CACHE, key=lambda key: SEARCH_CACHE[key][0])
            SEARCH_CACHE.pop(oldest, None)
    return results, provider


@app.get("/api/search")
def search_videos(
    request: Request,
    q: str = Query(min_length=2, max_length=100),
    limit: int = Query(default=8, ge=1, le=10),
    mode: Literal["music", "karaoke"] = Query(default="music"),
):
    requester = require_guest(request)
    cutoff = time.time() - 60
    activity = [stamp for stamp in SEARCH_ACTIVITY.get(requester, []) if stamp > cutoff]
    if len(activity) >= 15:
        raise HTTPException(429, "Hledáš příliš rychle. Počkej chvíli.")
    activity.append(time.time())
    SEARCH_ACTIVITY[requester] = activity
    query = clean_text(q, 100)
    if mode == "karaoke":
        query = clean_text(f"{query} karaoke instrumental s textem", 100)
    results, provider = search_youtube_catalog(query, limit)
    return {"items": results, "provider": provider, "mode": mode}
