const $ = (id) => document.getElementById(id);
const state = { config: null, player: null, queue: [], volumeTimer: null };

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
  });
  let data = null;
  try { data = await response.json(); } catch (_) { data = {}; }
  if (!response.ok) {
    const error = new Error(data.detail || "Něco se nepovedlo.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function status(text = "", type = "") {
  $("adminStatus").textContent = text;
  $("adminStatus").className = `status ${type}`.trim();
}

function showAdmin() {
  $("loginView").classList.add("hidden");
  $("adminView").classList.remove("hidden");
}

function showLogin(message = "") {
  $("adminView").classList.add("hidden");
  $("loginView").classList.remove("hidden");
  $("loginStatus").textContent = message;
}

async function login(event) {
  event.preventDefault();
  $("loginStatus").textContent = "Ověřuji…";
  try {
    await api("/api/admin/login", { method: "POST", body: JSON.stringify({ pin: $("pin").value }) });
    $("pin").value = "";
    showAdmin();
    await loadAll();
  } catch (error) {
    $("loginStatus").textContent = error.message;
    $("loginStatus").className = "status error";
  }
}

function textBlock(className, text) {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  return el;
}

function renderQueue() {
  const root = $("queue");
  root.replaceChildren();
  const queued = state.queue.filter((song) => song.status === "queued");
  $("queueCount").textContent = `${queued.length} skladeb`;
  if (!queued.length) {
    root.append(textBlock("empty", "Fronta je prázdná."));
    return;
  }
  queued.forEach((song, index) => {
    const card = document.createElement("article");
    card.className = "song-card";
    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = "";
    img.loading = "lazy";
    img.src = song.thumbnail || `https://i.ytimg.com/vi/${song.video_id}/mqdefault.jpg`;
    const copy = document.createElement("div");
    copy.className = "song-copy";
    copy.append(
      textBlock("song-title", `${index + 1}. ${song.title}`),
      textBlock("song-meta", `${song.artist || "YouTube"} · ${song.votes} hlasů${song.priority ? " · přednost" : ""}${song.priority_requested ? " · čeká na platbu" : ""}`),
    );
    const actions = document.createElement("div");
    actions.className = "song-actions";
    const play = actionButton("Hrát", "btn compact", () => queueAction(song.id, "play"));
    const priority = actionButton(
      song.priority_requested ? `Potvrdit ${state.config.priority_price_czk} Kč` : `⚡ ${state.config.priority_price_czk} Kč`,
      song.priority_requested ? "btn compact" : "btn secondary compact",
      () => queueAction(song.id, "priority"),
    );
    const remove = actionButton("Smazat", "btn danger compact", () => removeSong(song.id));
    actions.append(play, priority, remove);
    card.append(img, copy, actions);
    root.append(card);
  });
}

function actionButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function renderPlayer() {
  const song = state.player?.now_playing;
  $("nowTitle").textContent = song?.title || "Nic nehraje";
  $("nowArtist").textContent = song?.artist || "TV čeká na první skladbu.";
  if (state.player) {
    $("volume").value = state.player.volume;
    $("volumeValue").textContent = `${state.player.volume} %`;
    $("nightButton").textContent = state.player.night_mode ? `Noční limit ${state.config.night_volume} % zapnutý` : "Noční limit vypnutý";
    $("nightButton").className = state.player.night_mode ? "btn compact" : "btn secondary compact";
  }
}

async function loadAll(silent = false) {
  try {
    const [config, queue, player] = await Promise.all([
      state.config ? Promise.resolve(state.config) : api("/api/admin/config"),
      api("/api/queue"),
      api("/api/player/state"),
    ]);
    state.config = config;
    state.queue = queue;
    state.player = player;
    $("brandName").textContent = config.bar_name;
    $("joinUrl").textContent = config.join_url;
    if (!state.configLoaded) {
      $("qr").src = `/api/admin/qr.svg?t=${Date.now()}`;
      state.configLoaded = true;
    }
    $("searchProvider").textContent = `Hledání: ${config.search_provider}`;
    $("secretsWarning").classList.toggle("hidden", config.production_secrets_ready);
    renderQueue();
    renderPlayer();
  } catch (error) {
    if (error.status === 401) showLogin("Přihlášení vypršelo.");
    else if (!silent) status(error.message, "error");
  }
}

async function queueAction(id, action) {
  try {
    await api(`/api/queue/${id}/${action}`, { method: "POST" });
    status(action === "priority" ? "Přednost potvrzena." : "Skladba se posílá na TV.", "success");
    await loadAll(true);
  } catch (error) { status(error.message, "error"); }
}

async function removeSong(id) {
  try {
    await api(`/api/queue/${id}`, { method: "DELETE" });
    await loadAll(true);
  } catch (error) { status(error.message, "error"); }
}

async function playerAction(path, successMessage) {
  try {
    await api(path, { method: "POST" });
    status(successMessage, "success");
    await loadAll(true);
  } catch (error) { status(error.message, "error"); }
}

async function control(action, value = null) {
  try {
    state.player = await api("/api/player/control", { method: "POST", body: JSON.stringify({ action, value }) });
    renderPlayer();
  } catch (error) { status(error.message, "error"); }
}

function wireEvents() {
  $("loginForm").addEventListener("submit", login);
  $("startButton").addEventListener("click", () => playerAction("/api/player/start", "Přehrávač spuštěn."));
  $("nextButton").addEventListener("click", () => playerAction("/api/player/next", "Přeskakuji na další skladbu."));
  $("pauseButton").addEventListener("click", () => control("pause"));
  $("resumeButton").addEventListener("click", () => control("resume"));
  $("nightButton").addEventListener("click", () => control("night", !Boolean(state.player?.night_mode)));
  $("volume").addEventListener("input", (event) => {
    $("volumeValue").textContent = `${event.target.value} %`;
    clearTimeout(state.volumeTimer);
    state.volumeTimer = setTimeout(() => control("volume", Number(event.target.value)), 180);
  });
  $("copyButton").addEventListener("click", async () => {
    await navigator.clipboard.writeText(state.config.join_url);
    status("Odkaz zkopírován.", "success");
  });
  $("logoutButton").addEventListener("click", async () => {
    await api("/api/admin/logout", { method: "POST" });
    showLogin();
  });
}

async function boot() {
  wireEvents();
  const me = await api("/api/me").catch(() => ({ admin: false }));
  if (!me.admin) return showLogin();
  showAdmin();
  await loadAll();
  setInterval(() => loadAll(true), 2500);
}

boot();
