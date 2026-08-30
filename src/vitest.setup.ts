// Loaded before every Vitest file. Named `vitest.setup.ts`, not
// `test-setup.ts`, because node --test's default glob claims `test-*`
// filenames and would try to run this as a suite.
//
// Adds jest-dom's DOM matchers, restores jsdom's storage (see below), and
// unmounts anything a test rendered so no test can observe another's DOM.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Node exposes `localStorage`/`sessionStorage` globals that are inert empty
 * objects unless the process was started with a valid `--localstorage-file`.
 * Vitest's jsdom environment installs a window global only when the name is
 * absent from `globalThis` or appears on its own hardcoded allowlist, and
 * the storages are neither — so Node's stubs shadow jsdom's working Storage
 * and every `getItem`/`setItem` throws "is not a function".
 *
 * jsdom's real window is still reachable: the environment hangs the JSDOM
 * instance off `globalThis.jsdom`. Take the storages from there.
 */
function restoreJsdomStorage(): void {
  const { window } = (globalThis as { jsdom?: { window: Window } }).jsdom ?? {};
  if (!window) return;

  for (const name of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, name, {
      value: window[name],
      configurable: true,
      writable: true,
    });
  }
}

restoreJsdomStorage();

afterEach(() => {
  cleanup();
});
