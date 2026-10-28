"""Export the same read-only presentation for static hosting, with no API server."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from demo_server import DATA, demo_html, menu_data, admin_data, config, no_music_requests
from build_sales_preview import ASSETS
import qrcode
import qrcode.image.svg


def build(destination: Path, origin: str):
    destination.mkdir(parents=True, exist_ok=True)
    for route, filename, banner in [
        ('', 'menu.html', False), ('menu', 'menu.html', False),
        ('guest', 'guest.html', True), ('demo', 'demo-offer.html', False),
        ('demo/partner', 'demo-partner.html', False),
        ('admin/ads', 'ads-admin.html', True), ('admin', 'ads-admin.html', True),
    ]:
        path = destination / route / 'index.html'
        path.parent.mkdir(parents=True, exist_ok=True)
        html = demo_html(filename, banner=banner).body.decode()
        csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
        html = html.replace('</head>', '<meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="' + csp + '"></head>')
        path.write_text(html)
    (destination / 'static').mkdir(exist_ok=True)
    for name in ASSETS:
        content = (ROOT / 'static' / name).read_bytes()
        if name == 'menu.js':
            content = content.replace(b"'/api/menu'", b"'/demo-menu.json'")
        if name == 'ads-admin.js':
            content = content.replace(b"'/api/admin/ads'", b"'/demo-admin.json'")
        if name == 'guest.js':
            content = content.replace(b'fetch(path, {', b"fetch(path.startsWith('/api/config') ? '/demo-config.json' : path.startsWith('/api/queue') ? '/demo-queue.json' : '/demo-discover.json', {")
        (destination / 'static' / name).write_bytes(content)
    for name, value in [('demo-menu.json', menu_data()), ('demo-admin.json', admin_data()),
                        ('demo-config.json', config()), ('demo-queue.json', []),
                        ('demo-discover.json', no_music_requests())]:
        (destination / name).write_text(json.dumps(value, ensure_ascii=False) + '\n')
    qr = qrcode.make(origin.rstrip('/') + '/menu', image_factory=qrcode.image.svg.SvgPathImage, border=4)
    qr.save(destination / 'demo' / 'qr.svg')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('destination', type=Path)
    parser.add_argument('--origin', required=True)
    args = parser.parse_args()
    build(args.destination, args.origin)
