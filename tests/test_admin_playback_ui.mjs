import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../static/admin.js', import.meta.url), 'utf8');
const song = {id: 7, video_id: 'track000007', title: 'Current guest', artist: 'Test'};
const profile = {
  business_name: 'Saved bar', tv_mode: 'dj', menu_text: 'Drink | 125 Kč',
  transition_mode: 'none', transition_volume: 31, autodj_enabled: false,
  autodj_playlists: [], autodj_custom_queries: '', audio_mode: 'bass_guard',
  target_lufs: -18, limiter_ceiling_db: -2, bass_guard_strength: 67,
};

function fixture({cache = null, storageUnavailable = false, config = profile} = {}) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) {
      const classes = new Set(id === 'resumeButton' ? ['hidden'] : []);
      elements.set(id, {
        textContent: '', className: '', checked: false, disabled: false,
        classList: {
          toggle(name, on) { on ? classes.add(name) : classes.delete(name); },
          contains(name) { return classes.has(name); },
        },
        setAttribute() {}, querySelectorAll: () => [],
      });
    }
    return elements.get(id);
  };
  const playlists = ['world_hits', 'funk', 'hiphop', 'house', 'soul_blues', 'karaoke']
    .map(value => ({value, checked: config.autodj_playlists.includes(value), disabled: false}));
  get('autodjControls').querySelectorAll = () => playlists;
  get('autodjEnabled').checked = config.autodj_enabled;
  let stored = cache;
  const sandbox = vm.createContext({
    document: {
      getElementById: get,
      querySelectorAll: selector => selector.includes(':checked')
        ? playlists.filter(input => input.checked) : playlists,
    },
    sessionStorage: {
      getItem() { if (storageUnavailable) throw new Error('blocked'); return stored; },
      setItem(_key, value) { if (storageUnavailable) throw new Error('blocked'); stored = value; },
    },
    Date, setTimeout, clearTimeout,
  });
  vm.runInContext(source.replace(/\nboot\(\);\s*$/, ''), sandbox);
  sandbox.profile = structuredClone(config);
  vm.runInContext('state.connected = true; state.config = profile;', sandbox);
  const run = code => vm.runInContext(code, sandbox);
  const render = (action, revision, nowPlaying = song) => {
    sandbox.player = {action, revision, now_playing: nowPlaying, volume: 67, night_mode: action === 'night'};
    run('state.player = player; renderPlayer();');
  };
  return {get, playlists, sandbox, run, render, cache: () => stored};
}

test('fresh tab offers pause and explicit resume after a volume or night command', () => {
  for (const action of ['volume', 'night', 'sync']) {
    const f = fixture();
    f.render(action, 12);
    assert.equal(f.run('state.paused'), null);
    assert.equal(f.get('playToggle').textContent, 'Ⅱ Pauza');
    assert.equal(f.get('resumeButton').classList.contains('hidden'), false);
    assert.equal(f.get('resumeButton').disabled, false);
    assert.equal(f.get('playbackLabel').textContent, 'PŘEHRÁVAČ');
    f.run('state.playbackBusy = true; renderPlayer();');
    assert.equal(f.get('resumeButton').disabled, true);
    f.run('state.playbackBusy = false; state.connected = false; renderPlayer();');
    assert.equal(f.get('resumeButton').disabled, true);
  }
});

test('known pause survives consecutive volume/night commands and a matching reload', () => {
  const f = fixture();
  f.render('load', 1);
  assert.equal(f.run('state.paused'), false);
  f.render('pause', 2);
  f.render('volume', 3);
  f.render('night', 4);
  assert.equal(f.run('state.paused'), true);
  assert.equal(f.get('playToggle').textContent, '▶ Pokračovat');
  assert.equal(f.get('resumeButton').classList.contains('hidden'), true);
  const reloaded = fixture({cache: f.cache()});
  reloaded.render('night', 4);
  assert.equal(reloaded.run('state.paused'), true);
  reloaded.render('resume', 5);
  assert.equal(reloaded.run('state.paused'), false);
  assert.equal(reloaded.get('playToggle').textContent, 'Ⅱ Pauza');
});

test('stale and legacy tab caches cannot hide the explicit resume path', () => {
  for (const cache of [
    JSON.stringify({songId: song.id, revision: 4, paused: false}),
    JSON.stringify({songId: song.id, paused: true}),
    JSON.stringify({songId: 99, revision: 7, paused: true}),
    'invalid json',
  ]) {
    const f = fixture({cache});
    f.render('volume', 7);
    assert.equal(f.run('state.paused'), null);
    assert.equal(f.get('resumeButton').classList.contains('hidden'), false);
  }
});

test('serialized slider writes preserve a known pause at every acknowledged revision', async () => {
  const f = fixture();
  f.render('pause', 2);
  const values = [];
  f.sandbox.transport = async (_path, options) => {
    values.push(JSON.parse(options.body).value);
    if (values.length === 1) f.run('state.volumePending = 67;');
    return {action: 'volume', revision: 2 + values.length, volume: values.at(-1)};
  };
  f.run('api = transport; state.volumePending = 25;');
  await f.run('flushVolume();');
  assert.deepEqual(values, [25, 67]);
  assert.equal(f.run('state.paused'), true);
  assert.equal(f.get('playToggle').textContent, '▶ Pokračovat');
  assert.equal(f.get('volume').value, 67);
});

test('missed commands and a different song invalidate local pause knowledge', () => {
  const f = fixture();
  f.render('resume', 2);
  f.render('night', 5); // Another tab could have paused, then changed volume/night.
  assert.equal(f.run('state.paused'), null);
  assert.equal(f.get('resumeButton').classList.contains('hidden'), false);
  f.render('pause', 6);
  f.render('volume', 7, {...song, id: 8});
  assert.equal(f.run('state.paused'), null);
  f.render('load', 8, null);
  assert.equal(f.get('resumeButton').classList.contains('hidden'), true);
  assert.equal(f.get('playToggle').textContent, '▶ Spustit');
});

test('unavailable storage does not block playback controls', () => {
  const f = fixture({storageUnavailable: true});
  f.render('night', 8);
  assert.equal(f.get('resumeButton').classList.contains('hidden'), false);
  f.render('pause', 9);
  assert.equal(f.get('playToggle').textContent, '▶ Pokračovat');
});

test('explicit resume sends only the existing TV-compatible command, with failure recovery', async () => {
  const f = fixture();
  f.render('night', 8);
  const calls = [];
  f.sandbox.transport = async (path, options) => {
    calls.push({path, payload: JSON.parse(options.body)});
    return {action: 'resume', revision: 9};
  };
  f.run('api = transport; loadAll = async () => null; state.queue = [{id: 8, status: "queued"}];');
  await f.run('control("resume");');
  assert.deepEqual(calls, [{path: '/api/player/control', payload: {action: 'resume', value: null}}]);
  assert.equal(f.run('state.player.now_playing.id'), song.id);
  assert.equal(f.run('state.queue[0].id'), 8);
  assert.equal(f.get('playToggle').textContent, 'Ⅱ Pauza');
  f.render('night', 12);
  f.sandbox.transport = async () => { throw new Error('Offline'); };
  f.run('api = transport;');
  await f.run('control("resume");');
  assert.match(f.get('adminStatus').textContent, /Offline/);
  assert.equal(f.get('resumeButton').classList.contains('hidden'), false);
  assert.equal(f.get('resumeButton').disabled, false);
});

test('disabled AutoDJ keeps genres editable while busy/offline still locks writes', () => {
  const f = fixture();
  f.run('renderAutoDjSettings();');
  assert.equal(f.playlists.every(input => !input.disabled), true);
  assert.equal(f.get('autodjControls').classList.contains('disabled-controls'), false);
  for (const flag of ['quickSaving', 'settingsSaving', 'audioSaving']) {
    f.run(`state.${flag} = true; renderAutoDjValues();`);
    assert.equal(f.playlists.every(input => input.disabled), true);
    f.run(`state.${flag} = false;`);
  }
  f.run('state.connected = false; renderAutoDjValues();');
  assert.equal(f.playlists.every(input => input.disabled), true);
});

test('an older control response cannot overwrite a newer observed playback state', async () => {
  const f = fixture();
  f.render('resume', 12);
  f.sandbox.transport = async () => ({action: 'pause', revision: 11});
  f.run('api = transport; loadAll = async () => null;');
  await f.run('control("pause");');
  assert.equal(f.run('state.player.revision'), 12);
  assert.equal(f.run('state.paused'), false);
  assert.equal(f.get('playToggle').textContent, 'Ⅱ Pauza');
});

test('select genres while off, then enable without overwriting saved venue/audio or a draft', async () => {
  const original = {...profile, autodj_custom_queries: 'disco classics\nold school hip hop'};
  const f = fixture({config: original});
  let saved = structuredClone(original);
  const writes = [];
  f.sandbox.transport = async (path, options = {}) => {
    if (path === '/api/admin/config') return structuredClone(saved);
    assert.equal(path, '/api/admin/display');
    saved = JSON.parse(options.body);
    writes.push(saved);
    return structuredClone(saved);
  };
  f.run('api = transport; loadAll = async () => null; state.venueDirty = true; state.audioDirty = true;');
  f.get('businessName').value = 'Unsaved draft';
  f.playlists.find(input => input.value === 'funk').checked = true;
  await f.run('saveAutoDjSettings();');
  assert.deepEqual(saved, {...original, autodj_playlists: ['funk']});
  assert.equal(f.get('businessName').value, 'Unsaved draft');
  assert.equal(f.run('state.venueDirty && state.audioDirty'), true);
  f.get('autodjEnabled').checked = true;
  await f.run('saveAutoDjSettings();');
  assert.deepEqual(saved, {...original, autodj_enabled: true, autodj_playlists: ['funk']});
  assert.equal(writes.length, 2);
});

test('empty enable and failed genre save roll back while leaving the picker usable', async () => {
  const f = fixture();
  let writes = 0;
  f.sandbox.transport = async (path) => {
    if (path === '/api/admin/config') return structuredClone(profile);
    writes++;
    throw new Error('Test outage');
  };
  f.run('api = transport; loadAll = async () => null; state.venueDirty = true;');
  f.get('autodjEnabled').checked = true;
  await f.run('saveAutoDjSettings();');
  assert.equal(writes, 0);
  assert.equal(f.get('autodjEnabled').checked, false);
  assert.equal(f.playlists.every(input => !input.disabled), true);
  f.playlists.find(input => input.value === 'funk').checked = true;
  await f.run('saveAutoDjSettings();');
  assert.equal(writes, 1);
  assert.equal(f.playlists.every(input => !input.checked && !input.disabled), true);
  assert.match(f.get('autodjStatus').textContent, /Test outage/);
});
