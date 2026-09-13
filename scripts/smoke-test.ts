// Loads a generated bundle in headless Chromium and checks it actually
// works: no uncaught JS errors, no outbound network requests (the bundle
// must be fully self-contained), and that it renders something visible.
//
// Network blocking is an assertion, not just a safety net: a bundle that
// *tries* to reach the network has broken the self-contained rule and is
// rejected even though the request never left the machine.
import { type Browser, chromium } from 'playwright';
import { errorMessage } from '#lib/errors.ts';

/** The verdict on one bundle, plus everything observed while reaching it. */
export interface SmokeTestResult {
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
   * Whether any `<canvas>` held a non-transparent pixel when the settle
   * window closed. False for a game built entirely from DOM elements, so
   * this only ever raises a warning.
   */
  readonly canvasDrawn: boolean;
  /**
   * Whether the bundle put anything on screen at all — canvas pixels, text,
   * an image, or an element it painted a background onto.
   *
   * Distinct from {@link canvasDrawn}, which is false for any game built
   * without a canvas. A model that returns the output contract's own
   * skeleton parses, moderates and runs cleanly; this is what catches it.
   */
  readonly renderedSomething: boolean;
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
}

/** Only real remote schemes count as network use; data:/blob: are self-contained. */
function isRemoteRequest(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

async function runSmokeTest(
  browser: Browser,
  html: string,
  { settleMs = 1500 }: SmokeTestOptions,
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

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (!isRemoteRequest(url)) {
      await route.continue();
      return;
    }
    networkAttempts.push(url);
    await route.abort();
  });

  let canvasDrawn = false;
  let renderedSomething = false;
  const reasons: string[] = [];
  const warnings: string[] = [];

  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(settleMs);

    ({ canvasDrawn, renderedSomething } = await page.evaluate(() => {
      const drewToCanvas = Array.from(document.querySelectorAll('canvas')).some((canvas) => {
        const ctx = canvas.getContext('2d');
        if (!ctx || canvas.width === 0 || canvas.height === 0) return false;

        // Read in strips: one full-canvas getImageData allocates four bytes
        // per pixel at once, which is tens of megabytes at full-page sizes.
        const stripHeight = 64;
        for (let top = 0; top < canvas.height; top += stripHeight) {
          const height = Math.min(stripHeight, canvas.height - top);
          const { data } = ctx.getImageData(0, top, canvas.width, height);
          // Any non-transparent pixel means something was painted.
          for (let i = 3; i < data.length; i += 4) {
            if (data[i] !== 0) return true;
          }
        }
        return false;
      });

      // Something a viewer would actually see: a background that is not
      // transparent, on an element that is not hidden.
      const isPainted = (element: Element): boolean => {
        const { backgroundColor, backgroundImage, visibility, opacity } = getComputedStyle(element);
        if (visibility === 'hidden' || opacity === '0') return false;
        return (
          backgroundImage !== 'none' ||
          (backgroundColor !== 'transparent' && backgroundColor !== 'rgba(0, 0, 0, 0)')
        );
      };

      // `html` and `body` are where DISPLAY_CONTRACT tells a game to paint its
      // background, and neither is matched by a descendant query.
      const ground = [document.documentElement, document.body];
      const hasPaintedGround = ground.some((element) => element !== null && isPainted(element));

      // A DOM-based game shows text or media instead of canvas pixels.
      const hasText = (document.body?.innerText ?? '').trim().length > 0;
      const hasMedia = document.querySelector('img, svg, video') !== null;
      const hasPaintedElement = Array.from(document.body?.querySelectorAll('*') ?? []).some(
        (element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && isPainted(element);
        },
      );

      return {
        canvasDrawn: drewToCanvas,
        renderedSomething:
          drewToCanvas || hasText || hasMedia || hasPaintedGround || hasPaintedElement,
      };
    }));
  } catch (error) {
    reasons.push(`page failed to load: ${errorMessage(error)}`);
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
  if (!renderedSomething) {
    reasons.push(
      'the page rendered nothing visible — no canvas pixels, no text and no painted elements',
    );
  } else if (!canvasDrawn) {
    // Soft signal only: a game built from DOM elements draws to no canvas,
    // and some canvas games paint nothing until the first input.
    warnings.push('nothing was drawn to a canvas during the settle window');
  }

  return {
    pass: reasons.length === 0,
    reasons,
    warnings,
    consoleErrors,
    pageErrors,
    networkAttempts,
    canvasDrawn,
    renderedSomething,
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
  const browser = await chromium.launch();
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
