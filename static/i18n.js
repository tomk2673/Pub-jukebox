/* Guest interface only. Song titles, artist names and venue names are user content. */
(() => {
  const english = {
    "Jazyk": "Language",
    "LIVE V BARU": "LIVE AT THE BAR",
    "připojuji…": "connecting…",
    "online": "online",
    "bez spojení": "offline",
    "VYBER DALŠÍ TRACK": "PICK THE NEXT TRACK",
    "Najdi skladbu na YouTube": "Find a song on YouTube",
    "Typ vystoupení": "Search type",
    "♫ Hudba": "♫ Music",
    "🎤 Karaoke + originál": "🎤 Karaoke + original vocals",
    "Karaoke hledá původní zpěv s textem přímo ve videu.": "Karaoke finds the original vocals with lyrics in the video.",
    "Interpret nebo název skladby": "Artist or song title",
    "Hledat": "Search",
    "Nainstalovat aplikaci bez lišty": "Install the fullscreen app",
    "PRÁVĚ HRAJE": "NOW PLAYING",
    "Hudba čeká na první volbu": "Choose the first song",
    "Najdi skladbu a pošli ji do fronty.": "Find a song and add it to the queue.",
    "Přeskočit moji skladbu": "Skip my song",
    "Spletl/a ses? Pustí se další skladba z fronty.": "Changed your mind? The next song in the queue will play.",
    "SKLADEB PŘED TEBOU": "SONGS IN THE QUEUE",
    "Každá volba jde rovnou do fronty. Hlasuj pro skladbu, kterou chceš dostat výš; každý telefon má jeden hlas.": "Your song goes straight into the queue. Vote to move a song up; each phone gets one vote per song.",
    "RYCHLÝ VÝBĚR": "QUICK PICKS",
    "Další skladby z playlistu": "More songs from the playlist",
    "Při prázdné frontě automaticky pokračuje playlist poslední skladby.": "When the queue is empty, the last song’s playlist continues automatically.",
    "Seznamy skladeb": "Playlists",
    "↻ Pokračovat v playlistu": "↻ Continue the playlist",
    "★ Oblíbené v baru": "★ Bar favourites",
    "Celosvětové hity": "Worldwide hits",
    "Další nabídka": "More suggestions",
    "SPOLEČNÁ VOLBA": "EVERYONE’S PICKS",
    "Fronta": "Queue",
    "Obnovit": "Refresh",
    "Přehrávání zajišťuje YouTube. Dostupnost některých videí určuje jejich vlastník.": "Playback is provided by YouTube. Video owners control the availability of their videos.",
    "vybral/a {name}": "requested by {name}",
    "+ Do fronty": "+ Add to queue",
    "Přeskakuji…": "Skipping…",
    "Fronta je prázdná. Tvoje skladba může být první.": "The queue is empty. Your song could be first.",
    "zásoba · tvoje volba ji předběhne": "AutoDJ backup · your pick comes first",
    "Zrušit": "Remove",
    "Zrušit skladbu {title}": "Remove song {title}",
    "Hlasovat pro skladbu {title}": "Vote for song {title}",
    "Pro skladbu {title} už jsi hlasoval/a": "You have already voted for {title}",
    "Přeskočit „{title}“? Pustí se další skladba z fronty.": "Skip “{title}”? The next song in the queue will play.",
    "Přeskakuji tvoji skladbu…": "Skipping your song…",
    "Tvoje skladba už skončila.": "Your song has already ended.",
    "Skladba přeskočena. Pokračuje další z fronty.": "Song skipped. The next song in the queue will play.",
    "Odpověď nepřišla. Obnov frontu; případné opakování nepřeskočí další skladbu.": "No response received. Refresh the queue; retrying will not skip the next song.",
    "Hledám na YouTube…": "Searching YouTube…",
    "{count} výsledků": "{count} results",
    "{count} výsledků s původním zpěvem a textem": "{count} results with original vocals and lyrics",
    "Načítám výběr…": "Loading suggestions…",
    "Navazuje {playlist}. Automatické pokračování je vypnuté.": "Continuing {playlist}. Automatic playback is off.",
    "Navazuje {playlist}. Při prázdné frontě pokračuje automaticky; tvoje volba má přednost.": "Continuing {playlist}. It plays automatically when the queue is empty; your pick comes first.",
    "{count} tipů · {source}": "{count} suggestions · {source}",
    "Obsluha zatím nemá vybraný playlist.": "The bar staff have not selected a playlist yet.",
    "V tomto výběru už vše hrálo. Zkus Další nabídku.": "Everything in this selection has already played. Try More suggestions.",
    "Přidávám…": "Adding…",
    "✓ Ve frontě": "✓ In the queue",
    "Skladba je ve frontě.": "Song added to the queue.",
    "Opravdu zrušit „{title}“?": "Remove “{title}” from the queue?",
    "Ruším…": "Removing…",
    "Skladba byla z fronty zrušena.": "Song removed from the queue.",
    "Připojit · PUB Jukebox": "Join · PUB Jukebox",
    "Připoj se k hudbě": "Join the music",
    "Nejrychlejší je naskenovat QR kód na obrazovce v baru. Případně zadej kód ručně.": "Scan the QR code on the screen at the bar, or enter the venue code below.",
    "Kód podniku": "Venue code",
    "Vstoupit": "Join",
    "Obsluha": "Staff",
    "Wi‑Fi podniku · PUB Jukebox": "Venue Wi-Fi · PUB Jukebox",
    "SÍŤ PODNIKU": "VENUE NETWORK",
    "Připoj se k barové Wi‑Fi": "Connect to the bar’s Wi-Fi",
    "Jukebox přijímá skladby pouze od hostů připojených k internetu tohoto podniku.": "Only guests connected to this venue’s internet can request songs.",
    "Po připojení k Wi‑Fi znovu načti QR kód.": "After connecting to Wi-Fi, scan the QR code again.",
    "Na iPhonu: Sdílet → Přidat na plochu → Otevřít jako webovou aplikaci.": "On iPhone: Share → Add to Home Screen → Open as Web App.",
    "Po instalaci se jukebox otevře přes celou obrazovku bez lišty prohlížeče.": "Once installed, the jukebox opens fullscreen without the browser toolbar.",
    "Po instalaci se aplikace otevře bez lišty prohlížeče.": "Once installed, the app opens without the browser toolbar.",
    "Aplikace je nainstalovaná. Spusť ji z plochy.": "The app is installed. Open it from your home screen.",
    "Instalace je potvrzená. Aplikaci najdeš na ploše.": "Installation confirmed. Find the app on your home screen.",
    "V Safari klepni na Sdílet, potom Přidat na plochu a zapni Otevřít jako webovou aplikaci.": "In Safari, tap Share, then Add to Home Screen and enable Open as Web App.",
    "V Chromu otevři nabídku ⋮ a zvol Nainstalovat PUB Jukebox.": "In Chrome, open the ⋮ menu and choose Install PUB Jukebox.",
    "Instalace aplikace je dočasně nedostupná; web zůstává funkční.": "App installation is temporarily unavailable. You can still use the website.",
    "Něco se nepovedlo.": "Something went wrong. Please try again.",
    "Spojení se přerušilo. Zkus to znovu.": "Connection lost. Please try again.",
    "Spojení se přerušilo.": "Connection lost.",
    "Databáze jukeboxu je dočasně nedostupná.": "The jukebox database is temporarily unavailable.",
    "Profil provozovny není dostupný.": "The venue is temporarily unavailable.",
    "Provozovna není aktivní.": "This venue is not active.",
    "Připoj se k Wi‑Fi tohoto podniku.": "Connect to this venue’s Wi-Fi.",
    "Otevři jukebox přes QR kód v baru.": "Open the jukebox using the QR code at the bar.",
    "Neplatné YouTube video.": "Invalid YouTube video.",
    "Chybí název skladby.": "The song title is missing.",
    "Neplatný zdrojový playlist.": "Invalid source playlist.",
    "Fronta je teď plná.": "The queue is full right now.",
    "Tahle skladba už ve frontě je (#{id}).": "This song is already in the queue (#{id}).",
    "Tahle skladba už ve frontě je.": "This song is already in the queue.",
    "Neplatná skladba.": "Invalid song.",
    "Neplatná data požadavku.": "Invalid request. Please try again.",
    "Máš už {count} skladby ve frontě. Nech prostor i ostatním.": "You already have {count} songs in the queue. Leave room for others.",
    "AutoDJ zásoba se nehlasuje; vlastní skladba ji vždy předběhne.": "AutoDJ backup songs cannot be voted on; your picks always come first.",
    "Skladba už není ve frontě.": "This song is no longer in the queue.",
    "Pro tuhle skladbu už jsi hlasoval.": "You have already voted for this song.",
    "Přeskočit můžeš jen skladbu, kterou jsi přidal/a.": "You can only skip a song you requested.",
    "Tahle skladba ještě nehraje. Ve frontě ji můžeš zrušit.": "This song is not playing yet. You can remove it from the queue.",
    "Zrušit můžeš jen vlastní čekající skladbu.": "You can only remove your own queued songs.",
    "Přehrávaná skladba se mezitím změnila.": "The playing song has changed.",
    "Vlož platný odkaz na YouTube.": "Enter a valid YouTube link.",
    "Jukebox přijímá jen hudbu, ne pořady, filmy ani podcasty.": "The jukebox only accepts music, not shows, films or podcasts.",
    "Tahle verze videa vyžaduje potvrzení na YouTube. Vyhledej stejnou skladbu přímo v jukeboxu.": "This video requires confirmation on YouTube. Search for the same song directly in the jukebox.",
    "Vyhledávání YouTube je dočasně nedostupné.": "YouTube search is temporarily unavailable.",
    "Pro tento dotaz jsem nenašel žádnou skladbu.": "No songs found. Try another search.",
    "Hledáš příliš rychle. Počkej chvíli.": "You are searching too quickly. Please wait a moment.",
    "historie baru": "bar history",
    "výběr baru": "bar picks",
    "Karaoke s originálem": "Karaoke with original vocals",
  };
  const hasTranslation = (key) => Object.prototype.hasOwnProperty.call(english, key);
  let saved = null;
  try { saved = localStorage.getItem("jukebox_language"); } catch (_) {}
  const urlLanguage = new URLSearchParams(window.location.search).get("lang");
  const supported = (value) => value === "cs" || value === "en";
  let language = supported(urlLanguage) ? urlLanguage : supported(saved) ? saved
    : /^(cs|sk)(-|$)/i.test(navigator.language || "cs") ? "cs" : "en";

  function t(key, params = {}) {
    const template = language === "en" && hasTranslation(key) ? english[key] : key;
    return template.replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match));
  }

  function bind(element, key, params = {}, attribute = "textContent") {
    const suffix = attribute === "textContent" ? "" : `-${attribute}`;
    element.setAttribute(`data-i18n${suffix}`, key);
    element.setAttribute(`data-i18n${suffix}-params`, JSON.stringify(params));
    const localized = { ...params };
    // Translate preset labels, never song titles, artist names or guest names.
    for (const name of ["playlist", "source"]) {
      if (localized[name] && hasTranslation(localized[name])) localized[name] = t(localized[name]);
    }
    if (attribute === "textContent") element.textContent = t(key, localized);
    else element.setAttribute(attribute, t(key, localized));
  }

  function errorKey(message) {
    const duplicate = /^Tahle skladba už ve frontě je \(#(\d+)\)\.$/.exec(message);
    if (duplicate) return ["Tahle skladba už ve frontě je (#{id}).", { id: duplicate[1] }];
    const limit = /^Máš už (\d+) skladby ve frontě\. Nech prostor i ostatním\.$/.exec(message);
    if (limit) return ["Máš už {count} skladby ve frontě. Nech prostor i ostatním.", { count: limit[1] }];
    if (message === "Failed to fetch" || message === "Load failed" || message === "NetworkError when attempting to fetch resource.") {
      return ["Spojení se přerušilo. Zkus to znovu.", {}];
    }
    return [hasTranslation(message) ? message : "Něco se nepovedlo.", {}];
  }

  function apply() {
    document.documentElement.lang = language;
    for (const attribute of ["textContent", "placeholder", "aria-label"]) {
      const suffix = attribute === "textContent" ? "" : `-${attribute}`;
      document.querySelectorAll(`[data-i18n${suffix}]`).forEach((element) => {
        const key = element.getAttribute(`data-i18n${suffix}`) || element.textContent;
        let params = {};
        try { params = JSON.parse(element.getAttribute(`data-i18n${suffix}-params`) || "{}"); } catch (_) {}
        bind(element, key, params, attribute);
      });
    }
    document.querySelectorAll("[data-language]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.language === language));
    });
  }

  function setLanguage(value) {
    if (!supported(value)) return;
    language = value;
    try { localStorage.setItem("jukebox_language", language); } catch (_) {}
    // Preserve the QR venue code and any other query parameters.
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("lang")) {
        url.searchParams.set("lang", language);
        window.history.replaceState(null, "", url);
      }
    } catch (_) {}
    apply();
  }

  window.JukeboxI18n = { t, bind, errorKey, setLanguage, get language() { return language; } };
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.addEventListener("click", () => setLanguage(button.dataset.language));
  });
  apply();
})();
