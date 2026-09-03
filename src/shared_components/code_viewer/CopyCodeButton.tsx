import { useEffect, useState } from 'react';
import { Icon } from '@/shared_components/Icon.tsx';
import { IconButton } from '@/shared_components/IconButton.tsx';

const REVERTS_AFTER_MS = 2_000;

/**
 * Copies the source to the clipboard, confirming with a checkmark that
 * reverts on its own — no toast, no layout shift.
 *
 * A rejected `writeText` (permissions, an insecure context) is swallowed:
 * there is no recovery action to offer a visitor here beyond trying again.
 */
export function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), REVERTS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleClick = (): void => {
    navigator.clipboard
      .writeText(code)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };

  return (
    <IconButton label={copied ? 'Copied' : 'Copy code'} onClick={handleClick}>
      <Icon>
        {copied ? (
          <path d="M5 12l4 4L19 6" />
        ) : (
          <>
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </>
        )}
      </Icon>
    </IconButton>
  );
}
