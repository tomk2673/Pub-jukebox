# PUB Jukebox Noise Guard – Windows 7

Lokální doprovodný modul pro barový počítač. Slouží k průběžné orientační kontrole hluku přes připojený mikrofon a k dokumentaci vlastní provozní kontroly.

## Co umí první verze

- průběžné A/C vážení,
- LAeq / LCeq,
- LAFmax a LCpeak,
- varování při překročení interních provozních mezí,
- kontrolní obchůzku přes předem zadané body,
- CSV log,
- HTML protokol s možností tisku do PDF,
- kalibraci úrovně pomocí akustického kalibrátoru.

> Výstup je **interní orientační provozní kontrola**, nikoli autorizované měření hluku ani náhrada protokolu akreditované/autorizované laboratoře.

## Instalace

Z administrace PUB Jukeboxu stáhni `night-bass-guard-windows.zip`, rozbal jej do stálé složky a postupuj podle `README.txt` uvnitř.

Pro Windows 7 je balík připraven pro Python 3.8.x. Závislosti jsou připnuté na verze vhodné pro tuto řadu Pythonu.

## Doporučený audio řetězec

`Chrome / Pub Jukebox -> Voicemeeter Banana -> M-Audio M-Track 2x2 -> aktivní RCF`

Noise Guard měří skutečný akustický výsledek přes samostatný měřicí mikrofon. Voicemeeter řeší systémové směrování, EQ/omezení basů a limiter pro všechny běžné zdroje zvuku ve Windows, ne jen pro plugin v Chromu.
