"""Export only the read-only demo; never include the live app or its settings."""
from pathlib import Path
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / '.demo-preview'
ASSETS = ('common.css', 'advertising.css', 'demo.css', 'guest.html', 'guest.js',
          'menu.html', 'menu.js', 'ads-admin.html', 'ads-admin.js',
          'demo-offer.html', 'demo-partner.html', 'manifest.webmanifest',
          'icon-180.png', 'icon-192.png', 'icon-512.png', 'app-icon.svg')


def build():
    if DEST.exists():
        shutil.rmtree(DEST)
    (DEST / 'static').mkdir(parents=True)
    # app.py in this exported directory is ONLY the read-only application.
    shutil.copy2(ROOT / 'demo_server.py', DEST / 'app.py')
    for filename in ('advertising.py', 'demo_data.json'):
        shutil.copy2(ROOT / filename, DEST / filename)
    for filename in ASSETS:
        shutil.copy2(ROOT / 'static' / filename, DEST / 'static' / filename)
    (DEST / 'requirements.txt').write_text('fastapi==0.116.1\nuvicorn==0.35.0\nqrcode==8.2\n')
    (DEST / 'vercel.json').write_text(json.dumps({
        '$schema': 'https://openapi.vercel.sh/vercel.json',
        'functions': {'app.py': {'maxDuration': 15}},
    }, indent=2) + '\n')
    return DEST


if __name__ == '__main__':
    print(build())
