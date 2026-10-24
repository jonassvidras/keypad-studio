import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');

test('every static UI element reference has a matching HTML ID', () => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
  const references = new Set([...app.matchAll(/element\('([^']+)'\)/g)].map(match => match[1]));
  assert.deepEqual([...references].filter(id => !ids.has(id)), []);
});

test('Studio runtime imports stay within the standalone web directory', () => {
  for (const name of ['app.js', 'open-adapter.mjs', 'protocol.mjs', 'keypadopen-protocol.mjs']) {
    const source = readFileSync(new URL(name, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"]\.\.\//);
  }
});
