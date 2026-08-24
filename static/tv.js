const $ = (id) => document.getElementById(id);
let player = null;
let authenticated = false;
let apiReady = false;
let playerReady = false;
let currentVideo = null;
let lastRevision = -1;
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

function showSong(song) {
  const hasSong = Boolean(song);
  $("idleView").classList.toggle("hidden", hasSong);
  $("overlay").classList.toggle("hidden", !hasSong);
  if (song) {
    $("nowTitle").textContent = song.title;
    $("nowArtist").textContent = song.artist || "YouTube";
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
    const state = await api("/api/player/state");
    applyState(state, force);
  } catch (error) {
    if (error.status === 401) {
      authenticated = false;
      $("loginView").classList.remove("hidden");
    }
  }
}

async function login(event) {
  event.preventDefault();
  $("loginStatus").textContent = "Připojuji TV…";
  try {
    await api("/api/admin/login", { method: "POST", body: JSON.stringify({ pin: $("pin").value }) });
    const config = await api("/api/admin/config");
    nightVolume = config.night_volume;
    authenticated = true;
    $("qr").src = `/api/admin/qr.svg?t=${Date.now()}`;
    $("loginView").classList.add("hidden");
    $("idleView").classList.remove("hidden");
    createPlayer();
    if (playerReady) {
      await api("/api/player/start", { method: "POST" });
      await sync(true);
      player.playVideo();
    }
    if (navigator.wakeLock) navigator.wakeLock.request("screen").catch(() => {});
  } catch (error) {
    $("loginStatus").textContent = error.message;
  }
}

async function boot() {
  $("loginForm").addEventListener("submit", login);
  $("tapToPlay").addEventListener("click", () => {
    if (playerReady) player.playVideo();
    $("tapToPlay").classList.add("hidden");
  });
  const me = await api("/api/me").catch(() => ({ admin: false }));
  if (me.admin) {
    authenticated = true;
    $("qr").src = `/api/admin/qr.svg?t=${Date.now()}`;
    const config = await api("/api/admin/config");
    nightVolume = config.night_volume;
    $("loginView").classList.add("hidden");
    $("idleView").classList.remove("hidden");
    createPlayer();
  }
  setInterval(() => sync(), 1500);
}

boot();
