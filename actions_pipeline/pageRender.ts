// What a loaded page put on screen, read from inside the page.
import type { Page } from 'playwright';

/** What {@link inspectRender} found on screen. */
export interface RenderInspection {
  /**
   * Whether any `<canvas>` held a non-transparent pixel. False for a game
   * built entirely from DOM elements.
   */
  readonly canvasDrawn: boolean;
  /**
   * Whether anything is on screen at all — canvas pixels, text, an image, or
   * an element painted with a background. Distinct from {@link canvasDrawn}.
   */
  readonly renderedSomething: boolean;
}

/**
 * Looks at a loaded page the way a viewer would.
 *
 * @param page A page that has loaded and settled.
 */
export async function inspectRender(page: Page): Promise<RenderInspection> {
  // The callback below runs in the browser, so Node's coverage never records
  // it however often the smoke tests exercise it.
  /* node:coverage disable */
  return page.evaluate(() => {
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
  });
  /* node:coverage enable */
}
