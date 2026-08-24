# PUB Jukebox 1.0

Webový jukebox pro bar. Host načte QR kód, vyhledá skladbu podle názvu na YouTube, přidá ji do společné fronty a může jednou hlasovat. Obsluha řídí pořadí a TV přehrává frontu automaticky.

## Co verze 1.0 umí

- hledání skladeb podle názvu a interpreta
- záložní YouTube vyhledávání i bez API klíče
- oficiální YouTube Data API po přidání `YOUTUBE_API_KEY`
- přidání skladby z výsledku i přímého YouTube odkazu
- jedna společná fronta pro všechny telefony
- jeden hlas na skladbu z jednoho telefonu
- ochrana proti duplicitám, přeplnění fronty a zahlcení jedním hostem
- admin rozhraní chráněné PINem
- QR odkaz pro hosty
- TV režim s automatickým pokračováním
- pauza, pokračování, přeskočení a vzdálená hlasitost
- ruční potvrzení přednosti za 5 Kč
- noční limit celkové hlasitosti
- instalace na plochu iPhonu jako webová aplikace
- trvalá SQLite databáze na připojeném disku hostingu

## Spuštění bez počítače – Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/tomk2673/Pub-jukebox)

Blueprint vytvoří webovou službu a 1GB trvalý disk. Při nasazení zadej nový `ADMIN_PIN`. `JOIN_CODE` a `SECRET_KEY` se vytvoří automaticky.

Po nasazení otevři:

- `https://tvoje-adresa.onrender.com/admin` – ovládání obsluhy a QR kód
- `https://tvoje-adresa.onrender.com/tv` – obrazovka s YouTube přehrávačem
- host vstupuje přes QR kód z administrace

Render služba s trvalým diskem je placená. Je to nejjednodušší spolehlivá varianta bez zapnutého počítače; bezplatný server s dočasným diskem by po restartu ztratil frontu.

## Vyhledávání

Aplikace funguje hned přes metadata-only záložní vyhledávač. Pro ostrý provoz je stabilnější oficiální YouTube Data API:

1. V Google Cloud Console zapni **YouTube Data API v3**.
2. Vytvoř API key a omez ho jen na YouTube Data API v3.
3. V Renderu přidej proměnnou `YOUTUBE_API_KEY`.
4. Restartuj službu.

API klíč nikdy nevkládej do zdrojového kódu ani do veřejného GitHubu.

## Lokální spuštění na Windows

1. Nainstaluj Python 3.11 nebo novější.
2. Spusť `START_JUKEBOX.bat`.
3. Admin: `http://127.0.0.1:8000/admin`
4. TV: `http://127.0.0.1:8000/tv`

Výchozí lokální PIN je `2673`. Pro ostré nasazení je povinné ho změnit přes proměnnou `ADMIN_PIN`.

## Konfigurace

Viz `.env.example`. Nejdůležitější proměnné:

| Proměnná | Význam |
|---|---|
| `ADMIN_PIN` | PIN obsluhy a TV |
| `JOIN_CODE` | neveřejný kód vložený do QR odkazu |
| `SECRET_KEY` | podpis přihlašovacích cookies |
| `YOUTUBE_API_KEY` | volitelný oficiální YouTube vyhledávač |
| `JUKEBOX_DB` | cesta k SQLite databázi |
| `PRIORITY_PRICE_CZK` | cena ručně potvrzené přednosti |
| `NIGHT_VOLUME` | limit hlasitosti v nočním režimu |

## Testy

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

## Důležité provozní omezení

Webový YouTube přehrávač neumí kvůli oddělení zvuku z cizí domény aplikovat skutečný high-pass filtr jen na basy. Noční režim proto v této verzi omezuje celkovou hlasitost. Skutečný **Night Bass Guard** vyžaduje vlastní/licencované audio soubory nebo externí DSP/EQ mezi TV a zesilovačem.

Veřejné přehrávání hudby a komerční použití musí provozovatel řešit v souladu s podmínkami YouTube a příslušnými hudebními licencemi. Automatická online platba za přednost není ve V1 zapojená; přednost potvrzuje obsluha po platbě u baru.
