# Ověření QR prodejního dema — 28. 10. 2026

## Výsledek

Samostatná čtecí ukázka byla úspěšně nasazena:
https://pub-jukebox-qr-demo-20261028.pwc82cgt2v.chatgpt.site

Jde o nový oddělený **soukromý web vlastníka účtu**, nikoli nasazení živého
jukeboxu. Pro předání cizímu obchodnímu partnerovi by bylo nutné samostatně
nastavit sdílení; QR v ukázce směřuje na tento web se stejným omezením přístupu.
Adresa obsahuje menu, nabídku pilotu, vstup z hostovského rozhraní, místní cíl
fiktivní reklamy a správu pouze pro čtení. Žádný skutečný partner není aktivní.

## Automatizované testy

- **76 Python testů prošlo**, včetně celého původního testovacího souboru,
  reklamního modulu a nových hranic dema. Jedno varování o zastaralém aliasu
  ve Starlette/AnyIO; žádná chyba testů.
- **3 PostgreSQL sady v PGlite prošly**: guest-skip, continuation, advertising.
  Ověřeny RLS, backendové tajemství, oddělení provozoven, souběžné/idempotentní
  události, rollback a zachování hudební fronty.
- **11 JS testů administrace prošlo**, dále existující sady TV AutoDJ,
  bezpečnosti fronty, přechodů, přeskočení vlastní skladby, zvukové telemetrie
  a Bass Guard DSP. Nejde o měření skutečné zvukové aparatury.
- `git diff --check` bez chyb. Hudební skripty `guest.js`, `admin.js`, `tv.js`
  jsou proti výchozímu `main` beze změny. Jejich pouze čtecí statický export
  mapuje čtení na fiktivní JSON a nikdy nepřipojuje živé API.

## Prohlížeč a mobilní rozložení

Chromium, skutečně načtené stránky v responzivních rámcích šířek **320, 390,
768 a 1440 px**: `/menu`, `/guest`, `/admin/ads` a `/demo`, bez vodorovného
přetékání. V každém menu 14 nápojů ve 4 kategoriích. Na telefonu je karta
partnera za první kategorií, na desktopu samostatně vedle lístku.

Ověřena cesta `/guest` → tlačítko **Nápojový lístek** → naplněné menu;
jedna označená fiktivní karta, její odkaz otevírá místní ukázku partnera
v nové kartě a má `sponsored noopener noreferrer`. Návrh v ukázce správy
je neaktivní, statistiky nulové a formulář se nedá uložit nebo spustit.
Rozložení bylo také vizuálně zkontrolováno v rámu 390 × 844 px.

Toto je test v Chromiu, nikoli fyzický test iPhonu nebo Safari. Zkoušky
YouTube zvuku v živém baru se neprováděly. Prohlížeč hlásil chyby vlastní
rozšiřující komponenty; pozorované chyby nepocházely ze skriptů dema.

## Bezpečnost a hranice

Skutečný modul: autentizovaná správa, kontrola JSON/originu, validace prostého
textu a bezpečných HTTPS odkazů, podepsané hodinové měření a deduplikace.
Test nebezpečného URL, HTML, cizího originu, padělaného a expirovaného tokenu
prošel. Přímý QR nevytváří hudební identitu a stále respektuje omezení sítě.

Hostované statické demo neobsahuje serverové API, DB, přihlašovací tajemství,
produkční proměnné, přehrávač ani měřicí token. Soubory mají CSP povolující
vlastní zdroje. Odkaz fiktivní reklamy vede výhradně na místní ukázkovou
stránku. Všechny součty jsou 0; žádná návštěvnost nebo příjem se nevymýšlí.
Lokální `demo_server.py` navíc odmítá veškeré POST/PUT/PATCH/DELETE metodou 405.

## Překážka plného serverového preview

Vercel konektor umožnil přečíst tým a existující projekt, ale vytvoření nového
samostatného projektu `pub-jukebox-qr-demo-20261028` odmítl chybou **403 forbidden:
You don't have permission to create the project**. Lokální Vercel CLI není
dostupný. Živý projekt `pub-jukebox` ani jeho prostředí se kvůli tomu neměnily.

Proto je nasazena statická čtecí prezentace pomocí `scripts/build_static_sales_preview.py`.
Používá skutečné HTML/CSS/JS z PR #7 se čtením fiktivních JSON souborů.
Plný FastAPI modul a samostatný čtecí server zůstávají spustitelné ve větvi.
Pro skutečný placený pilot je třeba samostatně připravit trvalou databázi,
nasazení a obchodní dohodu; tento úkol žádnou produkční migraci neprovedl.
