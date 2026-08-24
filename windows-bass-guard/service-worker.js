const OFFSCREEN_DOCUMENT = "offscreen.html";

async function ensureOffscreenDocument() {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [documentUrl],
  });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT,
    reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
    justification: "Zpracování zvuku TV karty přes Bass Guard DSP.",
  });
}

async function badge(tabId, text, color, title) {
  await chrome.action.setBadgeText({ tabId, text });
  if (color) await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setTitle({ tabId, title });
}

async function stopCapture(tabId) {
  await chrome.runtime.sendMessage({ target: "offscreen", type: "stop", tabId }).catch(() => null);
  await handleStopped(tabId);
}

async function handleStopped(tabId) {
  await chrome.storage.session.remove("bassGuardTabId");
  if (tabId) await badge(tabId, "", null, "Zapnout Night Bass Guard");
}

async function startCapture(tab) {
  const url = new URL(tab.url || "");
  if (url.protocol !== "https:" || url.pathname !== "/tv") {
    await badge(tab.id, "TV", "#ff5c68", "Nejdřív otevři TV přehrávač PUB Jukebox");
    return;
  }

  const previous = (await chrome.storage.session.get("bassGuardTabId")).bassGuardTabId;
  if (previous === tab.id) {
    await stopCapture(tab.id);
    return;
  }
  if (previous) await stopCapture(previous);

  await ensureOffscreenDocument();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "start",
    tabId: tab.id,
    streamId,
    profileUrl: `${url.origin}/api/display`,
  });
  if (!response?.ok) throw new Error(response?.error || "Zvukový procesor se nespustil.");
  await chrome.storage.session.set({ bassGuardTabId: tab.id });
  await badge(tab.id, "ON", "#259b67", "Night Bass Guard je aktivní");
}

chrome.action.onClicked.addListener((tab) => {
  startCapture(tab).catch(async () => {
    if (tab.id) await badge(tab.id, "ERR", "#ff5c68", "Bass Guard se nepodařilo spustit");
  });
});

async function heartbeat(tabId, metrics) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async (payload) => {
        const response = await fetch("/api/admin/audio/heartbeat", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        return response.ok;
      },
      args: [metrics],
    });
    if (results[0]?.result) await badge(tabId, "ON", "#259b67", "Night Bass Guard je aktivní");
    else await badge(tabId, "AUTH", "#ff9f2f", "TV musí být přihlášená admin PINem");
  } catch (_) {
    await badge(tabId, "ERR", "#ff5c68", "Bass Guard běží, ale neodesílá stav");
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target !== "service-worker") return;
  if (message.type === "metrics") heartbeat(message.tabId, message.metrics);
  if (message.type === "stopped") handleStopped(message.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.get("bassGuardTabId").then(({ bassGuardTabId }) => {
    if (bassGuardTabId === tabId) stopCapture(tabId);
  });
});
