// Tells a live game from a static shell: a page whose script does nothing can
// still paint a HUD and a background, so rendering alone proves little.
// The page.evaluate callbacks run in the browser, where Node's coverage cannot
// see them however often the smoke tests exercise them, so each is bracketed
// by node:coverage pragmas.
import type { Frame, Page } from 'playwright';
import {
  blurEditable,
  clickButtonsUntilChanged,
  clickViewportCentre,
  PROBE_KEYS,
  pressKey,
} from '#actions_pipeline/pageInputs.ts';

/** How long the page is left alone between the two idle screenshots. */
const IDLE_WAIT_MS = 500;
/** Pause for the page to react to the clicks, and again after the last key. */
const REACTION_WAIT_MS = 200;
const SETTLE_AFTER_INPUT_MS = 300;
/** Hides the focus ring a click leaves on the page's buttons. */
const HIDE_FOCUS_RING = '*:focus, *:focus-visible { outline: none !important; }';
/** The share of the probe's budget the button clicks may spend before the keys run. */
const CLICK_PHASE_SHARE = 0.25;
/** Own property set on `window` to tell a document reload from a same-document navigation. */
const DOCUMENT_MARKER = '__dailyGameActivityProbe';

/** Where the page was scrolled to when it was first looked at. */
interface ScrollPosition {
  readonly x: number;
  readonly y: number;
}

/**
 * Screenshots the page with the pointer parked in the top-left corner and the
 * scroll position restored, so the probe's own pointer and scrolling leave no
 * mark on the image.
 */
async function snapshot(page: Page, scroll: ScrollPosition): Promise<Buffer> {
  await page.mouse.move(0, 0);
  /* node:coverage disable */
  await page.evaluate(
    ({ x, y }) => window.scrollTo({ left: x, top: y, behavior: 'instant' }),
    scroll,
  );
  /* node:coverage enable */
  return page.screenshot();
}

/**
 * Whether the page does anything: it changes on its own, or it changes when
 * its buttons are clicked, its centre is clicked or a common key is pressed.
 *
 * Compares screenshots, so it sees only what a viewer would. A page that is
 * still on arrival, then still after every input, is inert. Each input is
 * compared on its own, because opposite inputs can undo each other.
 *
 * Known limit: a page whose only motion is a ticking clock or a CSS
 * animation reads as active, because the idle screenshots already differ.
 *
 * @param page A page that has loaded and settled.
 * @param clickBudgetMs How long the button clicks may take, so a grid of
 *   unclickable buttons leaves time for the centre click and the keys.
 */
async function pageResponds(page: Page, clickBudgetMs: number): Promise<boolean> {
  // Focus rings belong to the probe's clicks, not to the page; hide them.
  await page.addStyleTag({ content: HIDE_FOCUS_RING });
  /* node:coverage disable */
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  /* node:coverage enable */
  const before = await snapshot(page, scroll);
  const changed = async (): Promise<boolean> => !before.equals(await snapshot(page, scroll));

  await page.waitForTimeout(IDLE_WAIT_MS);
  if (await changed()) return true;

  if (await clickButtonsUntilChanged(page, changed, clickBudgetMs)) return true;
  await page.waitForTimeout(REACTION_WAIT_MS);
  if (await changed()) return true;

  await clickViewportCentre(page);
  await blurEditable(page);
  if (await changed()) return true;

  for (const key of PROBE_KEYS) {
    await pressKey(page, key);
    if (await changed()) return true;
  }

  await page.waitForTimeout(SETTLE_AFTER_INPUT_MS);
  return changed();
}

/**
 * What probing a page for signs of life found.
 *
 * - `active`: the page changed on its own, or in response to clicks and key
 *   presses.
 * - `inert`: nothing changed, or the page only reloaded. A static shell whose
 *   script does nothing renders fine and is still not a game.
 * - `unresponsive`: the probe hit its deadline, because a handler or loop
 *   never returned.
 */
export type ProbeVerdict = 'active' | 'inert' | 'unresponsive';

/** Marks the current document, so a later load of a new one can be told apart. */
async function markDocument(page: Page): Promise<void> {
  /* node:coverage disable */
  await page.evaluate((key) => {
    Object.assign(window, { [key]: true });
  }, DOCUMENT_MARKER);
  /* node:coverage enable */
}

/** Whether the document carrying the mark is still the one on screen. */
function documentIsMarked(page: Page): Promise<boolean> {
  /* node:coverage disable */
  return page.evaluate((key) => Reflect.has(window, key), DOCUMENT_MARKER);
  /* node:coverage enable */
}

/**
 * Settles with whatever `work` settles with, or with `fallback` once
 * `timeoutMs` passes first. Work that loses the race may still be pending;
 * whoever owns it ends it, and its later rejection goes nowhere.
 */
export async function withinDeadline<T, F>(
  work: Promise<T>,
  timeoutMs: number,
  fallback: F,
): Promise<T | F> {
  let cancel = (): void => undefined;
  const deadline = new Promise<F>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    cancel = () => clearTimeout(timer);
  });
  work.catch(() => undefined);
  try {
    return await Promise.race([work, deadline]);
  } finally {
    cancel();
  }
}

/**
 * Probes a page for activity under a deadline, since a handler that never
 * returns blocks every browser call the probe makes.
 *
 * A main-frame navigation that loads a new document ends the probe as
 * `inert`: a no-op form submit reloads the page, and the new screenshot is
 * not the game responding. A same-document navigation, such as setting
 * `location.hash`, does not. A check that cannot tell counts as a reload. The
 * probe may still be running when this returns; closing the page ends it.
 *
 * @param page A page that has loaded and settled.
 * @param timeoutMs How long the probe may take before the page counts as
 *   `unresponsive`.
 * @returns `active` or `inert` once the probe decides, or `unresponsive` at
 *   the deadline.
 * @throws When a browser call fails, for instance because the page crashed.
 */
export async function probeActivity(page: Page, timeoutMs: number): Promise<ProbeVerdict> {
  let stopWatching = (): void => undefined;
  const reloaded = new Promise<ProbeVerdict>((resolve) => {
    const onNavigated = (frame: Frame): void => {
      if (frame !== page.mainFrame()) return;
      documentIsMarked(page).then(
        (marked) => {
          if (!marked) resolve('inert');
        },
        () => resolve('inert'),
      );
    };
    page.on('framenavigated', onNavigated);
    stopWatching = () => page.off('framenavigated', onNavigated);
  });

  const probe = markDocument(page)
    .then(() => pageResponds(page, timeoutMs * CLICK_PHASE_SHARE))
    .then((responds): ProbeVerdict => (responds ? 'active' : 'inert'));

  try {
    return await withinDeadline(Promise.race([probe, reloaded]), timeoutMs, 'unresponsive');
  } finally {
    stopWatching();
  }
}
