import type { ReactNode } from 'react';

/**
 * How loudly a pill reads. Each tone names its own colours in both
 * palettes; the shape, padding and transition are shared.
 *
 * - `accent` — the affirmative action (Like).
 * - `neutral` — its counterweight (Dislike).
 * - `strong` — commits the chosen reasons (Send).
 * - `quiet` — unfilled, so declining does not read as a second button (Skip).
 */
export type PillTone = 'accent' | 'neutral' | 'strong' | 'quiet';

/**
 * Colours per tone. Each string is complete, since Tailwind only generates
 * class names it can read whole in the source.
 */
const TONE_CLASSES: Record<PillTone, string> = {
  accent:
    'bg-like text-like-ink hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25',
  neutral:
    'bg-chip text-label hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
  strong:
    'bg-chip text-body hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600',
  quiet: 'text-meta hover:text-body dark:text-slate-400 dark:hover:text-slate-200',
};

const PILL_BASE = 'rounded-2xl px-4 py-1.5 font-semibold transition-colors';

export interface PillButtonProps {
  /** Which palette the pill wears. See {@link PillTone}. */
  readonly tone: PillTone;
  /** What pressing it does. */
  onClick: () => void;
  /** The label. Text, not markup — these are our own words, not the model's. */
  children: ReactNode;
}

/** The rounded pill every action in the rating strip is drawn as. */
export function PillButton({ tone, onClick, children }: PillButtonProps) {
  return (
    <button type="button" onClick={onClick} className={`${PILL_BASE} ${TONE_CLASSES[tone]}`}>
      {children}
    </button>
  );
}
