PUB JUKEBOX · NIGHT BASS GUARD PRO (Windows + Chrome)
=====================================================

Co modul dělá
-------------
- průběžně vyrovnává rozdílnou hlasitost skladeb,
- odřízne neslyšitelné vibrace pod 30 Hz, které zbytečně zatěžují aparaturu,
- basový shelf kolem 150 Hz stáhne basy podle síly ochrany a navíc reaguje na jejich převahu,
- hlasitost měří až po basovém filtru a dorovnává ji rychleji; při tichu nezvyšuje šum,
- look-ahead limiter zachytí špičky před výstupem,
- posílá do administrace živý stav a hodnoty zásahu.

První instalace
--------------
1. Rozbal celou tuto složku na barovém Windows počítači. Po instalaci ji nemaž.
2. V Google Chrome otevři chrome://extensions
3. Vpravo nahoře zapni „Režim pro vývojáře“.
4. Klikni „Načíst rozbalené“ a vyber tuto rozbalenou složku.
5. Připni rozšíření „PUB Jukebox · Night Bass Guard“ k liště Chromu.

Každé spuštění TV
-----------------
1. Otevři https://pub-jukebox.vercel.app/tv a přihlas TV admin PINem.
2. Klikni jednou na ikonu Night Bass Guard v liště Chromu.
3. Zelené „ON“ znamená, že zvuk prochází procesorem.
4. V administraci se do 10 sekund objeví „PŘIPOJEN“ a živé hodnoty.
5. Dalším kliknutím zpracování vypneš.

Důležité
--------
- Verze 0.3.0: rychlejší dorovnání hlasitosti, skutečný basový shelf a přesnější omezení špiček.
- Aktualizace: rozbal novou verzi do původní složky a v chrome://extensions klikni na Načíst znovu.
- Potom na kartě /tv znovu klikni na ikonu modulu. Stav v administraci se ukazuje i na iPhonu.
- Rozšíření zachytává pouze zvuk aktuální TV karty, nikoli mikrofon.
- Když je v administraci vybraný „Běžný výstup“, zvuk pouze bezpečně propustí.
- Režim Bass Guard PRO se řídí hodnotami LUFS, limitu a ochrany basů v administraci.
- Při krátkém výpadku internetu zůstane aktivní bezpečný profil −17 LUFS / −4 dB / 100 % ochrany basů.
- Před ostrým večerem vyzkoušej profil při nižší hlasitosti a sílu basů dolaď podle aparatury.


OVLÁDÁNÍ Z MOBILU — verze 0.3.1
Na iPhonu nebo Androidu otevři administraci stejného jukeboxu a přihlas se.
Nastav hlasitost, ochranu basů a limiter; klepni na „Použít zvuk na PC“.
Změnu potvrzuje skutečné nastavení DSP, obvykle během 10 sekund.
„Stav neznámý“ znamená chybějící zprávu, nikoli jistotu vypnuté ochrany.
Při AUTH na ikoně se na barovém PC přihlas do administrace ve stejném profilu Chromu jako TV.
Spojení pro hlášení stavu se pak obnovuje samostatně i po vypršení admin přihlášení.
Odhlášení na PC toto spojení zruší; další přihlášení je obnoví.

AKTUALIZACE
Během pauzy hudby nahraď soubory ve složce rozšíření tímto balíkem.
Na chrome://extensions klikni na Obnovit, pak na TV kartě na ikonu Bass Guard.
První spuštění zachytávání vyžaduje kliknutí na PC, nelze je zapnout z telefonu.
