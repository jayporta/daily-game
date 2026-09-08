// What the last run reported, shared with whatever needs to explain the page.
import { createContext } from 'react';
import type { RunStatus } from '#lib/status.ts';

/**
 * The published run status, `null` when there is nothing to report, and
 * `undefined` where no provider stands above the reader.
 *
 * The three-way value is what lets {@link useRunStatusContext} tell a missing
 * provider from the ordinary case of a day with nothing to say.
 */
export const RunStatusContext = createContext<RunStatus | null | undefined>(undefined);
