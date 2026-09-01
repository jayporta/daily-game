import type { ReactNode } from 'react';
import { MetaText } from '@/shared_components/MetaText.tsx';

export interface CenteredProps {
  /** Message to centre in the viewer area. */
  readonly children: ReactNode;
}

/**
 * A status message where the game would be.
 *
 * Centres itself: `<main>` is a plain block, so a narrow child left to itself
 * sits against the left edge of the column rather than under the frame it
 * stands in for.
 */
export function Centered({ children }: CenteredProps) {
  return <MetaText layout="mx-auto max-w-sm text-center">{children}</MetaText>;
}
