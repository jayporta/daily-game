#!/usr/bin/env node
// Checks every hand-editable file the pipeline reads, before it spends an
// API call finding out one of them is broken.
//
// No validation logic of its own: each loader in scripts/lib/ already
// validates, so this walks them and reports which file failed.
import { pathToFileURL } from 'node:url';
import { errorMessage } from '../lib/errors.ts';
import {
  loadGenerationConfig,
  loadGenresConfig,
  loadGuardrails,
  loadModelsConfig,
  loadReactionConfig,
} from './lib/config-store.ts';
import { readHotWindow, readSummary } from './lib/history-store.ts';
import { paths as defaultPaths, type Paths } from './lib/paths.ts';

/** One file to check, and the loader that validates it. */
interface Check {
  /** Path shown in output, relative to the repo root. */
  readonly label: string;
  /** Throws when the file is missing, unparseable or invalid. */
  readonly load: () => unknown;
}

/** What a run found. */
export interface ValidationReport {
  /** Labels of the files that loaded cleanly, in the order checked. */
  readonly checked: readonly string[];
  /** `label: message` for each file that failed. Empty when all passed. */
  readonly failures: readonly string[];
}

function checksFor(paths: Paths): readonly Check[] {
  return [
    { label: 'config/models.json', load: () => loadModelsConfig(paths.modelsConfig) },
    { label: 'config/genres.json', load: () => loadGenresConfig(paths.genresConfig) },
    { label: 'config/generation.json', load: () => loadGenerationConfig(paths.generationConfig) },
    { label: 'config/guardrails.md', load: () => loadGuardrails(paths.guardrails) },
    { label: 'config/reaction-config.json', load: () => loadReactionConfig(paths.reactionConfig) },
    { label: 'history/games.json', load: () => readHotWindow(paths.historyGames) },
    { label: 'history/summary.json', load: () => readSummary(paths.historySummary) },
  ];
}

/**
 * Runs every check, collecting failures instead of stopping at the first.
 *
 * A hand-edit session often breaks more than one file, and a run that
 * reports all of them costs one round trip instead of several.
 *
 * @param paths Overridden in tests to point at a scratch directory.
 */
export function validateAll(paths: Paths = defaultPaths): ValidationReport {
  const checked: string[] = [];
  const failures: string[] = [];

  for (const check of checksFor(paths)) {
    try {
      check.load();
      checked.push(check.label);
    } catch (error) {
      failures.push(`${check.label}: ${errorMessage(error)}`);
    }
  }

  return { checked, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = validateAll();
  for (const label of report.checked) console.log(`ok  ${label}`);
  for (const failure of report.failures) console.error(`FAIL ${failure}`);

  if (report.failures.length > 0) {
    console.error(`\n${report.failures.length} file(s) failed validation.`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${report.checked.length} files valid.`);
  }
}
