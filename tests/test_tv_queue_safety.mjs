import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../static/tv.js", import.meta.url), "utf8").replace(/boot\(\);\s*$/, "");
const elements = new Map();
const document = {body: {classList: {toggle() {}}}, getElementById(id) {
  if (!elements.has(id)) elements.set(id, {textContent: "", classList: {toggle() {}, add() {}, remove() {}}});
  return elements.get(id);
}};
const context = vm.createContext({window: {}, document, navigator: {userAgent: "iPhone", maxTouchPoints: 1}, setTimeout, clearTimeout, Date, console});
vm.runInContext(source, context);
assert.equal(vm.runInContext("isMobileViewer()", context), true);
const queue = [{id: 2, video_id: "second"}, {id: 3, video_id: "third"}];
context.queue = queue;
context.calls = [];
vm.runInContext(`
  makeSureNextSongExists = async () => queue;
  startIncomingSong = async () => { throw new Error("temporary timeout"); };
  resetDeck = () => {};
  api = async (path, options) => calls.push({path, options});
`, context);
await assert.rejects(context.prepareReservedNextSong(1, 1), /temporary timeout/);
assert.deepEqual(context.calls, [], "Timeout must neither delete songs nor start AutoDJ or transition");
assert.equal(queue.length, 2);

context.calls.length = 0;
vm.runInContext(`
  startIncomingSong = async () => { const e = new Error("player config"); e.youtubeCode = 153; throw e; };
`, context);
await assert.rejects(context.prepareReservedNextSong(1, 1), /player config/);
assert.equal(context.calls.length, 0, "Configuration errors must preserve the whole queue");

vm.runInContext(`
  playbackEnabled = false; authenticated = true; deckReady = [true,true];
  preloadNextSong = async () => { throw new Error("observer preloaded a song"); };
`, context);
await context.finishCurrentSong();
await context.ensureAutoDjBuffer({now_playing: null});
context.onDeckError(0, {data: 100});
context.onDeckReady(0);
assert.equal(context.calls.length, 0, "An observer must never mutate playback");
await context.applyState({now_playing: {id: 1, title: "Song on PC", artist: "Artist"}, volume: 80});
assert.equal(elements.get("observerTitle").textContent, "Song on PC");

const guard = vm.createContext({window: {}, fetch: () => {throw new Error("unexpected network");}});
vm.runInContext(source, guard);
vm.runInContext("playbackEnabled = false", guard);
await assert.rejects(guard.api("/api/queue/2", {method: "DELETE"}), /náhled/);
console.log("Queue preserved on timeout/config errors; mobile observer updates title without playback writes.");
