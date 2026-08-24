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

function setStatus(text = "", type = "") {
  const el = $("searchStatus");
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

function renderResults(items) {
  const root = $("results");
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
    button.addEventListener("click", () => addSong(song, button));
    card.append(img, songCopy(song), button);
    root.append(card);
  });
}

function renderQueue() {
  const root = $("queue");
  root.replaceChildren();
  const playing = state.queue.find((song) => song.status === "playing");
  const queued = state.queue.filter((song) => song.status === "queued");
  $("queueCount").textContent = String(queued.length);
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
    position.textContent = `#${index + 1}`;
    const actions = document.createElement("div");
    actions.className = "song-actions";
    if (song.priority > 0) {
      const priority = document.createElement("span");
      priority.className = "priority small";
      priority.textContent = "⚡ přednost";
      actions.append(priority);
    } else if (song.priority_requested) {
      const pending = document.createElement("span");
      pending.className = "priority small";
      pending.textContent = "⚡ čeká na potvrzení";
      actions.append(pending);
    } else if (song.requested_by_me && state.config?.priority_price_czk > 0) {
      const priorityButton = document.createElement("button");
      priorityButton.className = "btn secondary compact";
      priorityButton.type = "button";
      priorityButton.textContent = `⚡ Předběhnout ${state.config.priority_price_czk} Kč`;
      priorityButton.addEventListener("click", () => requestPriority(song.id, priorityButton));
      actions.append(priorityButton);
    }
    const vote = document.createElement("button");
    vote.className = `btn compact ${song.voted_by_me ? "secondary" : "cyan"}`;
    vote.type = "button";
    vote.disabled = Boolean(song.voted_by_me);
    vote.textContent = song.voted_by_me ? `✓ ${song.votes}` : `▲ ${song.votes}`;
    vote.addEventListener("click", () => voteSong(song.id, vote));
    actions.append(vote);
    card.append(position, songCopy(song), actions);
    root.append(card);
  });
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
    const data = looksLikeUrl
      ? { items: [await api(`/api/videos/resolve?url=${encodeURIComponent(query)}`)] }
      : await api(`/api/search?q=${encodeURIComponent(query)}&limit=8`);
    renderResults(data.items);
    setStatus(`${data.items.length} výsledků`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    state.busy = false;
    $("searchButton").disabled = false;
  }
}

async function addSong(song, button) {
  const requestedBy = localStorage.getItem("jukebox_name") || "";
  button.disabled = true;
  button.textContent = "Přidávám…";
  try {
    await api("/api/queue", { method: "POST", body: JSON.stringify({ ...song, requested_by: requestedBy }) });
    button.textContent = "✓ Ve frontě";
    setStatus("Skladba je ve frontě.", "success");
    await loadQueue(true);
  } catch (error) {
    button.disabled = false;
    button.textContent = "+ Do fronty";
    setStatus(error.message, "error");
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

async function requestPriority(id, button) {
  button.disabled = true;
  try {
    const result = await api(`/api/queue/${id}/priority-request`, { method: "POST" });
    setStatus(result.message, "success");
    await loadQueue(true);
  } catch (error) {
    button.disabled = false;
    setStatus(error.message, "error");
  }
}

async function boot() {
  $("searchForm").addEventListener("submit", search);
  $("refreshButton").addEventListener("click", () => loadQueue());
  try {
    state.config = await api("/api/config");
    $("brandName").textContent = state.config.bar_name;
  } catch (_) {}
  await loadQueue();
  setInterval(() => loadQueue(true), 3000);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/static/sw.js").catch(() => {});
}

boot();
