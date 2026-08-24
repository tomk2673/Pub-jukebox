let audioContext = null;
let mediaStream = null;
let worklet = null;
let profileTimer = null;
let activeTabId = null;
let profileUrl = null;
let lastMetrics = null;
let lastHeartbeatAt = 0;

async function readProfile() {
  if (!profileUrl) return null;
  const response = await fetch(profileUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("Profil Bass Guardu není dostupný.");
  return response.json();
}

async function sendProfile() {
  try {
    const profile = await readProfile();
    worklet?.port.postMessage({ type: "config", config: profile });
  } catch (_) {
    // Poslední bezpečné nastavení zůstane aktivní i při krátkém výpadku internetu.
  }
}

async function stop() {
  clearInterval(profileTimer);
  profileTimer = null;
  if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
  if (audioContext) await audioContext.close().catch(() => null);
  mediaStream = null;
  audioContext = null;
  worklet = null;
  profileUrl = null;
  lastMetrics = null;
  lastHeartbeatAt = 0;
  const stoppedTab = activeTabId;
  activeTabId = null;
  if (stoppedTab) chrome.runtime.sendMessage({ target: "service-worker", type: "stopped", tabId: stoppedTab }).catch(() => null);
}

async function start(message) {
  await stop();
  activeTabId = message.tabId;
  profileUrl = message.profileUrl;
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: message.streamId,
      },
    },
    video: false,
  });
  mediaStream.getAudioTracks()[0].addEventListener("ended", () => stop());

  audioContext = new AudioContext({ latencyHint: "interactive" });
  await audioContext.audioWorklet.addModule("bass-guard-processor.js");
  const profile = await readProfile().catch(() => ({}));
  const source = audioContext.createMediaStreamSource(mediaStream);
  worklet = new AudioWorkletNode(audioContext, "night-bass-guard", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { config: profile },
  });
  worklet.port.onmessage = (event) => {
    if (event.data?.type !== "metrics" || !activeTabId) return;
    lastMetrics = {
      device_name: "Chrome na Windows",
      extension_version: chrome.runtime.getManifest().version,
      ...event.data.metrics,
    };
    const heartbeatAt = Date.now();
    if (heartbeatAt - lastHeartbeatAt < 5000) return;
    lastHeartbeatAt = heartbeatAt;
    chrome.runtime.sendMessage({
      target: "service-worker",
      type: "metrics",
      tabId: activeTabId,
      metrics: lastMetrics,
    }).catch(() => null);
  };
  source.connect(worklet).connect(audioContext.destination);
  await audioContext.resume();
  profileTimer = setInterval(sendProfile, 4000);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return;
  const operation = message.type === "start" ? start(message) : stop();
  operation.then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
