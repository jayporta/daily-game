// Tells a live game from a static shell: a page whose script does nothing can
// still paint a HUD and a background, so rendering alone proves little.
import type { Frame, Page } from 'playwright';

/** How long the page is left alone between the two idle screenshots. */
const IDLE_WAIT_MS = 500;
/** Per-click budget; a button that is covered or gone is skipped, not waited on. */
const CLICK_TIMEOUT_MS = 500;
/** Pause for the page to react to the clicks, and again after the last key. */
const REACTION_WAIT_MS = 200;
const SETTLE_AFTER_INPUT_MS = 300;
/** Hides the focus ring a click leaves on the page's buttons. */
const HIDE_FOCUS_RING = '*:focus, *:focus-visible { outline: none !important; }';
/** How long each key is held, so a game polling key state on a frame sees it. */
const KEY_HOLD_MS = 60;

/** The keys a small browser game is most likely to listen for. */
const PROBE_KEYS = [
  'Space',
  'Enter',
  'ArrowRight',
  'ArrowLeft',
  'ArrowUp',
  'ArrowDown',
  'w',
  'a',
  's',
  'd',
  'r',
  '1',
] as const;

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
  await page.evaluate(
    ({ x, y }) => window.scrollTo({ left: x, top: y, behavior: 'instant' }),
    scroll,
  );
  return page.screenshot();
}

/**
 * Clicks every visible button once, ignoring any that cannot be clicked, and
 * stops at the first click after which `changed` reports a difference.
 */
async function clickButtonsUntilChanged(
  page: Page,
  changed: () => Promise<boolean>,
): Promise<boolean> {
  for (const button of await page.locator('button:visible').all()) {
    await button.click({ timeout: CLICK_TIMEOUT_MS }).catch(() => undefined);
    if (await changed()) return true;
  }
  return false;
}

/** Clicks the middle of the viewport, where a canvas game usually sits. */
async function clickViewportCentre(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) return;
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
}

/**
 * Takes focus off a text field, so the probe's keys are not typed into it. A
 * focused canvas or any other element keeps focus and keeps receiving keys.
 */
async function blurEditable(page: Page): Promise<void> {
  await page.evaluate(() => {
    const focused = document.activeElement;
    const isEditable =
      focused instanceof HTMLInputElement ||
      focused instanceof HTMLTextAreaElement ||
      (focused instanceof HTMLElement && focused.isContentEditable);
    if (isEditable) focused.blur();
  });
}

/** Holds one key briefly, long enough for a game polling key state to see it. */
async function pressKey(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(KEY_HOLD_MS);
  await page.keyboard.up(key);
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
 */
async function pageResponds(page: Page): Promise<boolean> {
  // Focus rings belong to the probe's clicks, not to the page; hide them.
  await page.addStyleTag({ content: HIDE_FOCUS_RING });
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  const before = await snapshot(page, scroll);
  const changed = async (): Promise<boolean> => !before.equals(await snapshot(page, scroll));

  await page.waitForTimeout(IDLE_WAIT_MS);
  if (await changed()) return true;

  if (await clickButtonsUntilChanged(page, changed)) return true;
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

/** What {@link probeActivity} concluded. */
export type ProbeVerdict = 'active' | 'inert' | 'unresponsive';

/**
 * Probes a page for activity under a deadline, since a handler that never
 * returns blocks every browser call the probe makes.
 *
 * A main-frame navigation ends the probe as `inert`: a no-op form submit
 * reloads the page, and the new screenshot is not the game responding. The
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
  const interrupted = new Promise<ProbeVerdict>((resolve) => {
    const timer = setTimeout(() => resolve('unresponsive'), timeoutMs);
    const onNavigated = (frame: Frame): void => {
      if (frame === page.mainFrame()) resolve('inert');
    };
    page.on('framenavigated', onNavigated);
    stopWatching = () => {
      clearTimeout(timer);
      page.off('framenavigated', onNavigated);
    };
  });

  const probe = pageResponds(page).then((responds): ProbeVerdict =>
    responds ? 'active' : 'inert',
  );
  // A probe that loses the race rejects once its page closes; nobody awaits it.
  probe.catch(() => undefined);

  try {
    return await Promise.race([probe, interrupted]);
  } finally {
    stopWatching();
  }
}
