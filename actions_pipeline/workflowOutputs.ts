// What the run tells the workflow's later steps, as `key=value` lines for
// `$GITHUB_OUTPUT`: the outcome and the day it worked on.

import { appendFileSync } from 'node:fs';
import type { PipelineResult } from '#actions_pipeline/runDailyPipeline.ts';

/** The part of a {@link PipelineResult} the workflow reads. */
export type WorkflowOutcome = Pick<PipelineResult, 'status' | 'date'>;

/**
 * The outputs for one run.
 *
 * @returns `outcome=<status>` then `date=<YYYY-MM-DD>`.
 */
export function workflowOutputLines(result: WorkflowOutcome): string[] {
  return [`outcome=${result.status}`, `date=${result.date}`];
}

/**
 * Appends the run's outputs to the workflow's output file.
 *
 * @param filePath - The `$GITHUB_OUTPUT` path, or `undefined` outside Actions,
 * where nothing is written. The file may already hold other steps' outputs.
 * @throws If any output holds a newline, which would start an output of its
 * own. Nothing is written in that case.
 */
export function writeWorkflowOutputs(result: WorkflowOutcome, filePath: string | undefined): void {
  if (filePath === undefined) return;

  const lines = workflowOutputLines(result);
  if (lines.some((line) => /[\r\n]/.test(line))) {
    throw new Error('workflow output contains a newline');
  }
  appendFileSync(filePath, `${lines.join('\n')}\n`);
}
