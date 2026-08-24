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

function displayStatus(text = "", type = "") {
  $("displayStatus").textContent = text;
  $("displayStatus").className = `status ${type}`.trim();
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

function renderVenueSettings() {
  if (!state.config) return;
  $("businessName").value = state.config.business_name || state.config.bar_name || "";
  $("menuText").value = state.config.menu_text || "";
  $("venuePlan").textContent = String(state.config.plan || "pilot").toUpperCase();
  const mode = document.querySelector(`input[name="tvMode"][value="${state.config.tv_mode || "clip"}"]`);
  if (mode) mode.checked = true;
  const audioMode = document.querySelector(`input[name="audioMode"][value="${state.config.audio_mode || "standard"}"]`);
  if (audioMode) audioMode.checked = true;
  const transitionMode = document.querySelector(`input[name="transitionMode"][value="${state.config.transition_mode || "scratch"}"]`);
  if (transitionMode) transitionMode.checked = true;
  $("transitionVolume").value = state.config.transition_volume ?? 55;
  $("targetLufs").value = state.config.target_lufs ?? -16;
  $("bassStrength").value = state.config.bass_guard_strength ?? 65;
  $("limiterCeiling").value = state.config.limiter_ceiling_db ?? -1;
  renderAudioValues();
  renderTransitionValues();
  renderAudioProcessor();
  renderNetworkLock();
}

function renderTransitionValues() {
  $("transitionVolumeValue").textContent = `${$("transitionVolume").value} %`;
  const enabled = document.querySelector('input[name="transitionMode"]:checked')?.value === "scratch";
  $("transitionControls").classList.toggle("disabled-controls", !enabled);
  $("transitionVolume").disabled = !enabled;
}

function renderNetworkLock() {
  const network = state.config?.network_lock || {};
  $("networkTitle").textContent = network.enabled ? "Pouze barová Wi‑Fi" : "Přístup není omezený";
  $("networkCopy").textContent = network.enabled
    ? `Povolená síť: ${network.allowed_network}${network.current_matches ? " · jsi v ní" : " · právě jsi mimo ni"}`
    : "Hosté mohou jukebox otevřít z jakékoliv sítě.";
  $("captureNetworkButton").textContent = network.enabled ? "Aktualizovat na tuto Wi‑Fi" : "Nastavit tuto Wi‑Fi";
  $("disableNetworkButton").classList.toggle("hidden", !network.enabled);
}

async function updateNetwork(action) {
  $("networkStatus").textContent = action === "capture" ? "Zjišťuji veřejnou IP…" : "Vypínám omezení…";
  try {
    const network = await api("/api/admin/network", { method: "PUT", body: JSON.stringify({ action }) });
    state.config = { ...state.config, network_lock: network };
    renderNetworkLock();
    $("networkStatus").textContent = action === "capture"
      ? "Uloženo. QR teď funguje jen na této Wi‑Fi."
      : "Omezení sítě je vypnuté.";
    $("networkStatus").className = "status success";
  } catch (error) {
    $("networkStatus").textContent = error.message;
    $("networkStatus").className = "status error";
  }
}

function renderAudioProcessor() {
  const processor = state.config.audio_processor || {};
  $("processorState").textContent = processor.connected ? "PŘIPOJEN" : "NEPŘIPOJEN";
  $("processorState").classList.toggle("connected", Boolean(processor.connected));
  if (!processor.connected) {
    $("processorMetrics").textContent = processor.status || "Na barovém počítači zatím neběží.";
    return;
  }
  const lufs = processor.measured_lufs == null ? "měřím" : `${Number(processor.measured_lufs).toFixed(1)} LUFS`;
  const bass = Number(processor.bass_reduction_db || 0).toFixed(1);
  const limiter = Number(processor.limiter_reduction_db || 0).toFixed(1);
  $("processorMetrics").textContent = `${processor.device_name || "Windows"} · ${lufs} · basy −${bass} dB · limiter −${limiter} dB`;
}

function renderAudioValues() {
  $("targetLufsValue").textContent = `${String($("targetLufs").value).replace("-", "−")} LUFS`;
  $("bassStrengthValue").textContent = `${$("bassStrength").value} %`;
  $("limiterValue").textContent = `${Number($("limiterCeiling").value).toFixed(1).replace("-", "−")} dB`;
  const enabled = document.querySelector('input[name="audioMode"]:checked')?.value === "bass_guard";
  $("audioControls").classList.toggle("disabled-controls", !enabled);
  for (const input of $("audioControls").querySelectorAll("input")) input.disabled = !enabled;
}

async function saveVenueSettings(event) {
  event.preventDefault();
  const selectedMode = document.querySelector('input[name="tvMode"]:checked');
  const selectedAudioMode = document.querySelector('input[name="audioMode"]:checked');
  const selectedTransitionMode = document.querySelector('input[name="transitionMode"]:checked');
  displayStatus("Ukládám a přepínám TV…");
  try {
    const saved = await api("/api/admin/display", {
      method: "PUT",
      body: JSON.stringify({
        business_name: $("businessName").value,
        tv_mode: selectedMode?.value || "clip",
        menu_text: $("menuText").value,
        transition_mode: selectedTransitionMode?.value || "scratch",
        transition_volume: Number($("transitionVolume").value),
        audio_mode: selectedAudioMode?.value || "standard",
        target_lufs: Number($("targetLufs").value),
        limiter_ceiling_db: Number($("limiterCeiling").value),
        bass_guard_strength: Number($("bassStrength").value),
      }),
    });
    state.config = { ...state.config, ...saved, bar_name: saved.business_name };
    $("brandName").textContent = saved.business_name;
    renderVenueSettings();
    displayStatus("Uloženo. TV se právě přepíná.", "success");
  } catch (error) {
    displayStatus(error.message, "error");
  }
}

async function loadAll(silent = false) {
  try {
    const firstLoad = !state.config;
    const [config, queue, player, audioProcessor] = await Promise.all([
      firstLoad ? api("/api/admin/config") : Promise.resolve(state.config),
      api("/api/queue"),
      api("/api/player/state"),
      firstLoad ? Promise.resolve(null) : api("/api/admin/audio/status"),
    ]);
    state.config = audioProcessor ? { ...config, audio_processor: audioProcessor } : config;
    state.queue = queue;
    state.player = player;
    $("brandName").textContent = config.bar_name;
    if (firstLoad) renderVenueSettings();
    else renderAudioProcessor();
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
  $("displayForm").addEventListener("submit", saveVenueSettings);
  for (const input of document.querySelectorAll('input[name="audioMode"]')) input.addEventListener("change", renderAudioValues);
  for (const input of document.querySelectorAll('input[name="transitionMode"]')) input.addEventListener("change", renderTransitionValues);
  $("transitionVolume").addEventListener("input", renderTransitionValues);
  for (const id of ["targetLufs", "bassStrength", "limiterCeiling"]) $(id).addEventListener("input", renderAudioValues);
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
  $("captureNetworkButton").addEventListener("click", () => updateNetwork("capture"));
  $("disableNetworkButton").addEventListener("click", () => updateNetwork("disable"));
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
