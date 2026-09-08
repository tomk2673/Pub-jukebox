const $ = (id) => document.getElementById(id);

let authenticated = false;
let apiReady = false;
let deckReady = [false, false];
let players = [null, null];
let activeDeck = 0;
let currentVideo = null;
let currentSong = null;
let queuedNextVideo = null;
let deckVideos = [null, null];
let lastRevision = -1;
let displayRevision = -1;
let displayMode = "clip";
let nightVolume = 55;
let transitionMode = "scratch";
let transitionVolume = 55;
let effectiveVolume = 80;
let transitionAudio = null;
let transitioning = false;
let transitionBag = [];
let lastTransitionId = null;
let autoDjEnabled = true;
let autoDjBusy = false;
let nextAutoDjAttempt = 0;
let outroTriggeredVideo = null;
let outroCheckBusy = false;

const MIX_LEAD_SECONDS = 9.0;
const DJ_OUTRO_LEAD_SECONDS = MIX_LEAD_SECONDS;
const MIX_DURATION_MS = 5200;
const MIX_STEPS = 52;

const TRANSITION_VARIANTS = Object.freeze([
  Object.freeze({ id: "backspin", label: "DJ BACKSPIN", duration: 0.92 }),
  Object.freeze({ id: "chirp", label: "CHIRP CUT", duration: 0.68 }),
  Object.freeze({ id: "transformer", label: "TRANSFORMER CUT", duration: 0.78 }),
  Object.freeze({ id: "tape-stop", label: "TAPE STOP", duration: 0.86 }),
  Object.freeze({ id: "vinyl-flip", label: "VINYL FLIP", duration: 0.74 }),
]);

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

function unlockTransitionAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!transitionAudio) transitionAudio = new AudioContextClass({ latencyHint: "interactive" });
  if (transitionAudio.state === "suspended") transitionAudio.resume().catch(() => null);
  return transitionAudio;
}

function getTransitionVariants() {
  return TRANSITION_VARIANTS.map((variant) => ({ ...variant }));
}

function chooseTransitionVariant(random = Math.random) {
  if (!transitionBag.length) {
    transitionBag = TRANSITION_VARIANTS.map((variant) => variant.id);
    for (let index = transitionBag.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [transitionBag[index], transitionBag[swapIndex]] = [transitionBag[swapIndex], transitionBag[index]];
    }
    if (transitionBag.length > 1 && transitionBag[0] === lastTransitionId) {
      [transitionBag[0], transitionBag[1]] = [transitionBag[1], transitionBag[0]];
    }
  }
  const selectedId = transitionBag.shift();
  lastTransitionId = selectedId;
  return TRANSITION_VARIANTS.find((variant) => variant.id === selectedId) || TRANSITION_VARIANTS[0];
}

function synthesizeTransitionSamples(sampleRate, variant = TRANSITION_VARIANTS[0], random = Math.random) {
  const selected = typeof variant === "string"
    ? TRANSITION_VARIANTS.find((item) => item.id === variant) || TRANSITION_VARIANTS[0]
    : variant;
  const duration = selected.duration;
  const frameCount = Math.ceil(sampleRate * duration);
  const samples = new Float32Array(frameCount);
  let phase = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const progress = frame / frameCount;
    const time = frame / sampleRate;
    const envelope = Math.sin(Math.PI * progress) ** 0.62;
    const noise = random() * 2 - 1;
    let signal = 0;
    if (selected.id === "chirp") {
      const stroke = (progress * 5) % 1;
      const direction = Math.floor(progress * 5) % 2 === 0 ? 1 : -0.72;
      const frequency = 680 + 2050 * (direction > 0 ? stroke : 1 - stroke);
      phase += direction * 2 * Math.PI * frequency / sampleRate;
      signal = (Math.sin(phase) + noise * 0.2) * Math.sin(Math.PI * stroke) ** 1.6 * envelope * 0.48;
    } else if (selected.id === "transformer") {
      const slice = (progress * 9) % 1;
      const frequency = 540 + 760 * (1 - progress) + 110 * Math.sin(time * 34);
      phase += 2 * Math.PI * frequency / sampleRate;
      const gate = slice < 0.58 ? Math.sin(Math.PI * slice / 0.58) ** 0.7 : 0;
      signal = (Math.sin(phase) + 0.38 * Math.sin(phase * 0.5) + noise * 0.18) * gate * envelope * 0.5;
    } else if (selected.id === "tape-stop") {
      const frequency = 1180 * (1 - progress) ** 3.2 + 82;
      phase += 2 * Math.PI * frequency / sampleRate;
      signal = (Math.sin(phase) + 0.3 * Math.sin(phase * 0.48) + noise * 0.13) * envelope * (1 - 0.3 * progress) * 0.5;
    } else if (selected.id === "vinyl-flip") {
      const stroke = (progress * 6) % 1;
      const reverse = Math.floor(progress * 6) % 2 === 1;
      const frequency = 760 + 1280 * Math.sin(Math.PI * stroke) ** 2;
      phase += (reverse ? -0.78 : 1) * 2 * Math.PI * frequency / sampleRate;
      signal = (Math.sin(phase) + noise * 0.17) * envelope * 0.46;
    } else {
      const frequency = 1450 * (1 - progress) ** 2 + 115;
      phase += 2 * Math.PI * frequency / sampleRate;
      signal = (Math.sin(phase) + 0.32 * Math.sin(phase * 0.51) + noise * 0.28) * envelope * 0.46;
    }
    samples[frame] = signal;
  }
  return samples;
}

async function playScratchTransition() {
  if (transitionMode !== "scratch") return;
  const variant = chooseTransitionVariant();
  const view = $("djTransition");
  $("transitionLabel").textContent = variant.label;
  view.style.setProperty("--transition-duration", `${variant.duration}s`);
  view.classList.remove("hidden");
  const context = unlockTransitionAudio();
  if (context && transitionVolume > 0 && context.state !== "closed") {
    const start = context.currentTime + 0.015;
    const transitionSamples = synthesizeTransitionSamples(context.sampleRate, variant);
    const buffer = context.createBuffer(1, transitionSamples.length, context.sampleRate);
    buffer.getChannelData(0).set(transitionSamples);
    const source = context.createBufferSource();
    const highpass = context.createBiquadFilter();
    const lowpass = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();
    const gain = context.createGain();
    source.buffer = buffer;
    highpass.type = "highpass";
    highpass.frequency.value = 180;
    lowpass.type = "lowpass";
    lowpass.frequency.value = 4800;
    compressor.threshold.value = -12;
    compressor.knee.value = 8;
    compressor.ratio.value = 10;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.08;
    const peakGain = Math.min(0.45, transitionVolume / 100 * effectiveVolume / 100 * 0.48);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peakGain), start + 0.045);
    gain.gain.setValueAtTime(Math.max(0.001, peakGain), start + variant.duration * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + variant.duration);
    source.connect(highpass).connect(lowpass).connect(compressor).connect(gain).connect(context.destination);
    source.start(start);
  }
  await new Promise((resolve) => setTimeout(resolve, Math.round(variant.duration * 1000)));
  view.classList.add("hidden");
}

function inactiveDeck() {
  return activeDeck === 0 ? 1 : 0;
}

function deckElement(index) {
  return document.getElementById(index === 0 ? "playerA" : "playerB");
}

function styleDeck(index, opacity = null) {
  const el = deckElement(index);
  if (!el) return;
  el.style.position = "absolute";
  el.style.inset = "0";
  el.style.width = "100%";
  el.style.height = "100%";
  el.style.border = "0";
  el.style.pointerEvents = "none";
  el.style.zIndex = index === activeDeck ? "2" : "1";
  el.style.opacity = opacity === null ? (index === activeDeck ? "1" : "0") : String(opacity);
}

function setDeckVisibility() {
  styleDeck(0);
  styleDeck(1);
}

function setAllDeckVolumes() {
  players.forEach((deck, index) => {
    if (!deckReady[index] || !deck) return;
    deck.setVolume(index === activeDeck ? effectiveVolume : 0);
  });
}

async function queuedSongs() {
  return (await api("/api/queue").catch(() => [])).filter((song) => song.status === "queued");
}

async function makeSureNextSongExists() {
  let queued = await queuedSongs();
  if (!queued.length && autoDjEnabled) {
    await api("/api/player/autodj/prepare", { method: "POST" }).catch(() => null);
    queued = await queuedSongs();
  }
  return queued;
}

async function preloadNextSong() {
  if (!deckReady.every(Boolean) || transitioning) return null;
  const queued = await makeSureNextSongExists();
  const next = queued[0] || null;
  if (!next) {
    queuedNextVideo = null;
    return null;
  }
  const target = inactiveDeck();
  if (deckVideos[target] !== next.video_id) {
    players[target].cueVideoById(next.video_id);
    players[target].setVolume(0);
    deckVideos[target] = next.video_id;
  }
  queuedNextVideo = next.video_id;
  return next;
}

function equalPowerVolumes(progress, master) {
  const p = Math.min(1, Math.max(0, progress));
  return {
    outgoing: Math.round(Math.cos(p * Math.PI / 2) * master),
    incoming: Math.round(Math.sin(p * Math.PI / 2) * master),
  };
}

async function crossfadeDecks(outgoing, incoming, durationMs = MIX_DURATION_MS) {
  const stepMs = durationMs / MIX_STEPS;
  const outgoingEl = deckElement(outgoing);
  const incomingEl = deckElement(incoming);
  if (incomingEl) incomingEl.style.zIndex = "3";
  for (let step = 0; step <= MIX_STEPS; step += 1) {
    const progress = step / MIX_STEPS;
    const { outgoing: outVol, incoming: inVol } = equalPowerVolumes(progress, effectiveVolume);
    players[outgoing]?.setVolume(outVol);
    players[incoming]?.setVolume(inVol);
    if (incomingEl) incomingEl.style.opacity = String(Math.min(1, progress * 1.35));
    if (outgoingEl) outgoingEl.style.opacity = String(Math.max(0.15, 1 - progress * 0.85));
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

async function finishCurrentSong(earlyMix = false) {
  if (transitioning) return;
  transitioning = true;
  const outgoing = activeDeck;
  const incoming = inactiveDeck();
  try {
    const queued = await makeSureNextSongExists();
    const next = queued[0] || null;
    if (!next) {
      await api("/api/player/ended", { method: "POST" });
      players[outgoing]?.stopVideo();
      deckVideos[outgoing] = null;
      currentVideo = null;
      return;
    }
    if (deckVideos[incoming] !== next.video_id) {
      players[incoming].cueVideoById(next.video_id);
      players[incoming].setVolume(0);
      deckVideos[incoming] = next.video_id;
    }
    players[incoming].playVideo();
    await new Promise((resolve) => setTimeout(resolve, 350));
    const mixPromise = crossfadeDecks(outgoing, incoming, earlyMix ? MIX_DURATION_MS : 2600);
    const fxPromise = transitionMode === "scratch" ? playScratchTransition() : Promise.resolve();
    await Promise.all([mixPromise, fxPromise]);
    players[outgoing]?.pauseVideo();
    players[outgoing]?.setVolume(0);
    activeDeck = incoming;
    currentVideo = next.video_id;
    queuedNextVideo = null;
    outroTriggeredVideo = null;
    setDeckVisibility();
    await api("/api/player/ended", { method: "POST" });
    players[activeDeck]?.setVolume(effectiveVolume);
  } catch (_) {
    await api("/api/player/ended", { method: "POST" }).catch(() => null);
  } finally {
    transitioning = false;
  }
  await sync(true);
  setTimeout(() => preloadNextSong(), 300);
}

async function monitorDjOutro() {
  if (!deckReady[activeDeck] || transitioning || outroCheckBusy || !currentVideo) return;
  const deck = players[activeDeck];
  if (!deck || deck.getPlayerState() !== YT.PlayerState.PLAYING) return;
  const duration = Number(deck.getDuration?.() || 0);
  const position = Number(deck.getCurrentTime?.() || 0);
  const remaining = duration - position;
  if (duration < 30 || remaining <= 0 || remaining > DJ_OUTRO_LEAD_SECONDS) return;
  if (outroTriggeredVideo === currentVideo) return;
  outroCheckBusy = true;
  try {
    const next = await preloadNextSong();
    if (!next) return;
    outroTriggeredVideo = currentVideo;
    await finishCurrentSong(true);
  } finally {
    outroCheckBusy = false;
  }
}

window.onYouTubeIframeAPIReady = () => {
  apiReady = true;
  if (authenticated) createPlayers();
};

function onDeckReady(index) {
  deckReady[index] = true;
  styleDeck(index);
  players[index].setVolume(index === activeDeck ? effectiveVolume : 0);
  if (!deckReady.every(Boolean)) return;
  api("/api/player/start", { method: "POST" }).catch(() => null).finally(() => {
    sync(true).then(() => preloadNextSong());
  });
}

function onDeckStateChange(index, event) {
  if (event.data === YT.PlayerState.PLAYING) $("tapToPlay").classList.add("hidden");
  if (index === activeDeck && event.data === YT.PlayerState.ENDED && !transitioning) {
    finishCurrentSong(false);
  }
}

function onDeckError(index) {
  if (index === activeDeck && !transitioning) finishCurrentSong(false);
}

function makeDeck(index, elementId) {
  return new YT.Player(elementId, {
    width: "100%",
    height: "100%",
    playerVars: {
      autoplay: 1,
      controls: 0,
      disablekb: 1,
      fs: 0,
      iv_load_policy: 3,
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
    },
    events: {
      onReady: () => onDeckReady(index),
      onStateChange: (event) => onDeckStateChange(index, event),
      onError: () => onDeckError(index),
    },
  });
}

function createPlayers() {
  if (!apiReady || players[0] || players[1]) return;
  players[0] = makeDeck(0, "playerA");
  players[1] = makeDeck(1, "playerB");
}

function renderMenu(menuText) {
  const grid = $("menuGrid");
  grid.replaceChildren();
  const lines = String(menuText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 28);
  $("menuEmpty").classList.toggle("hidden", lines.length > 0);
  for (const line of lines) {
    const separator = line.lastIndexOf("|");
    if (separator < 0) {
      const section = document.createElement("div");
      section.className = "menu-section";
      section.textContent = line;
      grid.append(section);
      continue;
    }
    const item = document.createElement("div");
    item.className = "menu-item";
    const name = document.createElement("strong");
    const price = document.createElement("span");
    name.textContent = line.slice(0, separator).trim();
    price.textContent = line.slice(separator + 1).trim();
    item.append(name, price);
    grid.append(item);
  }
}

function applyDisplay(display) {
  if (!display) return;
  displayMode = ["clip", "dj", "menu"].includes(display.tv_mode) ? display.tv_mode : "clip";
  transitionMode = display.transition_mode === "none" ? "none" : "scratch";
  transitionVolume = Math.min(100, Math.max(0, Number(display.transition_volume ?? 55)));
  autoDjEnabled = display.autodj_enabled !== false;
  const brand = display.business_name || "PUB JUKEBOX";
  document.body.dataset.mode = displayMode;
  document.title = `${brand} · TV`;
  $("djBrand").textContent = brand;
  $("menuBrand").textContent = brand;
  $("overlayBrand").textContent = brand;
  $("djView").classList.toggle("hidden", displayMode !== "dj");
  $("menuView").classList.toggle("hidden", displayMode !== "menu");
  $("idleView").classList.toggle("hidden", Boolean(currentSong) || displayMode !== "clip");
  if (display.revision !== displayRevision) {
    renderMenu(display.menu_text);
    displayRevision = display.revision;
  }
}

async function ensureAutoDjBuffer(state) {
  if (!autoDjEnabled || autoDjBusy || Date.now() < nextAutoDjAttempt) return;
  autoDjBusy = true;
  nextAutoDjAttempt = Date.now() + 30000;
  try {
    const result = await api("/api/player/autodj/prepare", { method: "POST" });
    if (result.prepared && !state.now_playing) {
      await api("/api/player/start", { method: "POST" });
      setTimeout(() => sync(true), 250);
    }
  } catch (_) {
  } finally {
    autoDjBusy = false;
  }
}

function showSong(song) {
  currentSong = song || null;
  const hasSong = Boolean(song);
  document.body.classList.toggle("has-song", hasSong);
  $("idleView").classList.toggle("hidden", hasSong || displayMode !== "clip");
  $("overlay").classList.toggle("hidden", !hasSong);
  if (song) {
    $("nowTitle").textContent = song.title;
    $("nowArtist").textContent = song.artist || "YouTube";
    $("djTrack").textContent = song.title;
  } else {
    $("djTrack").textContent = "ČEKÁM NA PRVNÍ TRACK";
  }
}

async function applyState(state, force = false) {
  const song = state.now_playing;
  showSong(song);
  if (!deckReady.every(Boolean)) return;
  effectiveVolume = state.night_mode ? Math.min(state.volume, nightVolume) : state.volume;
  setAllDeckVolumes();
  if (song && (force || song.video_id !== currentVideo)) {
    const target = currentVideo ? activeDeck : activeDeck;
    if (!transitioning && deckVideos[target] !== song.video_id) {
      currentVideo = song.video_id;
      outroTriggeredVideo = null;
      deckVideos[target] = song.video_id;
      players[target].loadVideoById(song.video_id);
      players[target].setVolume(effectiveVolume);
    }
  } else if (!song && currentVideo) {
    currentVideo = null;
    players[activeDeck]?.stopVideo();
    deckVideos[activeDeck] = null;
  }
  if (state.revision !== lastRevision) {
    if (state.action === "pause") players[activeDeck]?.pauseVideo();
    if (state.action === "resume") players[activeDeck]?.playVideo();
    lastRevision = state.revision;
  }
  preloadNextSong();
}

async function sync(force = false) {
  if (!authenticated) return;
  try {
    const [state, display] = await Promise.all([api("/api/player/state"), api("/api/display")]);
    applyDisplay(display);
    await applyState(state, force);
    ensureAutoDjBuffer(state);
  } catch (error) {
    if (error.status === 401) {
      authenticated = false;
      $("loginView").classList.remove("hidden");
    }
  }
}

async function startTv() {
  const [config, display] = await Promise.all([api("/api/admin/config"), api("/api/display")]);
  nightVolume = config.night_volume;
  authenticated = true;
  applyDisplay(display);
  $("qr").src = `/api/admin/qr.svg?t=${Date.now()}`;
  $("loginView").classList.add("hidden");
  createPlayers();
  if (deckReady.every(Boolean)) {
    await api("/api/player/start", { method: "POST" });
    await sync(true);
    players[activeDeck]?.playVideo();
  }
  if (navigator.wakeLock) navigator.wakeLock.request("screen").catch(() => {});
}

async function login(event) {
  event.preventDefault();
  unlockTransitionAudio();
  $("loginStatus").textContent = "Připojuji TV…";
  try {
    await api("/api/admin/login", { method: "POST", body: JSON.stringify({ pin: $("pin").value }) });
    await startTv();
  } catch (error) {
    $("loginStatus").textContent = error.message;
  }
}

async function boot() {
  document.body.dataset.mode = "clip";
  $("loginForm").addEventListener("submit", login);
  $("tapToPlay").addEventListener("click", () => {
    unlockTransitionAudio();
    players[activeDeck]?.playVideo();
    $("tapToPlay").classList.add("hidden");
  });
  const me = await api("/api/me").catch(() => ({ admin: false }));
  if (me.admin) await startTv();
  setInterval(() => sync(), 1500);
  setInterval(() => monitorDjOutro(), 500);
}

boot();