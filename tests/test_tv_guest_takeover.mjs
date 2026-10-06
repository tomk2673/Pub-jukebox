import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../static/tv.js', import.meta.url), 'utf8').replace(/boot\(\);\s*$/, '');
const auto = {id: 1, video_id: 'auto', title: 'Auto', requested_by: 'AutoDJ · Funk', is_autodj: true};
const guest = {id: 2, video_id: 'guest', title: 'Guest', requested_by: 'Host', is_autodj: false};
function fixture({observer = false, timeout = false} = {}) {
  const elements = new Map();
  const calls = [];
  const context = vm.createContext({window: {}, document: {
    body: {classList: {toggle() {}}},
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {textContent: '', style: {}, classList: {toggle() {}}});
      return elements.get(id);
    },
  }, setTimeout, clearTimeout, calls, auto, guest, observer, timeout});
  vm.runInContext(source, context);
  vm.runInContext(`
    playbackEnabled = !observer; authenticated = true; deckReady = [true, true];
    currentSong = auto; currentVideo = auto.video_id; deckVideos = ['auto', null];
    players = [0, 1].map(index => ({
      setVolume: volume => calls.push(['volume', index, volume]),
      pauseVideo: () => calls.push(['pause', index]),
      playVideo: () => calls.push(['play', index]),
      loadVideoById: id => calls.push(['load', index, id]),
    }));
    api = async () => { throw new Error('Takeover must not mutate the server queue'); };
    preloadNextSong = () => {};
    resetDeck = index => calls.push(['reset', index]);
    startIncomingSong = async (index, song) => {
      calls.push(['start', index, song.video_id]);
      if (timeout) throw new Error('temporary timeout');
    };
    crossfadeDecks = async (outgoing, incoming, duration) => calls.push(['fade', outgoing, incoming, duration]);
  `, context);
  return {context, calls, elements};
}

const normal = fixture();
await normal.context.applyState({now_playing: guest, volume: 80, revision: 1, action: 'guest_takeover'});
assert.deepEqual(JSON.parse(JSON.stringify(normal.calls.slice(0, 4))), [['start', 1, 'guest'], ['fade', 0, 1, 6800], ['pause', 0], ['volume', 0, 0]]);
assert.equal(vm.runInContext('activeDeck', normal.context), 1);
assert.equal(vm.runInContext('currentVideo', normal.context), 'guest');
assert.equal(normal.elements.get('nowTitle').textContent, 'Guest');
assert.equal(normal.calls.some(call => call[0] === 'load'), false, 'successful fade must not restart the incoming song');
const volumes = normal.context.equalPowerVolumes(0.5, 80);
assert.equal(volumes.outgoing, volumes.incoming);
assert.ok(Math.abs(volumes.outgoing ** 2 + volumes.incoming ** 2 - 80 ** 2) < 120);
normal.calls.length = 0;
await normal.context.applyState({now_playing: {...guest, id: 3, video_id: 'next-guest'}, volume: 80, revision: 2});
assert.equal(normal.calls.some(call => call[0] === 'fade'), false, 'guest-to-guest change is not an AutoDJ takeover');

const observer = fixture({observer: true});
await observer.context.applyState({now_playing: guest, volume: 80, revision: 1});
assert.deepEqual(observer.calls, [], 'observer only updates the displayed song');
assert.equal(observer.elements.get('nowTitle').textContent, 'Guest');

const failed = fixture({timeout: true});
await failed.context.applyState({now_playing: guest, volume: 80, revision: 1});
assert.ok(failed.calls.some(call => call[0] === 'reset' && call[1] === 1));
assert.ok(failed.calls.some(call => call[0] === 'load' && call[2] === 'guest'), 'timeout preserves the guest and loads it on the active deck');
assert.equal(vm.runInContext('transitioning', failed.context), false);

const busy = fixture();
vm.runInContext('transitioning = true', busy.context);
await busy.context.applyState({now_playing: guest, volume: 80});
assert.deepEqual(busy.calls, []);
assert.equal(vm.runInContext('currentSong.id', busy.context), auto.id, 'polling cannot overwrite a transition in progress');

const namedGuest = fixture();
vm.runInContext("currentSong = {...auto, is_autodj: false}", namedGuest.context);
await namedGuest.context.applyState({now_playing: guest, volume: 80});
assert.equal(namedGuest.calls.some(call => call[0] === 'fade'), false, 'a guest name cannot impersonate AutoDJ');
console.log('TV takeover: second deck, equal-power fade, observer, timeout, transition guard and guest names verified.');
