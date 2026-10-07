// Loads a generated bundle in headless Chromium and checks it actually
// works: no uncaught JS errors, no outbound network requests (the bundle
// must be fully self-contained), that it renders something visible, and that
// the visible page is alive — it animates, or answers clicks and key presses.
//
// Network blocking is an assertion, not just a safety net: a bundle that
// *tries* to reach the network has broken the self-contained rule and is
// rejected even though the request never left the machine.
import { type Browser, chromium, type Page } from 'playwright';
import { type ProbeVerdict, probeActivity } from '#actions_pipeline/pageActivity.ts';
import { inspectRender, type RenderInspection } from '#actions_pipeline/pageRender.ts';
import { errorMessage } from '#lib/errors.ts';

/**
 * How far a run got, which decides what the rest of the result describes.
 *
 * - `not-loaded`: setting the document threw, so the browser never ran it.
 *   Nothing else was watched, and the load failure is the reason.
 * - `unobserved`: the page loaded, then a browser call threw while it
 *   settled or was examined — it crashed, or closed itself — so the render
 *   fields and `activity` say nothing about it.
 * - `observed`: every check answered, and the rest of the result is what
 *   they saw. A page that hung before it could be read is `unresponsive`
 *   with its render fields false.
 */
export type SmokeTestReach = 'not-loaded' | 'unobserved' | 'observed';

/** The verdict on one bundle, plus everything observed while reaching it. */
export interface SmokeTestResult extends RenderInspection {
  /**
   * Whether the bundle may be published. True only when {@link reasons} is
   * empty; a page that never loaded fails, so an unreachable bundle is a
   * rejection rather than an unknown.
   */
  readonly pass: boolean;
  /**
   * Every disqualifying problem, phrased for the history entry and the next
   * attempt's feedback. Empty means {@link pass} is true.
   */
  readonly reasons: string[];
  /** Problems worth recording that do not disqualify the bundle. */
  readonly warnings: string[];
  /** Text of every `console.error` the page emitted. */
  readonly consoleErrors: string[];
  /** Messages of every uncaught exception the page threw. */
  readonly pageErrors: string[];
  /**
   * URLs of every `http:`/`https:` request the page attempted. Each was
   * blocked before it left the machine, and any entry disqualifies the
   * bundle — a game must be self-contained. `data:` and `blob:` URLs are
   * not counted.
   */
  readonly networkAttempts: string[];
  /**
   * How far the run got. Only an `observed` run's render fields and
   * {@link activity} describe the page; see {@link SmokeTestReach}.
   */
  readonly reach: SmokeTestReach;
  /**
   * What probing the page for signs of life found. `unresponsive` without a
   * probe when the page hung before it could even be read, with the render
   * fields false. `null` when it was never probed: the run did not reach
   * it, or the page rendered nothing, and the reason already says so.
   */
  readonly activity: ProbeVerdict | null;
}

/** Knobs for one bundle's run. */
export interface SmokeTestOptions {
  /**
   * How long to let the page run before judging it, in milliseconds. Long
   * enough for a game's first frame and any start-up animation.
   *
   * @defaultValue `1500`
   */
  settleMs?: number;
  /**
   * How long reading what the page rendered may take, and then how long
   * probing it for activity may take, in milliseconds. A page that has not
   * answered either by then is rejected as unresponsive.
   *
   * Must stay well above a full probe of a page that does nothing, measured
   * at about 2.6s: set it below that and every inert page is reported
   * unresponsive instead, which earns the wrong corrective directive.
   *
   * @defaultValue `20000`
   */
  probeTimeoutMs?: number;
}

/**
 * Reads the page under a deadline, since a script that never yields blocks
 * the read. The read may still be pending when this returns `unresponsive`;
 * closing the page ends it.
 */
async function inspectUnderDeadline(
  page: Page,
  timeoutMs: number,
): Promise<RenderInspection | 'unresponsive'> {
  let cancel = (): void => undefined;
  const deadline = new Promise<'unresponsive'>((resolve) => {
    const timer = setTimeout(() => resolve('unresponsive'), timeoutMs);
    cancel = () => clearTimeout(timer);
  });
  const read = inspectRender(page);
  // A read that loses the race rejects once its page closes; nobody awaits it.
  read.catch(() => undefined);
  try {
    return await Promise.race([read, deadline]);
  } finally {
    cancel();
  }
}

/** Only real remote schemes count as network use; data:/blob: are self-contained. */
function isRemoteRequest(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

async function runSmokeTest(
  browser: Browser,
  html: string,
  { settleMs = 1500, probeTimeoutMs = 20_000 }: SmokeTestOptions,
): Promise<SmokeTestResult> {
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const networkAttempts: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  // On the context so a popup a clicked button opens is blocked and recorded too.
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (!isRemoteRequest(url)) {
      await route.continue();
      return;
    }
    networkAttempts.push(url);
    await route.abort();
  });

  let reach: SmokeTestReach = 'not-loaded';
  let canvasDrawn = false;
  let renderedSomething = false;
  let probe: ProbeVerdict | null = null;
  const reasons: string[] = [];
  const warnings: string[] = [];

  try {
    try {
      await page.setContent(html, { waitUntil: 'load' });
      reach = 'unobserved';
    } catch (error) {
      reasons.push(`page failed to load: ${errorMessage(error)}`);
    }

    if (reach === 'unobserved') {
      try {
        await page.waitForTimeout(settleMs);
        const inspection = await inspectUnderDeadline(page, probeTimeoutMs);
        if (inspection === 'unresponsive') {
          probe = inspection;
        } else {
          ({ canvasDrawn, renderedSomething } = inspection);
          if (renderedSomething) probe = await probeActivity(page, probeTimeoutMs);
        }
        reach = 'observed';
      } catch (error) {
        reasons.push(`page loaded but could not be observed: ${errorMessage(error)}`);
      }
    }
  } finally {
    await context.close();
  }

  if (pageErrors.length > 0) {
    reasons.push(`uncaught JS error: ${pageErrors.join(' | ')}`);
  }
  if (consoleErrors.length > 0) {
    reasons.push(`console error: ${consoleErrors.join(' | ')}`);
  }
  if (networkAttempts.length > 0) {
    reasons.push(`bundle is not self-contained — it requested: ${networkAttempts.join(', ')}`);
  }
  // None of these describe a page the run could not watch; its reason is
  // already recorded.
  if (reach === 'observed') {
    // A page that hung while being read never showed what it rendered.
    if (probe === 'unresponsive') {
      reasons.push('the page stopped responding');
    } else if (!renderedSomething) {
      reasons.push(
        'the page rendered nothing visible — no canvas pixels, no text and no painted elements',
      );
    } else if (probe === 'inert') {
      reasons.push('the page never changed — no animation and no response to clicks or keys');
    } else if (!canvasDrawn) {
      // Soft signal only: a game built from DOM elements draws to no canvas,
      // and some canvas games paint nothing until the first input.
      warnings.push('nothing was drawn to a canvas during the settle window');
    }
  }

  return {
    pass: reasons.length === 0,
    reasons,
    warnings,
    consoleErrors,
    pageErrors,
    networkAttempts,
    reach,
    canvasDrawn,
    renderedSomething,
    activity: probe,
  };
}

/**
 * A browser held open across several bundles. Obtained from
 * {@link createSmokeTester}, which owns the browser this borrows.
 */
export interface SmokeTester {
  /**
   * Runs one bundle in a fresh browser context.
   *
   * @param html - The complete, self-contained bundle document.
   * @param options - Per-run overrides; see {@link SmokeTestOptions}.
   * @returns The verdict. Never rejects: a page that fails to load comes
   * back as a failing result.
   */
  test(html: string, options?: SmokeTestOptions): Promise<SmokeTestResult>;
  /** Shuts the browser down. Every caller needs a `finally` that calls this. */
  close(): Promise<void>;
}

/**
 * Launches one browser and reuses it across many bundles — worth it when
 * checking several (the retry loop, and the test suite).
 */
export async function createSmokeTester(): Promise<SmokeTester> {
  // Keyboard scrolling animates; that motion would read as the page changing.
  const browser = await chromium.launch({ args: ['--disable-smooth-scrolling'] });
  return {
    test: (html, options = {}) => runSmokeTest(browser, html, options),
    close: () => browser.close(),
  };
}

/** One-shot convenience: launches a browser, checks one bundle, tears down. */
export async function smokeTest(
  html: string,
  options: SmokeTestOptions = {},
): Promise<SmokeTestResult> {
  const tester = await createSmokeTester();
  try {
    return await tester.test(html, options);
  } finally {
    await tester.close();
  }
}
