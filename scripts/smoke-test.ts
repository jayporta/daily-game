// Loads a generated bundle in headless Chromium and checks it actually
// works: no uncaught JS errors, no outbound network requests (the bundle
// must be fully self-contained), and — softly — that something was drawn.
//
// Network blocking is an assertion, not just a safety net: a bundle that
// *tries* to reach the network has broken the self-contained rule and is
// rejected even though the request never left the machine.
import { type Browser, chromium } from 'playwright';
import { errorMessage } from '#lib/errors.ts';

export interface SmokeTestResult {
  pass: boolean;
  reasons: string[];
  warnings: string[];
  consoleErrors: string[];
  pageErrors: string[];
  networkAttempts: string[];
  canvasDrawn: boolean;
}

export interface SmokeTestOptions {
  /** How long to let the page run before judging it. */
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
  const reasons: string[] = [];
  const warnings: string[] = [];

  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(settleMs);

    canvasDrawn = await page.evaluate(() => {
      const canvases = Array.from(document.querySelectorAll('canvas'));
      if (canvases.length === 0) return false;
      return canvases.some((canvas) => {
        const ctx = canvas.getContext('2d');
        if (!ctx || canvas.width === 0 || canvas.height === 0) return false;
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        // Any non-transparent pixel means something was painted.
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] !== 0) return true;
        }
        return false;
      });
    });
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
  if (!canvasDrawn) {
    // Soft signal only: some games legitimately draw nothing until input.
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
  };
}

export interface SmokeTester {
  test(html: string, options?: SmokeTestOptions): Promise<SmokeTestResult>;
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
