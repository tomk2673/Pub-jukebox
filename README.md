# PUB Jukebox 1.1

Webový jukebox pro bar. Host načte QR kód, vyhledá skladbu podle názvu na YouTube, přidá ji do společné fronty a může jednou hlasovat. Obsluha řídí pořadí a TV přehrává frontu automaticky.

## Co verze 1.1 umí

- hledání skladeb podle názvu a interpreta
- záložní YouTube vyhledávání i bez API klíče
- oficiální YouTube Data API po přidání `YOUTUBE_API_KEY`
- přidání skladby z výsledku i přímého YouTube odkazu
- jedna společná fronta pro všechny telefony
- jeden hlas na skladbu z jednoho telefonu
- ochrana proti duplicitám, přeplnění fronty a zahlcení jedním hostem
- admin rozhraní chráněné PINem
- QR odkaz pro hosty
- vlastní název provozovny uložený v cloudu
- tři živě přepínatelné TV režimy: videoklip, virtuální DJ a nápojová nabídka
- TV přehrávač s automatickým pokračováním
- pauza, pokračování, přeskočení a vzdálená hlasitost
- ruční potvrzení přednosti za 5 Kč
- noční limit celkové hlasitosti
- konfigurační profil Night Bass Guard PRO: cílová hlasitost v LUFS, limiter a síla dynamické ochrany basů
- instalace na plochu iPhonu jako webová aplikace
- trvalá sdílená databáze Supabase (na Vercelu), lokálně SQLite

## Spuštění bez počítače – Vercel + Supabase

Ostrá verze běží jako FastAPI aplikace na Vercelu. Fronta, hlasy a stav přehrávače jsou
uložené v Supabase, takže se neztratí při uspání nebo novém nasazení serverless funkce.

V projektu Vercel nastav `ADMIN_PIN`, `JOIN_CODE`, `SECRET_KEY`, `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY` a `JUKEBOX_DB_SECRET`. Tajné hodnoty nepatří do repozitáře.

Po nasazení otevři:

- `https://tvoje-adresa.vercel.app/admin` – ovládání obsluhy a QR kód
- `https://tvoje-adresa.vercel.app/tv` – obrazovka s YouTube přehrávačem
- host vstupuje přes QR kód z administrace

## Vyhledávání

Aplikace funguje hned přes metadata-only záložní vyhledávač. Pro ostrý provoz je stabilnější oficiální YouTube Data API:

1. V Google Cloud Console zapni **YouTube Data API v3**.
2. Vytvoř API key a omez ho jen na YouTube Data API v3.
3. Ve Vercelu přidej proměnnou `YOUTUBE_API_KEY`.
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
| `SUPABASE_URL` | URL produkčního Supabase projektu |
| `SUPABASE_PUBLISHABLE_KEY` | veřejný klíč pro backendové RPC |
| `JUKEBOX_DB_SECRET` | tajný klíč mezi aplikací a databázovým RPC |
| `VENUE_KEY` | trvalý identifikátor provozovny, např. `ztraceny-bar` |
| `DEFAULT_MENU_TEXT` | výchozí nápojová nabídka pro novou provozovnu |
| `PRIORITY_PRICE_CZK` | cena ručně potvrzené přednosti |
| `NIGHT_VOLUME` | limit hlasitosti v nočním režimu |

## Testy

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

## Základ pro prodej dalším provozovnám

Profil provozovny je oddělený od zdrojového kódu pomocí `VENUE_KEY`. V databázi drží obchodní název, TV režim, nápojové menu, tarif, povolené funkce a zvukový profil. Stejnou aplikaci tak lze nasadit a označit pro další podnik bez vytváření nové větve kódu. Pole `plan`, `features` a `is_active` jsou připravená pro pozdější předplatné, centrální správu licencí a vypínání placených modulů.

## Důležité provozní omezení

Webový YouTube přehrávač neumí kvůli oddělení zvuku z cizí domény měřit ani filtrovat audio signál. Noční limit proto pouze omezuje celkovou hlasitost. Administrace už ukládá profil **Night Bass Guard PRO**, ale skutečné vyrovnání hlasitosti, limiter a dynamická komprese pásma 20–120 Hz vyžadují místní audio procesor/DSP v cestě mezi počítačem a aparaturou. Dokud není procesor připojený, rozhraní ho pravdivě zobrazuje jako nepřipojený.

Veřejné přehrávání hudby a komerční použití musí provozovatel řešit v souladu s podmínkami YouTube a příslušnými hudebními licencemi. Automatická online platba za přednost není ve V1 zapojená; přednost potvrzuje obsluha po platbě u baru.
