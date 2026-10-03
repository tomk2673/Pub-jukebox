# Monetizace PUB JUKEBOX — první fáze

Stav k 4. říjnu 2026: připravený modul přímých sponzorských kampaní.
Výchozí stav je bez kampaně, bez reklamní sítě a bez odměn za reklamu.
Samotná implementace nevytváří příjem; potřebuje skutečného platícího partnera.

## Zvolený model

Jeden placený partner na samostatné stránce `/menu` se skutečným nápojovým
lístkem podniku. Doporučený obchodní pilot je pevná cena za období, ne cena
za měřený proklik. Konkrétní cenu teprve otestovat s prvním partnerem;
bez údajů o návštěvnosti nelze poctivě stanovit očekávaný reklamní výnos.
Jde o úsudek pro malý počáteční provoz: přímý paušál se snáz ověří než
příjem z neznámé návštěvnosti a neověřené dostupnosti síťových reklam.

Příjem patří provozovateli PUB JUKEBOX. Podniku se automaticky nepřiděluje
žádný podíl. Aplikace zatím neúčtuje, nefakturuje ani nepotvrzuje platbu.
Nikoho automaticky nekontaktuje.

Host má nápojový lístek dostupný z `/guest`. Reklama je označena, odkaz
otevírá web partnera samostatně. Lístek neobsahuje YouTube metadata ani
přehrávač. Reklama nemění frontu, hlasování, AutoDJ ani přehrávání.
Bez vyplněného lístku se reklama nespustí.

## Obsluha

1. V `/admin` vyplnit skutečný nápojový lístek (řádky `Nápoj | Cena`).
2. Otevřít **Reklamy**, vyplnit partnera, nabídku, HTTPS odkaz a období.
3. **Uložit jako návrh**, zkontrolovat **Náhled**.
4. Po sjednání placené kampaně zvolit **Spustit**. Předchozí kampaň se vypne.
5. **Vypnout** kampaň stáhne z nabídky. Konec období ji skryje automaticky.

Kampaně jsou neměnné záznamy; oprava nabídky se ukládá jako nový návrh,
aby se nepřepisoval obsah, ke kterému patří dosavadní statistiky.
Je vybraná nejvýše jedna kampaň. Aktivování budoucí kampaně okamžitě nahradí
současnou, nabídka bude do začátku budoucí kampaně bez reklamy.
Správa zobrazuje posledních 50 kampaní; starší záznamy se nemažou.

## Co statistiky skutečně znamenají

- Zobrazení: alespoň polovina karty na obrazovce po jednu souvislou sekundu
  ve viditelné kartě prohlížeče. Také explicitní kliknutí prokazuje zobrazení.
- Kliknutí: otevření označeného odkazu, ne prodej ani platba.
- Jedna načtená stránka má podepsaný hodinový token a náhodný identifikátor.
  Opakované požadavky se atomicky započítají jen jednou pro každý typ události.
- Nové načtení stránky může vytvořit nové zobrazení. Nejde o unikátní lidi.
- Správce při přihlášení nemá měřicí token, náhledy se nikdy nepočítají.
- Neukládá se ID hosta ani jeho IP do reklamních tabulek. Ukládají se součty
  a náhodné potvrzenky událostí. Expirované potvrzenky se promazávají při
  dalším platném měření; při nulovém provozu mohou v DB zůstat déle.
- Reklamní část nenastavuje cookies, nenačítá obrázky ani skripty partnera.
  Odkaz má `sponsored noopener noreferrer`.

Měření je orientační první-party telemetrie. Není nezávislý audit, odolná
anti-bot služba ani základ fakturace podle zobrazení. Klientský kód může
podvodník napodobit, nové načtení může opakovat a blokátor může měření zastavit.
Záměrně z něj nevzniká odměna ani údaj o peněžním příjmu.

## Nasazení a návrat

1. Na stávající Supabase databázi použít migraci
   `supabase/migrations/20261003235000_add_sponsor_campaigns.sql`.
   Využívá existující schéma `jukebox_private` a `secret_ok()`.
   Přidává dvě tabulky a nový RPC, nemění přehrávací tabulky ani RPC.
2. Nasadit tuto verzi aplikace obvyklým GitHub/Vercel postupem.
3. Ověřit přihlášené `/admin/ads`, návrh, náhled a návrat do jukeboxu.
   Žádné testovací kampaně neaktivovat skutečným hostům.
4. Až potom vložit sjednanou kampaň. K vypnutí stačí **Vypnout**.

Bez dostupné migrace admin ukáže chybu; `/menu` stále zobrazí lístek bez
reklamy. Fronta nevolá reklamní RPC. Návrat předchozí verze aplikace je
možný bez odstranění tabulek. Lokální SQLite tabulky vznikají automaticky.

Ověření: `python -m pytest -q`, `npm ci --prefix tests/sql`,
`npm test --prefix tests/sql`. Testy používají izolovanou SQLite a PGlite,
ne produkční databázi. SQL kontroluje RLS, backendový klíč, provozovnu,
aktivaci, idempotenci a rollback potvrzenky spolu s čítačem.

## Automatické reklamy Google — co ještě chybí

Pro současný web/PWA je směr **Google Ad Manager**. Rewarded web podporuje
počítače, mobily i tablety; odměna vyžaduje dobrovolný souhlas a skutečnou
událost `rewardedSlotGranted`. Pevných 20 sekund nelze slibovat. Webové
rewarded nemá server-side verification. SDK callback sám není důvěryhodný
důkaz serveru a pouhý timeout ani kliknutí nikdy nesmí stačit k odměně.

Před integrací a aktivací je potřeba:

- vlastní účet GAM, skutečný web/doména a reklamní jednotka;
- ověřený zdroj placených reklam a schválení účtu/inventáře dle požadavků
  poskytovatele — samotný účet ani tag nezaručuje placené nabídky;
- odpovídající soukromí a správa souhlasu; u personalizovaných Google
  reklam v EHP/UK/Švýcarsku Google vyžaduje certifikovanou CMP s TCF;
- případný `ads.txt` přesně podle skutečného účtu/dodavatele, žádné vymyšlené ID;
- test bez reklamy, odmítnutí, zavření, chyby, vypršení a opakování požadavku;
- u odměny za přednost hudby nejprve vyjasnit pravidla YouTube a dopady na
  ostatní hosty. Žádné přerušení cizí skladby ani blokování základní funkce.

YouTube omezuje prodej reklamy u svého obsahu i podmiňování přehrávání další
akcí. Oddělený lístek s vlastním obsahem řeší umístění první sponzorské plochy,
nepředstavuje automatické schválení celé aplikace. Před síťovou monetizací
je potřeba zkontrolovat také současný způsob použití YouTube přehrávače.
Licence kolektivního správce není souhlas YouTube s reklamním modelem.

### Ověřené primární podklady

- [Google: rewarded ads pro web](https://support.google.com/admanager/answer/9116812?hl=en)
- [Google: pravidla odměn](https://support.google.com/admanager/answer/7496282?hl=en)
- [Google Publisher Tag: rewarded API](https://developers.google.com/publisher-tag/samples/display-rewarded-ad)
- [Google: CMP požadavky](https://support.google.com/admanager/answer/13554116?hl=en)
- [YouTube: developer policies, III.F a III.G](https://developers.google.com/youtube/terms/developer-policies)
