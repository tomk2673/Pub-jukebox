import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

function element() {
  const classes = new Set();
  return {textContent: '', disabled: false, children: [],
    classList: {toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name)},
    style: {setProperty() {}, removeProperty() {}},
    replaceChildren(...nodes) { this.children = nodes; }, append(...nodes) { this.children.push(...nodes); },
    setAttribute() {}, addEventListener() {}};
}
const elements = new Map();
const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
const context = vm.createContext({document: {getElementById: get, createElement: element}, window: {confirm: () => true}, AbortController, setTimeout, clearTimeout});
const source = fs.readFileSync(new URL('../static/guest.js', import.meta.url), 'utf8').replace(/\nboot\(\);\s*$/, '');
vm.runInContext(source, context);
const own = {id: 1, video_id: 'a', title: 'Own song', status: 'playing', requested_by_me: true};
const next = {id: 2, video_id: 'b', title: 'Someone else', status: 'queued', requested_by_me: false};
function show(queue) { context.queue = queue; vm.runInContext('state.queue = queue; renderQueue()', context); }
show([own, next]);
assert.equal(get('ownSongActions').classList.contains('hidden'), false);
show([{...own, requested_by_me: false}]);
assert.equal(get('ownSongActions').classList.contains('hidden'), true);
show([{...own, is_autodj: true}]);
assert.equal(get('ownSongActions').classList.contains('hidden'), true);
show([]);
assert.equal(get('ownSongActions').classList.contains('hidden'), true);

show([own, next]);
const calls = [];
let finish;
context.api = async (path, options) => {
  calls.push({path, options});
  if (options?.method === 'POST') return new Promise(resolve => { finish = resolve; });
  return [{...next, status: 'playing'}];
};
const skipping = context.skipOwnSong();
assert.equal(get('skipOwnSong').disabled, true);
await context.skipOwnSong();
assert.equal(calls.filter(c => c.options?.method === 'POST').length, 1, 'double taps are ignored');
assert.equal(calls[0].path, '/api/queue/1/skip');
finish({ok: true, idempotent: false});
await skipping;
assert.equal(get('nowTitle').textContent, 'Someone else');
assert.equal(get('ownSongActions').classList.contains('hidden'), true);
assert.match(get('nowStatus').textContent, /přeskočena/);

show([own]);
context.api = async (path, options) => {
  if (options?.method === 'POST') throw new Error('Spojení se přerušilo.');
  return [own];
};
await context.skipOwnSong();
assert.equal(get('skipOwnSong').disabled, false);
assert.match(get('nowStatus').textContent, /přerušilo/);

let oldResolve;
let request = 0;
context.api = () => ++request === 1 ? new Promise(resolve => { oldResolve = resolve; }) : Promise.resolve([{...next, status: 'playing'}]);
const oldPoll = context.loadQueue(true);
await context.loadQueue(true);
oldResolve([own]);
await oldPoll;
assert.equal(get('nowTitle').textContent, 'Someone else', 'a delayed poll cannot restore the skipped track');
console.log('Guest skip UI: ownership, double taps, next song, retry and stale polling verified.');
