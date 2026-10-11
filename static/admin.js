const $ = (id) => document.getElementById(id);
const state = {
  config: null, player: null, queue: [], volumeTimer: null, searchBusy: false,
  connected: false, playbackBusy: false, quickSaving: false, settingsSaving: false,
  venueDirty: false, queueKey: null, paused: false, commandVersion: 0,
};
const venueFields = [
  "business_name", "tv_mode", "menu_text", "transition_mode", "transition_volume",
  "autodj_enabled", "autodj_playlists", "autodj_custom_queries", "audio_mode",
  "target_lufs", "limiter_ceiling_db", "bass_guard_strength",
];

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
  });
  let data = null;
  try { data = await response.json(); } catch (_) { data = {}; }
  if (!response.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "Zkontroluj vyplněné hodnoty.";
    const error = new Error(detail || "Něco se nepovedlo.");
    error.status = response.status;
    if (response.status === 401) showLogin("Přihlášení vypršelo. Zadej PIN.");
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
  selectTab("music");
}

function showLogin(message = "") {
  $("adminView").classList.add("hidden");
  $("loginView").classList.remove("hidden");
  $("loginStatus").textContent = message;
  state.connected = false;
  state.session = (state.session || 0) + 1;
  clearTimeout(state.volumeTimer);
  state.volumePending = null;
}

function selectTab(name, focus = false) {
  for (const tab of ["music", "settings"]) {
    const selected = tab === name;
    $(`${tab}Panel`).classList.toggle("hidden", !selected);
    $(`${tab}Tab`).setAttribute("aria-selected", String(selected));
    $(`${tab}Tab`).tabIndex = selected ? 0 : -1;
  }
  if (focus) $(`${name}Tab`).focus();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function renderSaveAvailability() {
  const busy = state.quickSaving || state.settingsSaving || state.audioSaving;
  $("saveSettingsButton").disabled = Boolean(busy || !state.connected);
  $("saveAudioButton").disabled = Boolean(busy || !state.connected);
  $("venueFields").disabled = Boolean(busy || !state.connected);
  $("autodjEnabled").disabled = Boolean(busy || !state.connected);
  $("unsavedDot").classList.toggle("hidden", !state.venueDirty && !state.audioDirty);
  renderAutoDjValues();
}

function markVenueDirty() {
  state.venueDirty = true;
  displayStatus("Změny nejsou uložené.");
  renderSaveAvailability();
}

function connectionNotice(message = "") {
  $("connectionNotice").textContent = message;
  $("connectionNotice").classList.toggle("hidden", !message);
  $("connectionNotice").classList.toggle("error", Boolean(message));
}

async function login(event) {
  event.preventDefault();
  $("loginStatus").textContent = "Ověřuji…";
  try {
    await api("/api/admin/login", { method: "POST", body: JSON.stringify({ pin: $("pin").value }) });
    $("pin").value = "";
    state.config = null;
    state.configLoaded = false;
    state.venueDirty = false;
    state.audioDirty = false;
    state.queueKey = null;
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

function imageFor(song) {
  return song.thumbnail || `https://i.ytimg.com/vi/${song.video_id}/mqdefault.jpg`;
}

function renderAdminSearchResults(items) {
  const root = $("adminSearchResults");
  root.replaceChildren();
  $("clearSearchButton").classList.toggle("hidden", !items.length);
  for (const song of items) {
    const card = document.createElement("article");
    card.className = "song-card";
    const img = document.createElement("img");
    img.className = "thumb";
    img.src = imageFor(song);
    img.alt = "";
    img.loading = "lazy";
    const copy = document.createElement("div");
    copy.className = "song-copy";
    copy.append(
      textBlock("song-title", song.title),
      textBlock("song-meta", song.artist || "YouTube"),
    );
    const button = actionButton("+ Do fronty", "btn compact", () => addAdminSong(song, button));
    card.append(img, copy, button);
    root.append(card);
  }
}

async function searchAsAdmin(event) {
  event.preventDefault();
  if (state.searchBusy) return;
  const query = $("adminSearchInput").value.trim();
  if (query.length < 2) return;
  const looksLikeUrl = /youtu(?:\.be|be\.com)/i.test(query);
  if (!looksLikeUrl && query.length > 100) {
    $("adminSearchStatus").textContent = "Název zkrať na nejvýše 100 znaků.";
    $("adminSearchStatus").className = "status error";
    return;
  }
  state.searchBusy = true;
  $("adminSearchButton").disabled = true;
  $("adminSearchStatus").textContent = "Hledám na YouTube…";
  $("adminSearchResults").replaceChildren();
  $("clearSearchButton").classList.add("hidden");
  try {
    const data = looksLikeUrl
      ? { items: [await api(`/api/videos/resolve?url=${encodeURIComponent(query)}`)] }
      : await api(`/api/search?q=${encodeURIComponent(query)}&limit=6`);
    renderAdminSearchResults(data.items);
    $("adminSearchStatus").textContent = data.items.length ? `${data.items.length} výsledků` : "Nic nenalezeno. Zkus jiný název.";
    $("adminSearchStatus").className = "status success";
  } catch (error) {
    $("adminSearchStatus").textContent = error.message;
    $("adminSearchStatus").className = "status error";
  } finally {
    state.searchBusy = false;
    $("adminSearchButton").disabled = false;
  }
}

async function addAdminSong(song, button) {
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "Přidávám…";
  try {
    await api("/api/queue", {
      method: "POST",
      body: JSON.stringify({ ...song, requested_by: "Obsluha" }),
    });
    button.textContent = "✓ Ve frontě";
    $("adminSearchStatus").textContent = "Skladba jde rovnou do fronty.";
    $("adminSearchStatus").className = "status success";
    await loadAll(true);
  } catch (error) {
    button.disabled = false;
    button.textContent = "+ Do fronty";
    $("adminSearchStatus").textContent = error.message;
    $("adminSearchStatus").className = "status error";
  }
}

function renderQueue() {
  const root = $("queue");
  const queued = state.queue.filter((song) => song.status === "queued");
  const guestQueued = queued.filter((song) => !isAutoDj(song));
  const autoReady = queued.some(isAutoDj);
  $("queueCount").textContent = `${guestQueued.length} ve frontě${autoReady ? " + automat" : ""}`;
  // Keep focus and touch targets stable when a polling response changes nothing.
  const key = JSON.stringify([queued, state.config?.autodj_enabled]);
  if (key === state.queueKey) return;
  state.queueKey = key;
  root.replaceChildren();
  if (!queued.length) {
    root.append(textBlock("empty", state.config?.autodj_enabled
      ? "Nikdo nečeká. Hudbu doplní automat." : "Fronta je prázdná. Přidej skladbu nebo zapni automat."));
    return;
  }
  queued.forEach((song, index) => {
    const card = document.createElement("article");
    card.className = "song-card";
    const copy = document.createElement("div");
    copy.className = "song-copy";
    const automatic = isAutoDj(song);
    card.classList.toggle("automatic-song", automatic);
    card.dataset.songId = song.id;
    const position = textBlock("position", automatic ? "AUTO" : String(index + 1));
    copy.append(
      textBlock("song-title", song.title),
      textBlock("song-meta", automatic ? `${song.artist || "YouTube"} · připraveno automatem`
        : `${song.artist || "YouTube"} · ${song.requested_by || "Host"} · ${song.votes || 0} hlasů`),
    );
    const actions = document.createElement("div");
    actions.className = "song-actions";
    const play = actionButton("Hrát teď", "btn secondary", () => queueAction(song.id, "play"));
    const remove = actionButton("×", "btn danger remove-song", () => removeSong(song.id));
    play.setAttribute("aria-label", `Hrát teď: ${song.title}`);
    remove.setAttribute("aria-label", `Odebrat z fronty: ${song.title}`);
    remove.title = "Odebrat z fronty";
    play.disabled = remove.disabled = state.playbackBusy || !state.connected;
    actions.append(play);
    actions.append(remove);
    card.append(position, copy, actions);
    root.append(card);
  });
}

function isAutoDj(song) {
  return Boolean(song.is_autodj) || String(song.requested_by || "").startsWith("AutoDJ");
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
  $("nowArtist").textContent = song ? `${song.artist || "YouTube"}${isAutoDj(song) ? " · Automat" : ""}` : "Přidej skladbu nebo spusť automat.";
  if (state.player) {
    // Volume/night commands replace the last command on the existing server.
    // Retain a known pause in this tab, including after a reload, until load/resume.
    if (state.pauseSongId === undefined) {
      try {
        const cached = JSON.parse(sessionStorage.getItem("jukebox-admin-pause"));
        if (cached?.songId === song?.id) state.paused = Boolean(cached.paused);
      } catch (_) { /* Storage may be unavailable in private browsing. */ }
    }
    if (state.pauseSongId !== song?.id || state.pauseRevision !== state.player.revision) {
      if (state.pauseSongId !== undefined && state.pauseSongId !== song?.id) state.paused = false;
      if (state.player.action === "pause") state.paused = true;
      if (["resume", "load"].includes(state.player.action)) state.paused = false;
      state.pauseSongId = song?.id;
      state.pauseRevision = state.player.revision;
      try { sessionStorage.setItem("jukebox-admin-pause", JSON.stringify({ songId: song?.id, paused: state.paused })); } catch (_) {}
    }
    if (state.volumePending == null && !state.volumeSending && !state.volumeDragging) {
      $("volume").value = state.player.volume;
      $("volumeValue").textContent = `${state.player.volume} %`;
    }
    $("nightButton").textContent = state.player.night_mode ? `Noční limit ${state.config?.night_volume ?? 55} % ✓` : "Noční limit";
    $("nightButton").setAttribute("aria-pressed", String(Boolean(state.player.night_mode)));
  }
  $("playbackLabel").textContent = song ? (state.paused ? "POZASTAVENO" : "PRÁVĚ HRAJE") : "PŘEHRÁVAČ";
  $("playToggle").textContent = !song ? "▶ Spustit" : state.paused ? "▶ Pokračovat" : "Ⅱ Pauza";
  const unavailable = !state.connected || state.playbackBusy;
  $("playToggle").disabled = unavailable;
  $("nextButton").disabled = unavailable || (!song && !state.queue.some((item) => item.status === "queued"));
  $("nightButton").disabled = unavailable;
  $("volume").disabled = !state.connected;
  for (const button of $("queue").querySelectorAll("button")) button.disabled = unavailable;
  renderSaveAvailability();
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
  $("autodjCustomQueries").value = state.config.autodj_custom_queries || "";
  renderAutoDjSettings();
  $("targetLufs").value = state.config.target_lufs ?? -16;
  $("bassStrength").value = state.config.bass_guard_strength ?? 65;
  $("limiterCeiling").value = state.config.limiter_ceiling_db ?? -1;
  renderAudioValues();
  renderTransitionValues();
  renderAutoDjValues();
  renderAudioProcessor();
  renderNetworkLock();
}

function renderAutoDjValues() {
  const enabled = $("autodjEnabled").checked;
  $("autodjControls").classList.toggle("disabled-controls", !enabled);
  const busy = state.quickSaving || state.settingsSaving || state.audioSaving || !state.connected;
  for (const input of $("autodjControls").querySelectorAll("input")) input.disabled = Boolean(!enabled || busy);
  $("autodjSummary").textContent = enabled ? "Naváže posledním playlistem. Hosté mají přednost." : "Vypnutý. Hraje jen připravená fronta.";
}

function renderAutoDjSettings() {
  $("autodjEnabled").checked = state.config?.autodj_enabled !== false;
  const playlists = new Set(state.config?.autodj_playlists || ["world_hits", "funk", "hiphop", "house"]);
  for (const input of document.querySelectorAll('input[name="autodjPlaylist"]')) input.checked = playlists.has(input.value);
  renderAutoDjValues();
}

function savedVenuePayload(config) {
  return Object.fromEntries(venueFields.map((key) => [key, config[key]]));
}

async function saveAutoDjSettings() {
  if (state.quickSaving || state.settingsSaving || state.audioSaving || !state.connected) return;
  const changes = {
    autodj_enabled: $("autodjEnabled").checked,
    autodj_playlists: [...document.querySelectorAll('input[name="autodjPlaylist"]:checked')].map((input) => input.value),
  };
  state.quickSaving = true;
  state.settingsVersion = (state.settingsVersion || 0) + 1;
  renderSaveAvailability();
  $("autodjStatus").textContent = "Ukládám automat…";
  $("autodjStatus").className = "status";
  try {
    // Read saved settings, not the form draft, before a quick music-only change.
    const latest = await api("/api/admin/config");
    state.config = latest;
    if (changes.autodj_enabled && !changes.autodj_playlists.length && !latest.autodj_custom_queries?.trim()) {
      throw new Error("Nech vybraný alespoň jeden styl nebo ulož vlastní téma v Nastavení.");
    }
    const saved = await api("/api/admin/display", {
      method: "PUT", body: JSON.stringify({ ...savedVenuePayload(latest), ...changes }),
    });
    state.config = { ...latest, ...saved, bar_name: saved.business_name };
    if (!state.venueDirty && !state.audioDirty) renderVenueSettings();
    $("autodjStatus").textContent = changes.autodj_enabled ? "Uloženo. Automat naváže při prázdné frontě." : "Uloženo. Automat je vypnutý.";
    $("autodjStatus").className = "status success";
    await loadAll(true);
  } catch (error) {
    $("autodjStatus").textContent = `Neuloženo: ${error.message}`;
    $("autodjStatus").className = "status error";
  } finally {
    state.quickSaving = false;
    renderAutoDjSettings();
    renderSaveAvailability();
  }
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
  if (state.networkSaving) return;
  state.networkSaving = true;
  $("captureNetworkButton").disabled = $("disableNetworkButton").disabled = true;
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
  } finally {
    state.networkSaving = false;
    $("captureNetworkButton").disabled = $("disableNetworkButton").disabled = false;
  }
}

function renderAudioProcessor() {
  const processor = state.config?.audio_processor || {};
  const age = processor.age_seconds == null ? null
    : processor.age_seconds + (Date.now() - (state.audioReceivedAt || Date.now())) / 1000;
  const connected = processor.connected && age != null && age <= 18 && !state.audioUnavailable;
  const confirmed = connected && processor.settings_confirmed;
  $("processorState").textContent = !connected ? "STAV NEZNÁMÝ"
    : !processor.applied_profile ? "PC PŘIPOJENO"
    : processor.processing ? "OCHRANA BĚŽÍ" : "OCHRANA VYPNUTÁ";
  $("processorState").classList.toggle("connected", Boolean(connected && processor.processing));
  if (!connected) {
    $("processorMetrics").textContent = "Chybí aktuální zpráva z PC. Ochrana může dál běžet; její stav teď nelze ověřit.";
  } else {
    const lufs = processor.measured_lufs == null ? "měřím" : `${Number(processor.measured_lufs).toFixed(1)} LUFS`;
    const bass = Number(processor.bass_reduction_db || 0).toFixed(1);
    const limiter = Number(processor.limiter_reduction_db || 0).toFixed(1);
    $("processorMetrics").textContent = `${processor.device_name || "Windows"} · verze ${processor.extension_version || "?"} · ${lufs} · basy −${bass} dB · limiter −${limiter} dB · zpráva před ${Math.floor(age)} s`;
  }
  if (state.audioSaving || state.audioDirty || state.audioSaveError) return;
  const message = !connected ? "Nastavení uložené na serveru. Převzetí počítačem zatím není potvrzené."
    : !processor.applied_profile ? "PC posílá stav. Pro potvrzení nastavení aktualizuj Windows modul na 0.3.1."
    : confirmed ? "PC potvrdilo nastavení zvuku."
    : "Čekám, až PC převezme uložené nastavení…";
  $("audioSaveStatus").textContent = message;
  $("audioSaveStatus").className = confirmed ? "status success" : "status";
}

function markAudioDirty() {
  state.audioDirty = true;
  state.audioSaveError = false;
  $("audioSaveStatus").textContent = "Změny zvuku nejsou odeslané. Klepni na Použít zvuk na PC.";
  $("audioSaveStatus").className = "status";
  renderSaveAvailability();
}

async function saveAudioSettings() {
  if (state.audioSaving || state.quickSaving || state.settingsSaving || !state.connected) return;
  state.audioSaving = true;
  state.settingsVersion = (state.settingsVersion || 0) + 1;
  state.audioSaveError = false;
  state.audioDirty = false;
  renderSaveAvailability();
  $("audioSaveStatus").textContent = "Odesílám nastavení zvuku…";
  const profile = {
    audio_mode: document.querySelector('input[name="audioMode"]:checked')?.value || "standard",
    target_lufs: Number($("targetLufs").value),
    limiter_ceiling_db: Number($("limiterCeiling").value),
    bass_guard_strength: Number($("bassStrength").value),
  };
  try {
    const processor = await api("/api/admin/audio/settings", { method: "PUT", body: JSON.stringify(profile) });
    state.config = { ...state.config, ...profile, audio_processor: processor };
    state.audioReceivedAt = Date.now();
    state.audioUnavailable = false;
  } catch (error) {
    state.audioSaveError = true;
    state.audioDirty = true;
    $("audioSaveStatus").textContent = `Neodesláno: ${error.message}`;
    $("audioSaveStatus").className = "status error";
  } finally {
    state.audioSaving = false;
    renderSaveAvailability();
    renderAudioProcessor();
  }
}

async function refreshAudio() {
  if (!state.config || state.audioPolling) return;
  state.audioPolling = true;
  const version = state.settingsVersion || 0;
  try {
    const processor = await api("/api/admin/audio/status");
    state.config.audio_processor = processor;
    state.audioReceivedAt = Date.now();
    state.audioUnavailable = false;
    if (!state.audioDirty && !state.audioSaving && !state.settingsSaving && !state.quickSaving
        && version === (state.settingsVersion || 0) && processor.desired_profile) {
      const desired = processor.desired_profile;
      Object.assign(state.config, desired);
      $("targetLufs").value = desired.target_lufs;
      $("bassStrength").value = desired.bass_guard_strength;
      $("limiterCeiling").value = desired.limiter_ceiling_db;
      for (const input of document.querySelectorAll('input[name="audioMode"]')) {
        input.checked = input.value === desired.audio_mode;
      }
      renderAudioValues();
    }
  } catch (_) {
    state.audioUnavailable = true;
  } finally {
    state.audioPolling = false;
    renderAudioProcessor();
  }
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
  if (state.settingsSaving || state.quickSaving || state.audioSaving || !state.connected) return;
  state.settingsSaving = true;
  state.settingsVersion = (state.settingsVersion || 0) + 1;
  renderSaveAvailability();
  const selectedMode = document.querySelector('input[name="tvMode"]:checked');
  const selectedAudioMode = document.querySelector('input[name="audioMode"]:checked');
  const selectedTransitionMode = document.querySelector('input[name="transitionMode"]:checked');
  displayStatus("Ukládám nastavení…");
  try {
    const saved = await api("/api/admin/display", {
      method: "PUT",
      body: JSON.stringify({
        business_name: $("businessName").value,
        tv_mode: selectedMode?.value || "clip",
        menu_text: $("menuText").value,
        transition_mode: selectedTransitionMode?.value || "scratch",
        transition_volume: Number($("transitionVolume").value),
        autodj_enabled: state.config.autodj_enabled,
        autodj_playlists: state.config.autodj_playlists,
        autodj_custom_queries: $("autodjCustomQueries").value,
        audio_mode: selectedAudioMode?.value || "standard",
        target_lufs: Number($("targetLufs").value),
        limiter_ceiling_db: Number($("limiterCeiling").value),
        bass_guard_strength: Number($("bassStrength").value),
      }),
    });
    state.config = { ...state.config, ...saved, bar_name: saved.business_name };
    $("brandName").textContent = saved.business_name;
    state.venueDirty = false;
    state.audioDirty = false;
    state.audioSaveError = false;
    renderVenueSettings();
    await refreshAudio();
    displayStatus("Uloženo. TV převezme změny automaticky.", "success");
  } catch (error) {
    displayStatus(error.message, "error");
  } finally {
    state.settingsSaving = false;
    renderSaveAvailability();
  }
}

async function loadAll(silent = false) {
  if (state.loading) {
    await state.loading;
    if (silent) return;
  }
  const version = state.commandVersion;
  const session = state.session || 0;
  let resolveLoading;
  state.loading = new Promise((resolve) => { resolveLoading = resolve; });
  try {
    const firstLoad = !state.config;
    const [config, queue, player] = await Promise.all([
      firstLoad ? api("/api/admin/config") : Promise.resolve(state.config),
      api("/api/queue"),
      api("/api/player/state"),
    ]);
    if (session !== (state.session || 0)) return;
    if (firstLoad) state.config = config;
    const currentConfig = state.config;
    state.connected = true;
    connectionNotice();
    if (firstLoad) state.audioReceivedAt = Date.now();
    if (version === state.commandVersion) {
      state.queue = queue;
      state.player = player;
    }
    $("brandName").textContent = currentConfig.bar_name;
    if (firstLoad) renderVenueSettings();
    else renderAudioProcessor();
    $("joinUrl").textContent = currentConfig.join_url;
    if (!state.configLoaded) {
      $("qr").src = `/api/admin/qr.svg?t=${Date.now()}`;
      state.configLoaded = true;
    }
    $("searchProvider").textContent = `Hledání: ${currentConfig.search_provider}`;
    $("secretsWarning").classList.toggle("hidden", currentConfig.production_secrets_ready);
    renderQueue();
    renderPlayer();
  } catch (error) {
    state.connected = false;
    if (error.status === 401) showLogin("Přihlášení vypršelo.");
    else {
      connectionNotice("Spojení vypadlo. Zkouším znovu…");
      if (!silent) status(error.message, "error");
    }
    renderPlayer();
  } finally {
    resolveLoading();
    state.loading = null;
  }
}

async function queueAction(id, action) {
  await playbackMutation(() => api(`/api/queue/${id}/${action}`, { method: "POST" }), "Skladba se posílá na TV.");
}

async function removeSong(id) {
  await playbackMutation(() => api(`/api/queue/${id}`, { method: "DELETE" }), "Skladba odebraná z fronty.");
}

async function playerAction(path, successMessage) {
  await playbackMutation(() => api(path, { method: "POST" }), successMessage);
}

async function playbackMutation(operation, successMessage) {
  if (state.playbackBusy || !state.connected) return;
  state.playbackBusy = true;
  state.commandVersion++;
  renderPlayer();
  try {
    await operation();
    status(successMessage, "success");
    // Wait out a pre-command poll, then request a fresh queue/player snapshot.
    await state.loading;
    await loadAll(true);
  } catch (error) {
    status(error.message, "error");
  } finally {
    state.playbackBusy = false;
    renderPlayer();
  }
}

async function control(action, value = null) {
  const message = action === "pause" ? "Pozastaveno." : action === "resume" ? "Pokračuji v přehrávání." : "Noční limit změněn.";
  await playbackMutation(async () => {
    const player = await api("/api/player/control", { method: "POST", body: JSON.stringify({ action, value }) });
    // /control returns command state without now_playing in SQLite.
    if (player.revision >= (state.player?.revision || 0)) state.player = { ...state.player, ...player };
    if (action === "pause" || action === "resume") state.paused = action === "pause";
    renderPlayer();
  }, message);
}

async function togglePlayback() {
  if (state.player?.now_playing) return control(state.paused ? "resume" : "pause");
  await playbackMutation(async () => {
    if (!state.queue.some((song) => song.status === "queued") && state.config.autodj_enabled) {
      status("Připravuji skladbu pro automat…");
      await api("/api/player/autodj/prepare", { method: "POST" });
    }
    const result = await api("/api/player/start", { method: "POST" });
    if (!result.song) throw new Error("Zatím není připravená skladba. Přidej ji přes hledání.");
  }, "Přehrávač spuštěn.");
}

async function flushVolume() {
  if (state.volumeSending || state.volumePending == null) return;
  if (state.playbackBusy) {
    state.volumeTimer = setTimeout(flushVolume, 180);
    return;
  }
  state.volumeSending = true;
  try {
    // Serialize slider writes so a slower earlier response cannot undo the last value.
    while (state.volumePending != null && state.connected) {
      const value = state.volumePending;
      state.volumePending = null;
      state.commandVersion++;
      const player = await api("/api/player/control", {
        method: "POST", body: JSON.stringify({ action: "volume", value }),
      });
      if (player.revision >= (state.player?.revision || 0)) state.player = { ...state.player, ...player };
    }
  } catch (error) {
    state.volumePending = null;
    status(`Hlasitost se neuložila: ${error.message}`, "error");
  } finally {
    state.volumeSending = false;
    renderPlayer();
  }
}

function wireEvents() {
  $("loginForm").addEventListener("submit", login);
  for (const name of ["music", "settings"]) {
    $(`${name}Tab`).addEventListener("click", () => selectTab(name));
    $(`${name}Tab`).addEventListener("keydown", (event) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        selectTab(event.key === "Home" ? "music" : event.key === "End" ? "settings" : name === "music" ? "settings" : "music", true);
      }
    });
  }
  $("adminSearchForm").addEventListener("submit", searchAsAdmin);
  $("clearSearchButton").addEventListener("click", () => {
    $("adminSearchResults").replaceChildren();
    $("adminSearchStatus").textContent = "";
    $("clearSearchButton").classList.add("hidden");
    $("adminSearchInput").focus();
  });
  $("displayForm").addEventListener("submit", saveVenueSettings);
  $("displayForm").addEventListener("input", (event) => {
    if (event.target.name !== "audioMode" && !["targetLufs", "bassStrength", "limiterCeiling"].includes(event.target.id)) markVenueDirty();
  });
  for (const input of document.querySelectorAll('input[name="audioMode"]')) input.addEventListener("change", () => { renderAudioValues(); markAudioDirty(); });
  for (const input of document.querySelectorAll('input[name="transitionMode"]')) input.addEventListener("change", renderTransitionValues);
  $("transitionVolume").addEventListener("input", renderTransitionValues);
  $("autodjEnabled").addEventListener("change", saveAutoDjSettings);
  for (const input of document.querySelectorAll('input[name="autodjPlaylist"]')) input.addEventListener("change", saveAutoDjSettings);
  for (const id of ["targetLufs", "bassStrength", "limiterCeiling"]) $(id).addEventListener("input", () => { renderAudioValues(); markAudioDirty(); });
  $("saveAudioButton").addEventListener("click", saveAudioSettings);
  $("playToggle").addEventListener("click", togglePlayback);
  $("nextButton").addEventListener("click", () => playerAction("/api/player/next", "Přeskakuji na další skladbu."));
  $("nightButton").addEventListener("click", () => control("night", !Boolean(state.player?.night_mode)));
  $("volume").addEventListener("input", (event) => {
    $("volumeValue").textContent = `${event.target.value} %`;
    clearTimeout(state.volumeTimer);
    state.volumePending = Number(event.target.value);
    state.volumeTimer = setTimeout(flushVolume, 180);
  });
  $("volume").addEventListener("pointerdown", () => { state.volumeDragging = true; });
  for (const name of ["pointerup", "pointercancel", "blur"]) $("volume").addEventListener(name, () => {
    state.volumeDragging = false;
    flushVolume();
  });
  $("copyButton").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.config.join_url);
      $("copyStatus").textContent = "Odkaz zkopírován.";
      $("copyStatus").className = "status success";
    } catch (_) {
      $("copyStatus").textContent = "Kopírování není dostupné. Vyber odkaz nad tlačítkem a zkopíruj ho.";
      $("copyStatus").className = "status error";
    }
  });
  $("captureNetworkButton").addEventListener("click", () => updateNetwork("capture"));
  $("disableNetworkButton").addEventListener("click", () => updateNetwork("disable"));
  $("logoutButton").addEventListener("click", async () => {
    try {
      await api("/api/admin/logout", { method: "POST" });
      state.session = (state.session || 0) + 1;
      state.config = null;
      state.venueDirty = state.audioDirty = false;
      showLogin();
    } catch (error) { displayStatus(error.message, "error"); }
  });
  window.addEventListener("beforeunload", (event) => {
    if (state.venueDirty || state.audioDirty) { event.preventDefault(); event.returnValue = ""; }
  });
}

async function boot() {
  wireEvents();
  renderSaveAvailability();
  setInterval(() => {
    if (!$("adminView").classList.contains("hidden") && !document.hidden) {
      loadAll(true);
      refreshAudio();
    }
  }, 2500);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { state.audioUnavailable = true; renderAudioProcessor(); refreshAudio(); }
  });
  const me = await api("/api/me").catch(() => ({ admin: false }));
  if (!me.admin) return showLogin();
  showAdmin();
  await loadAll();
}

boot();
