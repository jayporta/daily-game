// Which palette the page is painted in, and where that choice is kept.
//
// Free of React and of browser globals — storage arrives as a parameter —
// so the whole of it is unit tested under `node --test`. Every storage call
// is guarded: `localStorage` is absent in some embedding contexts and
// throws outright in Safari's private mode, and a theme is decoration that
// must never break the page.
//
// This is the site's chrome only. The game itself is AI-authored HTML
// behind an opaque origin and ships byte-for-byte, so it brings its own
// colours and does not follow the toggle. See src/components/GameFrame.tsx.
import type { WebStorage } from './browser-storage.ts';

/** The palettes on offer. A visitor toggles between them; there is no third, system-following state past the first visit. */
export const THEMES = ['light', 'dark'] as const;

/** One of {@link THEMES}. */
export type Theme = (typeof THEMES)[number];

/**
 * Attribute on `<html>` that carries the active theme.
 *
 * Tailwind's `dark:` variant is redefined against it in `src/index.css`,
 * so setting this attribute is the only thing that repaints the page.
 */
export const THEME_ATTRIBUTE = 'data-theme';

/** `localStorage` key holding the visitor's own choice. */
export const THEME_STORAGE_KEY = 'daily-game:theme';

/** Narrows a hand-editable stored string to a theme this site can paint. */
export function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value);
}

/**
 * The visitor's remembered choice, or `null` if they have not made one.
 *
 * Treats an unreachable storage and a junk value alike: no choice recorded.
 *
 * @param storage `null` when `localStorage` could not even be reached.
 */
export function readTheme(storage: WebStorage | null): Theme | null {
  if (storage === null) return null;
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Records the visitor's choice, best-effort.
 *
 * A failure costs them the preference on their next visit and nothing more,
 * so it is swallowed rather than surfaced.
 */
export function rememberTheme(storage: WebStorage | null, theme: Theme): void {
  if (storage === null) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Best-effort by design — see the note above.
  }
}

/**
 * What to paint on load: the visitor's own choice if they have one, and
 * otherwise whatever their operating system asks for.
 *
 * @param prefersDark Result of the `(prefers-color-scheme: dark)` query.
 */
export function resolveInitialTheme(storage: WebStorage | null, prefersDark: boolean): Theme {
  return readTheme(storage) ?? (prefersDark ? 'dark' : 'light');
}

/** The theme the toggle switches to from `theme`. */
export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
