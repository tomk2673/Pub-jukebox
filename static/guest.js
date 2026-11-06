const $ = (id) => document.getElementById(id);
const i18n = window.JukeboxI18n;
const t = i18n.t;
const state = {
  config: null, queue: [], busy: false, skipping: null, queueVersion: 0,
  discovery: "continue", discoveryVersion: 0, discoveryOffset: 0, discoverySeen: new Set(),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
  });
  let data = null;
  try { data = await response.json(); } catch (_) { data = {}; }
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Něco se nepovedlo.");
  return data;
}

function setStatus(text = "", type = "", target = "searchStatus", params = {}) {
  const el = $(target);
  const [key, values] = type === "error" ? i18n.errorKey(text) : [text, params];
  i18n.bind(el, key, values);
  el.className = `status ${type}`.trim();
}

function imageFor(song) {
  return song.thumbnail || `https://i.ytimg.com/vi/${song.video_id}/mqdefault.jpg`;
}

function songCopy(song) {
  const copy = document.createElement("div");
  copy.className = "song-copy";
  const title = document.createElement("div");
  title.className = "song-title";
  title.textContent = song.title;
  const meta = document.createElement("div");
  meta.className = "song-meta";
  meta.textContent = song.artist || "";
  if (song.requested_by) {
    const requester = document.createElement("span");
    i18n.bind(requester, "vybral/a {name}", { name: song.requested_by });
    if (song.artist) meta.append(" · ");
    meta.append(requester);
  }
  copy.append(title, meta);
  return copy;
}

function renderResults(items, target = "results", statusTarget = "searchStatus") {
  const root = $(target);
  root.replaceChildren();
  items.forEach((song) => {
    const card = document.createElement("article");
    card.className = "song-card";
    const img = document.createElement("img");
    img.className = "thumb";
    img.src = imageFor(song);
    img.alt = "";
    img.loading = "lazy";
    const button = document.createElement("button");
    button.className = "btn compact";
    button.type = "button";
    i18n.bind(button, "+ Do fronty");
    button.addEventListener("click", () => addSong(song, button, statusTarget));
    card.append(img, songCopy(song), button);
    root.append(card);
  });
}

function renderQueue() {
  const root = $("queue");
  root.replaceChildren();
  const playing = state.queue.find((song) => song.status === "playing");
  const queued = state.queue.filter((song) => song.status === "queued");
  const canSkip = Boolean(playing?.requested_by_me) && !isAutoDj(playing || {});
  $("ownSongActions").classList.toggle("hidden", !canSkip);
  $("skipOwnSong").disabled = state.skipping !== null;
  i18n.bind($("skipOwnSong"), state.skipping !== null ? "Přeskakuji…" : "Přeskočit moji skladbu");
  $("queueCount").textContent = String(queued.filter((song) => !isAutoDj(song)).length);
  if (playing) {
    $("nowTitle").removeAttribute("data-i18n");
    $("nowArtist").removeAttribute("data-i18n");
    $("nowTitle").textContent = playing.title;
    $("nowArtist").textContent = playing.artist || "YouTube";
    $("nowPanel").style.setProperty("--cover", `url("${imageFor(playing).replaceAll('"', '')}")`);
  } else {
    i18n.bind($("nowTitle"), "Hudba čeká na první volbu");
    i18n.bind($("nowArtist"), "Najdi skladbu a pošli ji do fronty.");
    $("nowPanel").style.removeProperty("--cover");
  }
  if (!queued.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    i18n.bind(empty, "Fronta je prázdná. Tvoje skladba může být první.");
    root.append(empty);
    return;
  }
  queued.forEach((song, index) => {
    const card = document.createElement("article");
    card.className = "song-card";
    const position = document.createElement("div");
    position.className = "position";
    const automatic = isAutoDj(song);
    position.textContent = automatic ? "AUTO" : `#${index + 1}`;
    const actions = document.createElement("div");
    actions.className = "song-actions";
    if (automatic) {
      const auto = document.createElement("span");
      auto.className = "priority small";
      i18n.bind(auto, "zásoba · tvoje volba ji předběhne");
      actions.append(auto);
    }
    if (!automatic) {
      const vote = document.createElement("button");
      vote.className = `btn compact ${song.voted_by_me ? "secondary" : "cyan"}`;
      vote.type = "button";
      vote.disabled = Boolean(song.voted_by_me);
      vote.textContent = song.voted_by_me ? `✓ ${song.votes}` : `▲ ${song.votes}`;
      i18n.bind(vote, song.voted_by_me ? "Pro skladbu {title} už jsi hlasoval/a" : "Hlasovat pro skladbu {title}", { title: song.title }, "aria-label");
      vote.addEventListener("click", () => voteSong(song.id, vote));
      actions.append(vote);
    }
    if (song.requested_by_me && !automatic) {
      const cancel = document.createElement("button");
      cancel.className = "btn danger compact";
      cancel.type = "button";
      i18n.bind(cancel, "Zrušit");
      i18n.bind(cancel, "Zrušit skladbu {title}", { title: song.title }, "aria-label");
      cancel.addEventListener("click", () => cancelSong(song.id, song.title, cancel));
      actions.append(cancel);
    }
    card.append(position, songCopy(song), actions);
    root.append(card);
  });
}

function isAutoDj(song) {
  return Boolean(song.is_autodj) || String(song.requested_by || "").startsWith("AutoDJ");
}

async function loadQueue(silent = false) {
  const version = ++state.queueVersion;
  try {
    const queue = await api("/api/queue");
    if (version !== state.queueVersion) return;
    const previous = state.queue.find((song) => song.status === "playing")?.id;
    state.queue = queue;
    renderQueue();
    const current = queue.find((song) => song.status === "playing")?.id;
    if (previous !== undefined && previous !== current && state.discovery === "continue") {
      void loadDiscovery("continue");
    }
    i18n.bind($("connection"), "online");
  } catch (error) {
    if (version !== state.queueVersion) return;
    i18n.bind($("connection"), "bez spojení");
    if (!silent) setStatus(error.message, "error");
  }
}

async function skipOwnSong() {
  const song = state.queue.find((item) => item.status === "playing");
  if (state.skipping !== null || !song?.requested_by_me || isAutoDj(song)) return;
  if (!window.confirm(t("Přeskočit „{title}“? Pustí se další skladba z fronty.", { title: song.title }))) return;
  state.skipping = song.id;
  ++state.queueVersion;
  renderQueue();
  setStatus("Přeskakuji tvoji skladbu…", "", "nowStatus");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const result = await api(`/api/queue/${song.id}/skip`, { method: "POST", signal: controller.signal });
    setStatus(result.idempotent ? "Tvoje skladba už skončila." : "Skladba přeskočena. Pokračuje další z fronty.", "success", "nowStatus");
  } catch (error) {
    setStatus(error.name === "AbortError" ? "Odpověď nepřišla. Obnov frontu; případné opakování nepřeskočí další skladbu." : error.message, "error", "nowStatus");
  } finally {
    clearTimeout(timer);
    state.skipping = null;
    renderQueue();
    await loadQueue(true);
  }
}

async function search(event) {
  event.preventDefault();
  if (state.busy) return;
  const query = $("searchInput").value.trim();
  if (query.length < 2) return;
  state.busy = true;
  $("searchButton").disabled = true;
  setStatus("Hledám na YouTube…");
  $("results").replaceChildren();
  try {
    const looksLikeUrl = /youtu(?:\.be|be\.com)/i.test(query);
    const mode = document.querySelector('input[name="searchMode"]:checked')?.value || "music";
    const data = looksLikeUrl
      ? { items: [await api(`/api/videos/resolve?url=${encodeURIComponent(query)}`)] }
      : await api(`/api/search?q=${encodeURIComponent(query)}&limit=8&mode=${mode}`);
    renderResults(data.items);
    setStatus(mode === "karaoke" ? "{count} výsledků s původním zpěvem a textem" : "{count} výsledků", "success", "searchStatus", { count: data.items.length });
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    state.busy = false;
    $("searchButton").disabled = false;
  }
}

async function loadDiscovery(category = "continue", more = false) {
  const version = ++state.discoveryVersion;
  state.discovery = category;
  if (!more) { state.discoveryOffset = 0; state.discoverySeen.clear(); }
  else { state.discoveryOffset = (state.discoveryOffset + 1) % 1001; }
  const buttons = [...document.querySelectorAll("[data-discovery]")];
  buttons.forEach((button) => button.classList.toggle("active", button.dataset.discovery === category));
  $("moreDiscovery").classList.toggle("hidden", category !== "continue");
  $("moreDiscovery").disabled = true;
  setStatus("Načítám výběr…", "", "discoverStatus");
  $("discoverResults").replaceChildren();
  try {
    const excluded = [...state.discoverySeen].slice(-180).join(",");
    const data = await api(`/api/discover?category=${encodeURIComponent(category)}&offset=${state.discoveryOffset}&exclude=${encodeURIComponent(excluded)}`);
    if (version !== state.discoveryVersion) return;
    renderResults(data.items, "discoverResults", "discoverStatus");
    data.items.forEach((song) => state.discoverySeen.add(song.video_id));
    const note = category === "continue" && data.playlist
      ? (data.autodj_enabled === false ? "Navazuje {playlist}. Automatické pokračování je vypnuté." : "Navazuje {playlist}. Při prázdné frontě pokračuje automaticky; tvoje volba má přednost.")
      : "Při prázdné frontě automaticky pokračuje playlist poslední skladby.";
    i18n.bind($("continuationNote"), note, { playlist: data.playlist || "" });
    const message = data.items.length
      ? "{count} tipů · {source}"
      : (data.reason === "no_playlist" ? "Obsluha zatím nemá vybraný playlist." : "V tomto výběru už vše hrálo. Zkus Další nabídku.");
    setStatus(message, data.items.length ? "success" : "", "discoverStatus", { count: data.items.length, source: data.playlist || data.source || "" });
  } catch (error) {
    if (version !== state.discoveryVersion) return;
    setStatus(error.message, "error", "discoverStatus");
  } finally {
    if (version === state.discoveryVersion) $("moreDiscovery").disabled = false;
  }
}

async function addSong(song, button, statusTarget = "searchStatus") {
  const requestedBy = localStorage.getItem("jukebox_name") || "";
  button.disabled = true;
  i18n.bind(button, "Přidávám…");
  try {
    await api("/api/queue", { method: "POST", body: JSON.stringify({ ...song, requested_by: requestedBy }) });
    i18n.bind(button, "✓ Ve frontě");
    setStatus("Skladba je ve frontě.", "success", statusTarget);
    await loadQueue(true);
  } catch (error) {
    button.disabled = false;
    i18n.bind(button, "+ Do fronty");
    setStatus(error.message, "error", statusTarget);
  }
}

async function voteSong(id, button) {
  button.disabled = true;
  try {
    await api(`/api/queue/${id}/vote`, { method: "POST" });
    await loadQueue(true);
  } catch (error) {
    button.disabled = false;
    setStatus(error.message, "error");
  }
}

async function cancelSong(id, title, button) {
  if (!window.confirm(t("Opravdu zrušit „{title}“?", { title }))) return;
  button.disabled = true;
  i18n.bind(button, "Ruším…");
  try {
    await api(`/api/queue/${id}`, { method: "DELETE" });
    setStatus("Skladba byla z fronty zrušena.", "success");
    await loadQueue(true);
  } catch (error) {
    button.disabled = false;
    i18n.bind(button, "Zrušit");
    setStatus(error.message, "error");
  }
}

async function boot() {
  $("searchForm").addEventListener("submit", search);
  $("skipOwnSong").addEventListener("click", skipOwnSong);
  $("refreshButton").addEventListener("click", () => loadQueue());
  $("moreDiscovery").addEventListener("click", () => loadDiscovery(state.discovery, true));
  document.querySelectorAll("[data-discovery]").forEach((button) => {
    button.addEventListener("click", () => loadDiscovery(button.dataset.discovery));
  });
  try {
    state.config = await api("/api/config");
    $("brandName").textContent = state.config.bar_name;
  } catch (_) {}
  await Promise.all([loadQueue(), loadDiscovery()]);
  setInterval(() => loadQueue(true), 3000);
}

boot();
