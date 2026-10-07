// Drives a page's inputs the way a viewer would: its buttons, its centre and
// the keys a small game listens for. The page.evaluate callbacks run in the
// browser, where Node's coverage cannot see them however often the smoke tests
// exercise them, so each is bracketed by node:coverage pragmas.
import type { Page } from 'playwright';

/** Per-click budget; a button that is covered or gone is skipped, not waited on. */
const CLICK_TIMEOUT_MS = 500;
/** How long each key is held, so a game polling key state on a frame sees it. */
const KEY_HOLD_MS = 60;
/** The `<input>` types that are buttons: only a script changes one of these on a click. */
const BUTTON_INPUT_TYPES = ['button', 'submit', 'reset', 'image'] as const;
/** Every button on the page that a viewer could click. */
const CLICKABLE_BUTTONS = ['button', ...BUTTON_INPUT_TYPES.map((type) => `input[type=${type}]`)]
  .map((selector) => `${selector}:visible`)
  .join(', ');
const NON_BUTTON_INPUTS = `input${BUTTON_INPUT_TYPES.map((type) => `:not([type=${type}])`).join('')}`;
/**
 * Native controls the browser itself changes on a click, with no script
 * involved. A label counts: clicking one activates the control it is for.
 */
const NATIVE_CONTROLS = `${NON_BUTTON_INPUTS}, label, select, textarea, summary, details, option`;

/** The keys a small browser game is most likely to listen for. */
export const PROBE_KEYS = [
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

/**
 * Clicks every visible button once, ignoring any that cannot be clicked, and
 * stops at the first click after which `changed` reports a difference.
 *
 * @param budgetMs How long the loop may keep starting new clicks; a click
 *   already under way may finish its own timeout. Returns false once spent.
 */
export async function clickButtonsUntilChanged(
  page: Page,
  changed: () => Promise<boolean>,
  budgetMs: number,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (const button of await page.locator(CLICKABLE_BUTTONS).all()) {
    if (Date.now() >= deadline) return false;
    await button.click({ timeout: CLICK_TIMEOUT_MS }).catch(() => undefined);
    if (await changed()) return true;
  }
  return false;
}

/**
 * Clicks the middle of the viewport, where a canvas game usually sits, unless
 * a native control is there: the browser changes those itself, so the change
 * would not be the game's.
 */
export async function clickViewportCentre(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) return;
  const centre = { x: viewport.width / 2, y: viewport.height / 2 };
  /* node:coverage disable */
  const onNativeControl = await page.evaluate(
    ({ x, y, selector }) => document.elementFromPoint(x, y)?.closest(selector) != null,
    { ...centre, selector: NATIVE_CONTROLS },
  );
  /* node:coverage enable */
  if (onNativeControl) return;
  await page.mouse.click(centre.x, centre.y);
}

/**
 * Takes focus off a text field or dropdown, so the probe's keys are not typed
 * into it or used to change it. A focused canvas or any other element keeps
 * focus and keeps receiving keys.
 */
export async function blurEditable(page: Page): Promise<void> {
  /* node:coverage disable */
  await page.evaluate(() => {
    const focused = document.activeElement;
    const isEditable =
      focused instanceof HTMLInputElement ||
      focused instanceof HTMLTextAreaElement ||
      focused instanceof HTMLSelectElement ||
      (focused instanceof HTMLElement && focused.isContentEditable);
    if (isEditable) focused.blur();
  });
  /* node:coverage enable */
}

/** Holds one key briefly, long enough for a game polling key state to see it. */
export async function pressKey(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(KEY_HOLD_MS);
  await page.keyboard.up(key);
}
