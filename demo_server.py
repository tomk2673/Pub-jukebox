"""Read-only sales demo using PR #7 assets. Never imports app.py or a live store.

Run: python -m uvicorn demo_server:app --host 0.0.0.0 --port 8000
The real module and its authenticated CRUD remain in app.py.
"""
from pathlib import Path
import io
import json

import qrcode
import qrcode.image.svg
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from advertising import CampaignInput

BASE = Path(__file__).resolve().parent
STATIC = BASE / "static"
DATA = json.loads((BASE / "demo_data.json").read_text())
CAMPAIGN = CampaignInput(**DATA["campaign"]).model_dump()
CAMPAIGN_ID = "d" * 32
app = FastAPI(title="PUB JUKEBOX · prodejní demo", docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def demo_boundary(request: Request, call_next):
    if request.method not in {"GET", "HEAD"}:
        response = JSONResponse({"detail": "Prodejní demo je pouze pro čtení. Zápisy, měření a ovládání hudby jsou vypnuté."}, status_code=405, headers={"Allow": "GET, HEAD"})
    else:
        response = await call_next(request)
    response.headers.update({
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
        "X-Robots-Tag": "noindex, nofollow",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
    })
    return response


# Only the presentation assets are mounted. There is no database, auth, player,
# YouTube request, production app mount, campaign activation or event endpoint.
app.mount("/static", StaticFiles(directory=STATIC), name="static")


def demo_html(filename, banner=False):
    html = (STATIC / filename).read_text()
    if banner:
        note = '<aside class="demo-banner demo-top"><strong>PRODEJNÍ DEMO · POUZE PRO ČTENÍ</strong><p>Fiktivní podnik a ceny. Hudba ani kampaně se zde neovládají.</p><a href="/menu">Otevřít nápojový lístek →</a> · <a href="/demo">Nabídka pro podnik</a></aside>'
        html = html.replace('<main class="shell', note + '<main class="shell', 1)
        html = html.replace('</head>', '<link rel="stylesheet" href="/static/advertising.css"></head>')
    # The isolated demo never installs the jukebox's production service worker.
    html = html.replace('<script src="/static/install.js" defer></script>', '')
    return HTMLResponse(html)


@app.get("/", include_in_schema=False)
def home():
    return RedirectResponse("/menu", status_code=302)


@app.get("/menu", include_in_schema=False)
def menu():
    return demo_html("menu.html")


@app.get("/guest", include_in_schema=False)
def guest():
    return demo_html("guest.html", banner=True)


@app.get("/demo", include_in_schema=False)
def offer():
    return demo_html("demo-offer.html")


@app.get("/demo/partner", include_in_schema=False)
def partner():
    return demo_html("demo-partner.html")


@app.get("/admin/ads", include_in_schema=False)
def admin_preview():
    return demo_html("ads-admin.html", banner=True)


@app.get("/admin", include_in_schema=False)
def admin_redirect():
    return RedirectResponse("/admin/ads", status_code=303)


@app.get("/api/menu")
def menu_data(preview: str = ""):
    if preview and preview != CAMPAIGN_ID:
        raise HTTPException(404, "Tento návrh v ukázce neexistuje.")
    return {"business_name": DATA["business_name"], "menu_text": DATA["menu_text"], "demo": True,
            "sponsor": {"id": CAMPAIGN_ID, **CAMPAIGN, "preview": True, "demo": True}}


@app.get("/api/admin/ads")
def admin_data():
    return {"menu_ready": True, "read_only": True, "demo": True,
            "campaigns": [{"id": CAMPAIGN_ID, **CAMPAIGN, "active": False, "impressions": 0, "clicks": 0}],
            "programmatic_enabled": False, "rewarded_enabled": False}


@app.get("/api/config")
def config():
    return {"bar_name": DATA["business_name"], "max_active_per_guest": 3,
            "search_enabled": False, "official_youtube_search": False, "demo": True}


@app.get("/api/me")
def me():
    return {"guest": True, "admin": False, "network_allowed": True, "demo": True}


@app.get("/api/queue")
def queue():
    return []


@app.get("/api/discover")
@app.get("/api/search")
def no_music_requests():
    return {"items": [], "reason": "no_playlist", "source": "prodejní demo", "autodj_enabled": False}


@app.get("/health")
def health():
    return {"status": "ok", "demo": True, "read_only": True, "database": "none", "measurement": False}


@app.get("/demo/qr.svg")
def qr(request: Request):
    # Server-provided origin only; never accept a user-selected QR destination.
    url = str(request.base_url).rstrip("/") + "/menu"
    image = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, border=4)
    buffer = io.BytesIO()
    image.save(buffer)
    return Response(buffer.getvalue(), media_type="image/svg+xml")
