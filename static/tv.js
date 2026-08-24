const $ = (id) => document.getElementById(id);
let player = null;
let authenticated = false;
let apiReady = false;
let playerReady = false;
let currentVideo = null;
let currentSong = null;
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
      const cut = Math.sin(Math.PI * stroke) ** 1.6;
      signal = (Math.sin(phase) + noise * 0.2) * cut * envelope * 0.48;
    } else if (selected.id === "transformer") {
      const slice = (progress * 9) % 1;
      const frequency = 540 + 760 * (1 - progress) + 110 * Math.sin(time * 34);
      phase += 2 * Math.PI * frequency / sampleRate;
      const gate = slice < 0.58 ? Math.sin(Math.PI * slice / 0.58) ** 0.7 : 0;
      signal = (Math.sin(phase) + 0.38 * Math.sin(phase * 0.5) + noise * 0.18) * gate * envelope * 0.5;
    } else if (selected.id === "tape-stop") {
      const frequency = 1180 * (1 - progress) ** 3.2 + 82;
      phase += 2 * Math.PI * frequency / sampleRate;
      const wobble = 0.76 + 0.24 * Math.sin(2 * Math.PI * (6 + progress * 8) * time);
      signal = (Math.sin(phase) + 0.3 * Math.sin(phase * 0.48) + noise * 0.13) * envelope * wobble * (1 - 0.3 * progress) * 0.5;
    } else if (selected.id === "vinyl-flip") {
      const stroke = (progress * 6) % 1;
      const reverse = Math.floor(progress * 6) % 2 === 1;
      const frequency = 760 + 1280 * Math.sin(Math.PI * stroke) ** 2;
      phase += (reverse ? -0.78 : 1) * 2 * Math.PI * frequency / sampleRate;
      const handCut = 0.24 + 0.76 * Math.sin(Math.PI * stroke) ** 0.8;
      signal = (Math.sin(phase) + 0.34 * Math.sin(phase * 0.53) + noise * 0.17) * envelope * handCut * 0.46;
    } else {
      const frequency = 1450 * (1 - progress) ** 2 + 115;
      phase += 2 * Math.PI * frequency / sampleRate;
      const handMotion = 0.38 + 0.62 * Math.abs(Math.sin(2 * Math.PI * (7.5 - 3.2 * progress) * time));
      signal = (Math.sin(phase) + 0.32 * Math.sin(phase * 0.51) + noise * 0.28) * envelope * handMotion * 0.46;
    }
    samples[frame] = signal;
  }
  return samples;
}

function synthesizeScratchSamples(sampleRate, duration = 0.92, random = Math.random) {
  return synthesizeTransitionSamples(sampleRate, { ...TRANSITION_VARIANTS[0], duration }, random);
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
    const samples = buffer.getChannelData(0);
    samples.set(transitionSamples);

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
    const peakGain = Math.min(0.55, transitionVolume / 100 * effectiveVolume / 100 * 0.58);
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

async function finishCurrentSong() {
  if (transitioning) return;
  transitioning = true;
  try {
    const queue = await api("/api/queue").catch(() => []);
    if (queue.some((song) => song.status === "queued")) await playScratchTransition();
    await api("/api/player/ended", { method: "POST" });
  } catch (_) {
    // Další synchronizace stav přehrávače bezpečně dorovná.
  } finally {
    transitioning = false;
  }
  await sync(true);
}

window.onYouTubeIframeAPIReady = () => {
  apiReady = true;
  if (authenticated) createPlayer();
};

function createPlayer() {
  if (!apiReady || player) return;
  player = new YT.Player("player", {
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
      onReady: async () => {
        playerReady = true;
        await api("/api/player/start", { method: "POST" }).catch(() => null);
        await sync(true);
      },
      onStateChange: async (event) => {
        if (event.data === YT.PlayerState.ENDED) {
          await finishCurrentSong();
        }
        if (event.data === YT.PlayerState.PLAYING) $("tapToPlay").classList.add("hidden");
      },
      onError: async () => {
        await api("/api/player/ended", { method: "POST" }).catch(() => null);
        setTimeout(() => sync(true), 700);
      },
    },
  });
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
  if (!playerReady) return;
  effectiveVolume = state.night_mode ? Math.min(state.volume, nightVolume) : state.volume;
  player.setVolume(effectiveVolume);
  if (song && (force || song.video_id !== currentVideo)) {
    const changedTrack = Boolean(currentVideo && song.video_id !== currentVideo);
    if (changedTrack && !force && transitionMode === "scratch") {
      if (transitioning) return;
      transitioning = true;
      player.pauseVideo();
      try {
        await playScratchTransition();
      } finally {
        transitioning = false;
      }
    }
    currentVideo = song.video_id;
    player.loadVideoById(song.video_id);
  } else if (!song && currentVideo) {
    currentVideo = null;
    player.stopVideo();
  }
  if (state.revision !== lastRevision) {
    if (state.action === "pause") player.pauseVideo();
    if (state.action === "resume") player.playVideo();
    lastRevision = state.revision;
  }
}

async function sync(force = false) {
  if (!authenticated) return;
  try {
    const [state, display] = await Promise.all([api("/api/player/state"), api("/api/display")]);
    applyDisplay(display);
    await applyState(state, force);
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
  createPlayer();
  if (playerReady) {
    await api("/api/player/start", { method: "POST" });
    await sync(true);
    player.playVideo();
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
    if (playerReady) player.playVideo();
    $("tapToPlay").classList.add("hidden");
  });
  const me = await api("/api/me").catch(() => ({ admin: false }));
  if (me.admin) await startTv();
  setInterval(() => sync(), 1500);
}

boot();
