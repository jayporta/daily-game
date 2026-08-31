// Loaded before every Vitest file. Named `vitest.setup.ts`, not
// `test-setup.ts`, because node --test's default glob claims `test-*`
// filenames and would try to run this as a suite.
//
// Adds jest-dom's DOM matchers, restores jsdom's storage and `<dialog>`
// (see below), and unmounts anything a test rendered so no test can observe
// another's DOM.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * jsdom's own window, which the environment hangs off `globalThis`.
 *
 * The single reach for it, so the two repairs below do not each describe the
 * shape of a global that neither of them owns.
 */
function jsdomWindow(): JsdomWindow | undefined {
  return (globalThis as { jsdom?: { window: JsdomWindow } }).jsdom?.window;
}

/** jsdom's window, plus the constructor it exposes that `Window` omits. */
interface JsdomWindow extends Window {
  readonly HTMLDialogElement?: typeof HTMLDialogElement;
}

/**
 * Node exposes `localStorage`/`sessionStorage` globals that are inert empty
 * objects unless the process was started with a valid `--localstorage-file`.
 * Vitest's jsdom environment installs a window global only when the name is
 * absent from `globalThis` or appears on its own hardcoded allowlist, and
 * the storages are neither — so Node's stubs shadow jsdom's working Storage
 * and every `getItem`/`setItem` throws "is not a function".
 *
 * jsdom's real window is still reachable, so take the storages from there.
 */
function restoreJsdomStorage(): void {
  const window = jsdomWindow();
  if (!window) return;

  for (const name of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, name, {
      value: window[name],
      configurable: true,
      writable: true,
    });
  }
}

/**
 * jsdom implements `<dialog>` as an element but not its modal methods, so
 * `showModal` is undefined and calling it throws inside the effect that
 * opens the overlay.
 *
 * Filled in here rather than guarded in the component: every browser this
 * site supports has had `showModal` since 2022, and a component branch for a
 * case only the test runner produces would be untestable by definition. The
 * stand-ins move the same `open` attribute the real methods do, which is
 * what the dialog's visibility and its `dialog` role both follow.
 */
function restoreJsdomDialog(): void {
  const prototype = jsdomWindow()?.HTMLDialogElement?.prototype;
  if (!prototype) return;

  prototype.showModal ??= function showModal(this: HTMLDialogElement): void {
    this.setAttribute('open', '');
  };
  prototype.close ??= function close(this: HTMLDialogElement): void {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

restoreJsdomStorage();
restoreJsdomDialog();

afterEach(() => {
  cleanup();
});
