import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const elements = new Map();
const get = (id) => {
  if (!elements.has(id)) elements.set(id, {
    textContent: "", className: "", classList: { toggle() {} },
  });
  return elements.get(id);
};
const sandbox = vm.createContext({ document: { getElementById: get }, Date });
const source = fs.readFileSync(new URL("../static/admin.js", import.meta.url), "utf8");
vm.runInContext(source.replace(/\nboot\(\);\s*$/, ""), sandbox);
const render = (processor, extra = "") => {
  sandbox.processor = processor;
  vm.runInContext(`state.config = {audio_processor: processor}; state.audioReceivedAt = Date.now(); state.audioUnavailable = false; ${extra}; renderAudioProcessor()`, sandbox);
};
const active = { connected: true, age_seconds: 0, processing: true,
  applied_profile: {audio_mode: "bass_guard"}, settings_confirmed: true };
render(active);
assert.equal(get("processorState").textContent, "OCHRANA BĚŽÍ");
assert.match(get("audioSaveStatus").textContent, /PC potvrdilo/);
render({...active, age_seconds: 19});
assert.equal(get("processorState").textContent, "STAV NEZNÁMÝ");
assert.doesNotMatch(get("audioSaveStatus").textContent, /PC potvrdilo/);
render(active, "state.audioUnavailable = true");
assert.equal(get("processorState").textContent, "STAV NEZNÁMÝ");
render({...active, processing: false, applied_profile: null, settings_confirmed: false});
assert.equal(get("processorState").textContent, "PC PŘIPOJENO");
assert.match(get("audioSaveStatus").textContent, /aktualizuj/);
render({...active, processing: false, applied_profile: {audio_mode: "standard"}});
assert.equal(get("processorState").textContent, "OCHRANA VYPNUTÁ");
render({...active, settings_confirmed: false});
assert.match(get("audioSaveStatus").textContent, /Čekám/);
console.log("Mobile status: active, stale, offline, legacy, bypass and pending verified.");
