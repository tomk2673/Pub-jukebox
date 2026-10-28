# QR nápojový lístek — nabídka prvního pilotu

Návrh k ověření s prvním podnikem, 28. 10. 2026. Nejde o sjednané ceny,
objednávku ani potvrzení příjmu. Obchodní stránka této nabídky je v izolované
ukázce na `/demo`; mobilní menu na `/menu` a ukázka správy na `/admin/ads`.

## Co nabídnout

Jedné provozovně připravíme mobilní nápojový lístek na přidělené adrese,
QR soubor SVG pro vlastní tisk, vstupní naplnění do 40 položek ve 4 kategoriích,
jednu souhrnnou úpravu a krátké zaškolení. Host nepotřebuje aplikaci ani účet.
Objednává u obsluhy. Vlastní doména, tisk, pokladna, platby a zákaznické účty
nejsou součástí pilotu. Rozsah nezahrnuje vytvoření víceprovozovnového SaaS.

| Varianta k ověření | Prvních 30 dní | Obsah navíc | Možné pokračování, až po dohodě |
| --- | ---: | --- | ---: |
| A — QR lístek | 1 490 Kč | Bez spuštění reklamy | 290 Kč / 30 dní, jedna souhrnná úprava lístku |
| B — lístek a reklamní prostor | 2 490 Kč | Příprava jedné kampaně po dohodě s partnerem, přehled dostupných měření | 490 Kč / 30 dní, jedna úprava lístku a jedna výměna kampaně |

Jde o návrhy konečných částek do prvního rozhovoru, nikoli tržní cenový průzkum.
Cena první periody zahrnuje nastavení i provoz. Po 30 dnech bez automatického
prodloužení: nejdřív vyhodnotit pilot a odsouhlasit pokračování. Vstupní
podklady, rozsah, konečná cena a platební podmínky se předem písemně potvrdí.
Získání inzerenta není garantované. Pokud se partner nenajde, menu funguje samo.

## Samostatný paušál pro reklamního partnera

Hypotézy: **500 Kč nebo 1 000 Kč za 30 dní** za jednu označenou kartu na
jednom lístku. Nejdřív vybrat jednoho skutečného partnera a jednu cenu podle
jeho zájmu. Jde o samostatnou objednávku partnera; částka se automaticky
nepřičítá k ceně menu a aplikace ji nikomu nestrhává.

Písemně sjednat partnera, přesný obsah, cílový HTTPS web, provozovnu,
počátek/konec, cenu a postup při výpadku (například náhradní období po dohodě).
Neslibovat minimální návštěvnost, prodeje ani výnos. Objednávku, platbu
a případný doklad řeší provozovatel mimo aplikaci. Není zde platební brána,
automatická fakturace ani potvrzení úhrady.

Reklamní příjem podle současného modulu patří provozovateli PUB JUKEBOX.
Podíl podniku je v implementaci 0 %; jiná dohoda musí vzniknout zvlášť.
První obchodní model je prodej a správa menu, reklama je volitelný doplněk.

## Správa kampaně ve skutečném modulu

1. Přihlásit se do `/admin` a vyplnit skutečný lístek.
2. Přes **Reklamy na lístku** otevřít `/admin/ads`.
3. Vyplnit partnera, text, HTTPS odkaz a časové období, uložit **návrh**.
4. Zkontrolovat **Náhled** a obsah odsouhlasit s partnerem.
5. Až po obchodní dohodě spustit. **Vypnout** kartu okamžitě stáhne;
   konec období ji skryje automaticky.

Nejvýše jedna kampaň je vybraná. Aktivování budoucího návrhu okamžitě nahradí
současný, takže před jeho začátkem může vzniknout mezera. Automatické řazení
více budoucích kampaní není implementováno. Oprava obsahu vzniká jako nový návrh.
Menu ani reklama nevolají hudební frontu, AutoDJ nebo přehrávač.

## Co předat v závěrečném přehledu

- Období skutečně zveřejněné karty a její obsah.
- Orientační součet zobrazení (alespoň 50 % karty po souvislou 1 sekundu
  ve viditelném panelu; také kliknutí prokazuje zobrazení).
- Orientační součet otevření odkazu; žádné tvrzení o nákupu.
- Výslovně uvést, že nové načtení může přidat událost, duplicity jednoho tokenu
  se odstraní a náhled přihlášeného správce se nepočítá.

Nejde o unikátní zákazníky, nezávisle ověřený zásah, tržby ani fakturaci za
zobrazení. Blokátory a boti mohou součty zkreslit. Reklamní tabulky neukládají
ID hostů ani IP; žádné reklamní cookies, partnerovy obrázky ani reklamní SDK.
Ve veřejném demu je měření vypnuté a statistiky jsou nuly, nikoli simulovaný úspěch.

## Jak ověřit obchodní smysl

Ukázat menu prvnímu podniku, zjistit jak dnes mění ceny a zda hosté potřebují
digitální lístek. Nejdřív potvrdit jednu placenou objednávku v konkrétním
rozsahu. Po 30 dnech vyhodnotit použitelnost telefonu, náročnost změn, skutečně
zaplacenou částku a rozhodnutí o pokračování. Do té doby není žádný příjem doložený.

Krátká nabídka pro osobní rozhovor (nebyla nikomu odeslána):

> Připravím vám nápojový lístek, který host otevře přes QR v telefonu.
> Dostanete naplněné menu, QR pro vlastní tisk a jednu úpravu během 30 dní.
> Pro první pilot navrhuji 1 490 Kč. Volitelně lze přidat označenou nabídku
> místního partnera; návštěvnost ani tržby neslibuji. Tady je funkční ukázka.
