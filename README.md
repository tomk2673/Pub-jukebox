# PUB Jukebox Python prototype

## Windows start
1. Nainstaluj Python 3.11+.
2. Dvojklik na `START_JUKEBOX.bat`.
3. Dotykový jukebox: `http://PC-IP:8000/`
4. Host telefon: `http://PC-IP:8000/guest`
5. Tvůj admin: `http://PC-IP:8000/admin`
6. TV obraz: `http://PC-IP:8000/tv`

Výchozí admin PIN je `2673` a změň ho v `app.py`.

### Už funguje v prototypu
- společná fronta
- hlasování
- priorita skladby
- host mobil jen fronta + hlasování
- admin ovládání
- TV YouTube player
- automatické pokračování na další skladbu

### Ještě není produkčně zapojené
- YouTube Search API
- ověření platby 5 Kč
- licencované lyrics
- skutečná identifikace tvého iPhonu
- zabezpečení proti opakovanému hlasování
