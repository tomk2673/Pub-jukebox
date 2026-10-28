# Spuštění a hranice prodejního dema

Větev `demo/qr-menu-sales-20261028` vychází z aktuálního `main` (`1cabf44`)
a přebírá reklamní modul z PR #7 (`b4c4bdb`, hlava původního PR `9217c896`).
Konflikty odkazů byly vyřešeny při zachování současné administrace a hudby.
`static/guest.js`, `static/admin.js` a `static/tv.js` se proti tomuto `main` nemění.
Změna se neslučuje do `main` a neaplikuje migraci do produkce.

## Veřejná ukázka pouze pro čtení

```bash
python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m uvicorn demo_server:app --host 0.0.0.0 --port 8000
```

Na Windows použít `python -m uvicorn demo_server:app --port 8000` po aktivaci
vlastního virtuálního prostředí. Demo nečte `.env`, neimportuje `app.py`,
nevolá Supabase, YouTube ani platební službu a nevytváří databázi nebo cookies.
Všechna data pocházejí z `demo_data.json`; text reklamy se validuje existujícím
`advertising.CampaignInput` z PR #7.

- `/menu`: skutečné HTML/CSS/JS modulu, fiktivní lístek a jedna ukázková karta.
- `/guest`: současné hostovské rozhraní, odkaz na menu; hudební data jsou prázdná.
- `/demo`: konkrétní nabídka pilotu a QR otevřeného dema.
- `/admin/ads`: existující rozhraní reklamy v režimu pouze pro čtení; jeden
  neaktivní fiktivní návrh, statistiky 0, ukládání/spouštění jsou vypnuté.
- `/demo/partner`: místní fiktivní cíl reklamy, otevřený v samostatné kartě.

Všechny jiné než GET/HEAD požadavky jsou odmítnuty 405. V demu není endpoint
přehrávače, aktivace, měření ani přihlášení správce. CSP dovoluje pouze vlastní
zdroje a zakazuje vložené přehrávače; neprobíhá reklamní telemetrie.
Reálný modul zůstává v `app.py` s původními oprávněními správy.

## Skutečná správa v lokální izolaci

Při testování plné správy spouštět **`app:app`**, ne `demo_server:app`,
s vlastní prázdnou SQLite cestou, změněným testovacím PINem a tajemstvím.
Proměnné `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `JUKEBOX_DB_SECRET` a
`YOUTUBE_API_KEY` musí být prázdné. Vytvořit pouze označené testovací návrhy.
Fiktivní data se do skutečné aplikace nenačítají automaticky.

Přímý QR `/menu` funguje bez hudební cookie a nevytváří hudební identitu.
Nadále respektuje omezení sítě provozovny. `/api/menu?preview=…` vyžaduje
správce; měřicí událost skutečné kampaně vyžaduje podepsaný hodinový token.
Nemění se přihlašování zákazníků ani jejich připravované účty.

## Export pro samostatné preview

```bash
.venv/bin/python scripts/build_sales_preview.py
```

Vznikne ignorovaný adresář `.demo-preview/`. V něm je `app.py` kopií výhradně
`demo_server.py`, vybrané statické soubory, fiktivní JSON a minimální závislosti.
Živá aplikace, databáze, tajemství, `.env`, migrace a git metadata se neexportují.
Nasazovat do **nového samostatného projektu**, bez převzetí proměnných
existujícího `pub-jukebox`. Typ nasazení preview; nesmí získat jeho domény.

Pokud není možné vytvořit Python hosting, čtecí prezentaci lze exportovat
staticky pomocí `scripts/build_static_sales_preview.py CIL --origin URL`.
Stejné prezentační soubory načítají fiktivní JSON místo API. Není to serverové
nasazení skutečné administrace ani měření. Aktuální výsledek a omezení
sdílení popisuje [ověření](sales-demo-validation.md).

## Ověření

```bash
.venv/bin/python -m pytest -q
npm ci --prefix tests/sql
npm test --prefix tests/sql
```

Python kontroluje oprávnění, URL a XSS, tokeny a souběžné duplicity, životní
cyklus, oddělení hudby, přímý QR bez identity a síťová omezení. Testy dema
odmítají zápisy a ověřují izolaci i při přítomných produkčních proměnných.
SQL v lokálním PGlite ověřuje skutečné RLS, tajemství, oddělení provozoven,
rollback a stávající hudební RPC. Testy se nikdy nepřipojují k produkční DB.

Výsledky a nasazená adresa budou zaznamenány v `docs/sales-demo-validation.md`.
