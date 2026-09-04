const $ = (id) => document.getElementById(id);
const state = { config: null, queue: [], busy: false };

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
  });
  let data = null;
  try { data = await response.json(); } catch (_) { data = {}; }
  if (!response.ok) throw new Error(data.detail || "Něco se nepovedlo.");
  return data;
}

function setStatus(text = "", type = "", target = "searchStatus") {
  const el = $(target);
  el.textContent = text;
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
  meta.textContent = [song.artist, song.requested_by ? `vybral/a ${song.requested_by}` : ""].filter(Boolean).join(" · ");
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
    button.textContent = "+ Do fronty";
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
  $("queueCount").textContent = String(queued.filter((song) => !isAutoDj(song)).length);
  if (playing) {
    $("nowTitle").textContent = playing.title;
    $("nowArtist").textContent = playing.artist || "YouTube";
    $("nowPanel").style.setProperty("--cover", `url("${imageFor(playing).replaceAll('"', '')}")`);
  } else {
    $("nowTitle").textContent = "Hudba čeká na první volbu";
    $("nowArtist").textContent = "Najdi skladbu a pošli ji do fronty.";
    $("nowPanel").style.removeProperty("--cover");
  }
  if (!queued.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Fronta je prázdná. Tvoje skladba může být první.";
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
      auto.textContent = "zásoba · tvoje volba ji předběhne";
      actions.append(auto);
    }
    if (!automatic) {
      const vote = document.createElement("button");
      vote.className = `btn compact ${song.voted_by_me ? "secondary" : "cyan"}`;
      vote.type = "button";
      vote.disabled = Boolean(song.voted_by_me);
      vote.textContent = song.voted_by_me ? `✓ ${song.votes}` : `▲ ${song.votes}`;
      vote.addEventListener("click", () => voteSong(song.id, vote));
      actions.append(vote);
    }
    if (song.requested_by_me && !automatic) {
      const cancel = document.createElement("button");
      cancel.className = "btn danger compact";
      cancel.type = "button";
      cancel.textContent = "Zrušit";
      cancel.setAttribute("aria-label", `Zrušit skladbu ${song.title}`);
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
  try {
    state.queue = await api("/api/queue");
    renderQueue();
    $("connection").textContent = "online";
  } catch (error) {
    $("connection").textContent = "bez spojení";
    if (!silent) setStatus(error.message, "error");
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
    setStatus(`${data.items.length} výsledků${mode === "karaoke" ? " s původním zpěvem a textem" : ""}`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    state.busy = false;
    $("searchButton").disabled = false;
  }
}

async function loadDiscovery(category = "popular") {
  const buttons = [...document.querySelectorAll("[data-discovery]")];
  buttons.forEach((button) => button.classList.toggle("active", button.dataset.discovery === category));
  setStatus("Načítám výběr…", "", "discoverStatus");
  $("discoverResults").replaceChildren();
  try {
    const data = await api(`/api/discover?category=${encodeURIComponent(category)}`);
    renderResults(data.items, "discoverResults", "discoverStatus");
    setStatus(`${data.items.length} tipů · ${data.source}`, "success", "discoverStatus");
  } catch (error) {
    setStatus(error.message, "error", "discoverStatus");
  }
}

async function addSong(song, button, statusTarget = "searchStatus") {
  const requestedBy = localStorage.getItem("jukebox_name") || "";
  button.disabled = true;
  button.textContent = "Přidávám…";
  try {
    await api("/api/queue", { method: "POST", body: JSON.stringify({ ...song, requested_by: requestedBy }) });
    button.textContent = "✓ Ve frontě";
    setStatus("Skladba je ve frontě.", "success", statusTarget);
    await loadQueue(true);
  } catch (error) {
    button.disabled = false;
    button.textContent = "+ Do fronty";
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
  if (!window.confirm(`Opravdu zrušit „${title}“?`)) return;
  button.disabled = true;
  button.textContent = "Ruším…";
  try {
    await api(`/api/queue/${id}`, { method: "DELETE" });
    setStatus("Skladba byla z fronty zrušena.", "success");
    await loadQueue(true);
  } catch (error) {
    button.disabled = false;
    button.textContent = "Zrušit";
    setStatus(error.message, "error");
  }
}

async function boot() {
  $("searchForm").addEventListener("submit", search);
  $("refreshButton").addEventListener("click", () => loadQueue());
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
