import { useState } from 'react';
import { DISLIKE_REASONS, type DislikeReason } from '../../../lib/reaction-types.ts';
import { PillButton } from '../../ui/PillButton.tsx';

export interface DislikeReasonsProps {
  /**
   * Commits the dislike. Called with the chosen reasons, or an empty list
   * when the viewer skips — a dislike counts either way.
   */
  onSubmit: (reasons: readonly DislikeReason[]) => void;
}

const ALL_REASON_IDS: readonly DislikeReason[] = DISLIKE_REASONS.map((reason) => reason.id);

/** Chosen ids in vocabulary order, so a row does not depend on click order. */
function inVocabularyOrder(chosen: readonly DislikeReason[]): readonly DislikeReason[] {
  return ALL_REASON_IDS.filter((id) => chosen.includes(id));
}

/**
 * The fixed set of things a viewer can say went wrong.
 *
 * A closed vocabulary rather than a freetext box: the ids are all that
 * crosses the network, so nothing typed here can reach the history log or
 * the next day's generation prompt.
 */
export function DislikeReasons({ onSubmit }: DislikeReasonsProps) {
  const [chosen, setChosen] = useState<readonly DislikeReason[]>([]);
  const allChosen = chosen.length === ALL_REASON_IDS.length;

  const toggle = (id: DislikeReason): void =>
    setChosen((previous) =>
      previous.includes(id) ? previous.filter((each) => each !== id) : [...previous, id],
    );

  return (
    <div className="text-ui">
      <p className="mb-2 min-h-8 content-center text-meta dark:text-slate-400">What went wrong?</p>

      <ul className="space-y-1">
        {DISLIKE_REASONS.map((reason) => (
          <li key={reason.id}>
            <label className="flex items-center gap-2 text-label dark:text-slate-300">
              <input
                type="checkbox"
                checked={chosen.includes(reason.id)}
                onChange={() => toggle(reason.id)}
                className="size-4 accent-rose-500"
              />
              {reason.label}
            </label>
          </li>
        ))}
        {/* Set apart from the five: a convenience that ticks them all, not a
            sixth reason. What gets stored is always the concrete set. */}
        <li className="mt-2 border-t border-hairline pt-2 dark:border-slate-800">
          <label className="flex items-center gap-2 text-label dark:text-slate-300">
            <input
              type="checkbox"
              checked={allChosen}
              onChange={() => setChosen(allChosen ? [] : ALL_REASON_IDS)}
              className="size-4 accent-rose-500"
            />
            All of the above
          </label>
        </li>
      </ul>

      <div className="mt-3 flex gap-2">
        <PillButton tone="strong" onClick={() => onSubmit(inVocabularyOrder(chosen))}>
          Send
        </PillButton>
        <PillButton tone="quiet" onClick={() => onSubmit([])}>
          Skip
        </PillButton>
      </div>
    </div>
  );
}
