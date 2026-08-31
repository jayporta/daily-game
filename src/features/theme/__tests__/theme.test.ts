import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  nextTheme,
  readTheme,
  rememberTheme,
  resolveInitialTheme,
} from '../theme.ts';
import type { WebStorage } from '../../../lib/browser-storage.ts';

/** A working storage, plus the raw record so a test can inspect what landed. */
function fakeStorage(seed: Record<string, string> = {}): WebStorage & {
  readonly written: Record<string, string>;
} {
  const written: Record<string, string> = { ...seed };
  return {
    written,
    getItem: (key) => written[key] ?? null,
    setItem: (key, value) => {
      written[key] = value;
    },
  };
}

/** Safari's private mode: the API is present and every call throws. */
const throwingStorage: WebStorage = {
  getItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
};

test('readTheme returns a remembered choice', () => {
  assert.equal(readTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'light' })), 'light');
});

test('readTheme returns null when nothing was remembered', () => {
  assert.equal(readTheme(fakeStorage()), null);
});

// The key is public and hand-editable, so a junk value must not become the
// data-theme attribute.
test('readTheme rejects a value outside the vocabulary', () => {
  assert.equal(readTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'solarized' })), null);
});

test('readTheme survives a storage that throws', () => {
  assert.equal(readTheme(throwingStorage), null);
});

test('readTheme survives having no storage at all', () => {
  assert.equal(readTheme(null), null);
});

test('rememberTheme stores the choice under the shared key', () => {
  const storage = fakeStorage();

  rememberTheme(storage, 'dark');

  assert.equal(storage.written[THEME_STORAGE_KEY], 'dark');
});

test('rememberTheme survives a storage that throws', () => {
  assert.doesNotThrow(() => rememberTheme(throwingStorage, 'dark'));
});

test('a remembered choice wins over the operating system', () => {
  const storage = fakeStorage({ [THEME_STORAGE_KEY]: 'light' });

  assert.equal(resolveInitialTheme(storage, true), 'light');
});

test('a first visit follows the operating system', () => {
  assert.equal(resolveInitialTheme(fakeStorage(), true), 'dark');
  assert.equal(resolveInitialTheme(fakeStorage(), false), 'light');
});

test('nextTheme flips between the two themes', () => {
  assert.equal(nextTheme('dark'), 'light');
  assert.equal(nextTheme('light'), 'dark');
});

// index.html sets the attribute before React mounts so the first paint is
// not the wrong theme. That bootstrap cannot import this module, so it
// hardcodes both names — this fails if either is renamed here alone.
test('the pre-paint bootstrap in index.html uses the same key and attribute', () => {
  const html = readFileSync(join(import.meta.dirname, '../../../../index.html'), 'utf8');

  assert.ok(html.includes(THEME_STORAGE_KEY), `index.html does not mention ${THEME_STORAGE_KEY}`);
  assert.ok(html.includes(THEME_ATTRIBUTE), `index.html does not mention ${THEME_ATTRIBUTE}`);
});
