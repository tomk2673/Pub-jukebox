# PUB Jukebox 1.5.2

Webový jukebox pro bar. Host načte QR kód, vyhledá skladbu podle názvu na YouTube, přidá ji do společné fronty a může jednou hlasovat. Obsluha řídí pořadí a TV přehrává frontu automaticky.

## Co verze 1.5 umí

- hledání skladeb podle názvu a interpreta
- záložní YouTube vyhledávání i bez API klíče
- oficiální YouTube Data API po přidání `YOUTUBE_API_KEY`
- přidání skladby z výsledku i přímého YouTube odkazu
- jedna společná fronta pro všechny telefony
- jeden hlas na skladbu z jednoho telefonu
- ochrana proti duplicitám, přeplnění fronty a zahlcení jedním hostem
- admin rozhraní chráněné PINem
- QR odkaz pro hosty
- QR pro další skladbu trvale viditelný ve všech TV režimech
- vlastní název provozovny uložený v cloudu
- tři živě přepínatelné TV režimy: videoklip, virtuální DJ a nápojová nabídka
- pět syntetizovaných DJ přechodů střídaných bez okamžitého opakování, s nastavitelnou hlasitostí a bez cizích audiosamplů
- dotykový štít TV přehrávače: zákazník nemůže klip zastavit, otevřít YouTube ani spustit druhou skladbu mimo frontu
- AutoDJ zásobník pro plynulé pokračování při prázdné frontě; hostovská volba má vždy přednost
- volitelné AutoDJ playlisty: český funk, české oldies, český hip-hop 90/00, karaoke a vlastní témata provozovny
- samostatná volba karaoke: originální skladba se zpěvákem a textem ve videu, nikoli instrumentální podklad
- TV přehrávač s automatickým pokračováním
- pauza, pokračování, přeskočení a vzdálená hlasitost
- ruční potvrzení přednosti za 5 Kč
- noční limit celkové hlasitosti
- Night Bass Guard PRO pro Windows a Chrome: automatické srovnání hlasitosti, dynamická ochrana basů pod 120 Hz a look-ahead limiter
- živý stav Windows procesoru a míra zásahu přímo v administraci
- volitelné omezení hostů na veřejnou IPv4 adresu nebo IPv6 /64 barové Wi‑Fi; administrace zůstává dostupná pro obnovu sítě
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

## Night Bass Guard PRO na barovém Windows počítači

1. V administraci stáhni `night-bass-guard-windows.zip` a rozbal ho do stálé složky.
2. V Google Chrome otevři `chrome://extensions`, zapni Režim pro vývojáře a zvol **Načíst rozbalené**.
3. Vyber rozbalenou složku a připni rozšíření k liště Chromu.
4. Otevři `/tv`, přihlas TV admin PINem a klikni jednou na ikonu Night Bass Guard.
5. Zelené `ON` na ikoně a stav **PŘIPOJEN** v administraci potvrzují, že zvuk prochází procesorem.

Modul zachytává pouze zvuk karty s TV přehrávačem. Třísekundový K-vážený odhad hlasitosti plynule dorovnává rozdíly mezi skladbami, dynamický filtr stáhne jen nadměrnou energii pod 120 Hz a limiter s šestimilisekundovým předstihem hlídá špičky. Nastavení se načítá z profilu provozovny každé čtyři sekundy.

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
node tests/test_bass_guard_dsp.mjs
```

## Základ pro prodej dalším provozovnám

Profil provozovny je oddělený od zdrojového kódu pomocí `VENUE_KEY`. V databázi drží obchodní název, TV režim, nápojové menu, tarif, povolené funkce a zvukový profil. Stejnou aplikaci tak lze nasadit a označit pro další podnik bez vytváření nové větve kódu. Pole `plan`, `features` a `is_active` jsou připravená pro pozdější předplatné, centrální správu licencí a vypínání placených modulů.

## Důležité provozní omezení

Night Bass Guard je praktický adaptivní procesor pro provoz baru, ne certifikovaný měřicí přístroj EBU R128. Cílové LUFS proto představuje průběžný K-vážený odhad, který je vhodné doladit podle konkrétní aparatury a prostoru. Bez zapnutého Windows rozšíření zůstává zvuk YouTube beze změny a administrace pravdivě zobrazuje procesor jako nepřipojený.

Veřejné přehrávání hudby a komerční použití musí provozovatel řešit v souladu s podmínkami YouTube a příslušnými hudebními licencemi. Automatická online platba za přednost není ve V1 zapojená; přednost potvrzuje obsluha po platbě u baru.
