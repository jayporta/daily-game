import { useEffect, useState } from 'react';
import {
  THEME_ATTRIBUTE,
  nextTheme,
  rememberTheme,
  resolveInitialTheme,
  type Theme,
} from './theme.ts';
import { localStorageOrNull } from '../../lib/browser-storage.ts';

/** The active theme, and the one thing a visitor can do to it. */
export interface UseThemeResult {
  /** What the page is painted in right now. */
  readonly theme: Theme;
  /** Switches to the other theme and remembers the choice. */
  toggle: () => void;
}

/** Whether the operating system asks for a dark palette. */
function prefersDark(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  } catch {
    return false;
  }
}

/**
 * Holds the visitor's theme and keeps `<html>` painted to match.
 *
 * The initial value repeats the computation `index.html` already ran before
 * first paint, so mounting never changes what is on screen — the inline
 * bootstrap exists to make that first frame correct, and this hook to keep
 * it correct afterwards.
 *
 * Deliberately does not follow later operating-system changes: past the
 * first visit the visitor's own choice is the answer.
 */
export function useTheme(): UseThemeResult {
  const [theme, setTheme] = useState<Theme>(() =>
    resolveInitialTheme(localStorageOrNull(), prefersDark()),
  );

  // `<html>` lives outside React's tree, so this is synchronisation with
  // something external rather than state mirrored into the DOM.
  useEffect(() => {
    document.documentElement.setAttribute(THEME_ATTRIBUTE, theme);
  }, [theme]);

  return {
    theme,
    toggle: () => {
      const chosen = nextTheme(theme);
      setTheme(chosen);
      rememberTheme(localStorageOrNull(), chosen);
    },
  };
}
