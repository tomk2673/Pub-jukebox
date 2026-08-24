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

window.onYouTubeIframeAPIReady = () => {
  apiReady = true;
  if (authenticated) createPlayer();
};

function createPlayer() {
  if (!apiReady || player) return;
  player = new YT.Player("player", {
    width: "100%",
    height: "100%",
    playerVars: { autoplay: 1, controls: 0, rel: 0, modestbranding: 1, playsinline: 1 },
    events: {
      onReady: async () => {
        playerReady = true;
        await api("/api/player/start", { method: "POST" }).catch(() => null);
        await sync(true);
      },
      onStateChange: async (event) => {
        if (event.data === YT.PlayerState.ENDED) {
          await api("/api/player/ended", { method: "POST" }).catch(() => null);
          await sync(true);
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

function applyState(state, force = false) {
  const song = state.now_playing;
  showSong(song);
  if (!playerReady) return;
  const effectiveVolume = state.night_mode ? Math.min(state.volume, nightVolume) : state.volume;
  player.setVolume(effectiveVolume);
  if (song && (force || song.video_id !== currentVideo)) {
    currentVideo = song.video_id;
    player.loadVideoById(song.video_id);
  } else if (!song && currentVideo) {
    currentVideo = null;
    player.stopVideo();
  }
  if (state.revision !== lastRevision) {
    if (state.action === "pause") player.pauseVideo();
    if (state.action === "resume") player.playVideo();
    if (state.action === "load" && song) player.loadVideoById(song.video_id);
    lastRevision = state.revision;
  }
}

async function sync(force = false) {
  if (!authenticated) return;
  try {
    const [state, display] = await Promise.all([api("/api/player/state"), api("/api/display")]);
    applyDisplay(display);
    applyState(state, force);
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
    if (playerReady) player.playVideo();
    $("tapToPlay").classList.add("hidden");
  });
  const me = await api("/api/me").catch(() => ({ admin: false }));
  if (me.admin) await startTv();
  setInterval(() => sync(), 1500);
}

boot();
