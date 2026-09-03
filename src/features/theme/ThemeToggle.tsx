import { nextTheme } from '@/features/theme/theme.ts';
import { useTheme } from '@/features/theme/useTheme.ts';
import { Icon } from '@/shared_components/Icon.tsx';
import { IconButton } from '@/shared_components/IconButton.tsx';

/**
 * Switches the site between its light and dark palettes.
 *
 * Labelled with the theme it switches *to*, so the control describes what
 * pressing it does rather than what is already on screen, and drawn the
 * same way — a moon while the page is light, a sun while it is dark.
 *
 * Only the site's own chrome changes. The game keeps its own colours: it is
 * AI-authored HTML behind an opaque origin that ships byte-for-byte, so
 * nothing here can reach inside it.
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const target = nextTheme(theme);

  return (
    <IconButton onClick={toggle} label={`Switch to ${target} theme`}>
      <Icon>
        {target === 'dark' ? (
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        )}
      </Icon>
    </IconButton>
  );
}
