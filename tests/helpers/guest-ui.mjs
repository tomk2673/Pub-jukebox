import fs from 'node:fs';
import vm from 'node:vm';

// Small DOM fixture, shared by the guest interaction tests. No production requests.
export function guestContext({language = 'cs-CZ', saved = null, search = '', blockedStorage = false} = {}) {
  const all = [];
  function element() {
    const classes = new Set();
    const attributes = new Map();
    const listeners = new Map();
    const node = {textContent: '', disabled: false, children: [], dataset: {}, value: '',
      classList: {toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name)},
      style: {setProperty() {}, removeProperty() {}},
      replaceChildren(...nodes) { this.children = nodes; }, append(...nodes) { this.children.push(...nodes); },
      setAttribute(name, value) { attributes.set(name, String(value)); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      removeAttribute(name) { attributes.delete(name); },
      addEventListener(name, callback) { listeners.set(name, callback); },
      click() { listeners.get('click')?.(); },
    };
    all.push(node);
    return node;
  }
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const storage = new Map(saved ? [['jukebox_language', saved]] : []);
  const location = {search, href: `https://jukebox.test/guest${search}`};
  const document = {getElementById: get, createElement: element, documentElement: {lang: ''},
    querySelectorAll(selector) {
      const attribute = /^\[([^\]]+)\]$/.exec(selector)?.[1];
      return all.filter(node => node.getAttribute(attribute) !== null);
    },
    querySelector() { return {value: 'music'}; },
  };
  const window = {location, history: {replaceState(_state, _title, url) {
    location.href = String(url); location.search = new URL(url).search;
  }}, confirm: () => true};
  const context = vm.createContext({document, window, navigator: {language},
    localStorage: {getItem(key) { if (blockedStorage) throw new Error('blocked'); return storage.get(key) || null; },
      setItem(key, value) { if (blockedStorage) throw new Error('blocked'); storage.set(key, value); }},
    URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
  });
  const i18nSource = fs.readFileSync(new URL('../../static/i18n.js', import.meta.url), 'utf8');
  const source = fs.readFileSync(new URL('../../static/guest.js', import.meta.url), 'utf8').replace(/\nboot\(\);\s*$/, '');
  vm.runInContext(i18nSource, context);
  vm.runInContext(source, context);
  return {context, get, element, all, storage, document, window, i18n: window.JukeboxI18n};
}
