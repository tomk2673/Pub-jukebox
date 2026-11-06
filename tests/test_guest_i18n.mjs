import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { guestContext } from './helpers/guest-ui.mjs';

const {context, get, element, i18n, storage, document} = guestContext();
assert.equal(i18n.language, 'cs');
get('searchInput').value = 'Jamiroquai';
const result = {id: 12, title: 'Hledat', artist: 'Český interpret', requested_by: '<b>Tomáš</b>',
  video_id: 'dQw4w9WgXcQ', status: 'queued', requested_by_me: true, votes: 2};
context.songs = [result];
vm.runInContext('state.queue = songs; renderQueue(); renderResults(songs)', context);
const resultCard = get('results').children[0];
const addButton = resultCard.children[2];
const cancel = get('queue').children[0].children[2].children[1];
assert.equal(addButton.textContent, '+ Do fronty');
i18n.setLanguage('en');
assert.equal(document.documentElement.lang, 'en');
assert.equal(addButton.textContent, '+ Add to queue');
assert.equal(cancel.textContent, 'Remove');
assert.equal(cancel.getAttribute('aria-label'), 'Remove song Hledat');
assert.equal(resultCard.children[1].children[0].textContent, 'Hledat', 'song titles remain untouched');
assert.equal(resultCard.children[1].children[1].children[1].textContent, 'requested by <b>Tomáš</b>', 'names are text, not HTML');
assert.equal(get('searchInput').value, 'Jamiroquai');
assert.equal(storage.get('jukebox_language'), 'en');

let finish;
context.api = async (path, options) => options?.method === 'POST'
  ? new Promise(resolve => {finish = resolve;}) : [];
context.addButton = addButton;
const adding = vm.runInContext('addSong(songs[0], addButton)', context);
assert.equal(addButton.disabled, true);
assert.equal(addButton.textContent, 'Adding…');
i18n.setLanguage('cs');
assert.equal(addButton.textContent, 'Přidávám…');
assert.equal(addButton.disabled, true, 'switching language preserves an in-flight action');
assert.equal(get('results').children[0], resultCard, 'language changes do not recreate search results');
i18n.setLanguage('en');
finish({});
await adding;
assert.equal(addButton.textContent, '✓ In the queue');
assert.equal(get('searchStatus').textContent, 'Song added to the queue.');
i18n.setLanguage('cs');
assert.equal(addButton.textContent, '✓ Ve frontě');

vm.runInContext('setStatus("Tahle skladba už ve frontě je (#42).", "error")', context);
i18n.setLanguage('en');
assert.equal(get('searchStatus').textContent, 'This song is already in the queue (#42).');
vm.runInContext('setStatus("Máš už 3 skladby ve frontě. Nech prostor i ostatním.", "error")', context);
assert.match(get('searchStatus').textContent, /^You already have 3 songs/);
vm.runInContext('setStatus("Failed to fetch", "error")', context);
assert.equal(get('searchStatus').textContent, 'Connection lost. Please try again.');

const note = element();
i18n.bind(note, 'Navazuje {playlist}. Automatické pokračování je vypnuté.', {playlist: 'Celosvětové hity'});
assert.match(note.textContent, /Worldwide hits/);
i18n.setLanguage('cs');
assert.match(note.textContent, /Celosvětové hity/, 'preset labels return to Czech');

let prompt;
context.window.confirm = message => {prompt = message; return false;};
i18n.setLanguage('en');
await context.cancelSong(12, 'Česká píseň', cancel);
assert.equal(prompt, 'Remove “Česká píseň” from the queue?');

assert.equal(guestContext({language: 'en-GB'}).i18n.language, 'en');
assert.equal(guestContext({language: 'en-GB', saved: 'cs'}).i18n.language, 'cs');
const linked = guestContext({saved: 'cs', search: '?code=venue-code&lang=en'});
assert.equal(linked.i18n.language, 'en');
linked.i18n.setLanguage('cs');
assert.equal(new URL(linked.window.location.href).searchParams.get('code'), 'venue-code');
assert.equal(new URL(linked.window.location.href).searchParams.get('lang'), 'cs');
const restricted = guestContext({blockedStorage: true});
restricted.i18n.setLanguage('en');
assert.equal(restricted.i18n.language, 'en', 'blocked storage does not break language switching');
restricted.i18n.setLanguage('de');
assert.equal(restricted.i18n.language, 'en');

// Every static label marked for translation must have an English entry.
for (const name of ['guest', 'join', 'network']) {
  const html = fs.readFileSync(new URL(`../static/${name}.html`, import.meta.url), 'utf8');
  assert.match(html, /data-language="cs"/);
  assert.match(html, /data-language="en"/);
  assert.ok(html.indexOf('/static/i18n.js') < html.indexOf('/static/install.js') || name === 'network');
  for (const match of html.matchAll(/data-i18n>([^<]+)</g)) {
    const original = match[1].replaceAll('&amp;', '&');
    assert.notEqual(i18n.t(original), original, `${name}: English translation for ${original}`);
  }
}
console.log('Guest translations: language persistence, live actions, search results, errors, confirmations, safe names and all guest pages verified.');
