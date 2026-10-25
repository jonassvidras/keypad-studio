import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('./appearance.js', import.meta.url), 'utf8');

function harness(saved = null, systemDark = false) {
  const listeners = {};
  const buttons = Object.fromEntries(['light', 'dark', 'system'].map(mode => [mode, {
    dataset: {appearance: mode},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { this[name] = callback; },
  }]));
  const metas = ['light', 'dark'].map(mode => ({
    media: `(prefers-color-scheme: ${mode})`,
    content: mode === 'light' ? '#ffffff' : '#161617',
    remove() { this.removed = true; },
    removeAttribute(name) { if (name === 'media') this.media = ''; },
  }));
  const store = new Map(saved ? [['keypad-studio-appearance', saved]] : []);
  const media = {
    matches: systemDark,
    addEventListener(name, callback) { listeners.media = callback; },
  };
  const root = {dataset: {}};
  const document = {
    documentElement: root,
    querySelectorAll(selector) { return selector.startsWith('meta') ? metas : Object.values(buttons); },
    addEventListener(name, callback) { listeners[name] = callback; },
  };
  runInNewContext(source, {
    document,
    window: {matchMedia: () => media, addEventListener(name, callback) { listeners[name] = callback; }},
    localStorage: {getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value)},
  });
  return {root, buttons, metas, store, media, listeners};
}

test('saved appearance applies before DOMContentLoaded and button setup', () => {
  const state = harness('dark');
  assert.equal(state.root.dataset.appearance, 'dark');
  assert.equal(state.root.dataset.colorScheme, 'dark');
  assert.equal(state.metas[0].content, '#161617');
  state.listeners.DOMContentLoaded();
  assert.equal(state.buttons.dark.attributes['aria-pressed'], 'true');
  assert.equal(state.buttons.light.attributes['aria-pressed'], 'false');
});

test('System follows changes, while explicit choice remains fixed', () => {
  const state = harness(null, false);
  state.listeners.DOMContentLoaded();
  assert.equal(state.root.dataset.colorScheme, 'light');
  state.media.matches = true;
  state.listeners.media();
  assert.equal(state.root.dataset.colorScheme, 'dark');
  state.buttons.light.click();
  assert.equal(state.store.get('keypad-studio-appearance'), 'light');
  state.listeners.media();
  assert.equal(state.root.dataset.colorScheme, 'light');
  state.listeners.storage({key: 'keypad-studio-appearance', newValue: 'system'});
  assert.equal(state.root.dataset.colorScheme, 'dark');
});
