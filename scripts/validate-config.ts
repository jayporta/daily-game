#!/usr/bin/env node
// Checks every hand-editable file the pipeline reads, before it spends an
// API call finding out one of them is broken.
//
// Each config module in scripts/lib/config/ already validates its own file,
// so this walks those loaders and reports which file failed. The only rule
// that lives here is the CSP cross-check below, which is the one check that
// spans two files rather than belonging to either.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { errorMessage } from '../lib/errors.ts';
import { loadByokModelsConfig } from './lib/config/byokModels.ts';
import { loadGenerationConfig } from './lib/config/generation.ts';
import { loadGenresConfig } from './lib/config/genres.ts';
import { loadGuardrails } from './lib/config/guardrails.ts';
import { loadModelsConfig } from './lib/config/models.ts';
import { loadReactionConfig } from './lib/config/reactionConfig.ts';
import { readHotWindow, readSummary } from './lib/history-store.ts';
import { paths as defaultPaths, type Paths } from './lib/paths.ts';
import type { ValidationResult } from './lib/validation.ts';

/**
 * Checks that `index.html`'s CSP permits the configured reaction store.
 *
 * A `srcdoc` iframe inherits the parent's CSP and `connect-src` starts as
 * `'self'`, so a cross-origin store is blocked unless its origin is listed.
 * `sendReaction` swallows that failure by design, which means a missing
 * origin drops every reaction with nothing anywhere reporting it — hence a
 * check rather than a comment.
 *
 * @param endpointUrl From `config/reaction-config.json`; `null` means no
 *   store is configured and there is nothing to permit.
 */
export function validateCspAllowsEndpoint(
  endpointUrl: string | null,
  indexHtml: string,
): ValidationResult {
  if (endpointUrl === null) return { valid: true, errors: [] };

  let origin: string;
  try {
    origin = new URL(endpointUrl).origin;
  } catch {
    return { valid: false, errors: [`endpointUrl is not a URL: ${endpointUrl}`] };
  }

  // Scoped to the policy's own `content` attribute: index.html also discusses
  // connect-src in a comment, and matching that would read the prose instead
  // of the directive.
  const policy = /content="([^"]*connect-src[^"]*)"/i.exec(indexHtml)?.[1];
  const connectSrc = policy === undefined ? undefined : /connect-src([^;]*)/i.exec(policy)?.[1];
  if (connectSrc === undefined) {
    return { valid: false, errors: ['index.html has no connect-src directive'] };
  }
  if (!connectSrc.split(/\s+/).includes(origin)) {
    return {
      valid: false,
      errors: [
        `index.html's connect-src does not list ${origin} — the browser would ` +
          'block every reaction, and sendReaction swallows that failure silently',
      ],
    };
  }

  return { valid: true, errors: [] };
}

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
    { label: 'config/byok-models.json', load: () => loadByokModelsConfig(paths.byokModelsConfig) },
    { label: 'config/genres.json', load: () => loadGenresConfig(paths.genresConfig) },
    { label: 'config/generation.json', load: () => loadGenerationConfig(paths.generationConfig) },
    { label: 'config/guardrails.md', load: () => loadGuardrails(paths.guardrails) },
    { label: 'config/reaction-config.json', load: () => loadReactionConfig(paths.reactionConfig) },
    { label: 'history/games.json', load: () => readHotWindow(paths.historyGames) },
    { label: 'history/summary.json', load: () => readSummary(paths.historySummary) },
    {
      label: "index.html (CSP allows the reaction store)",
      load: () => {
        const { endpointUrl } = loadReactionConfig(paths.reactionConfig);
        const result = validateCspAllowsEndpoint(endpointUrl, readFileSync(paths.indexHtml, 'utf8'));
        if (!result.valid) throw new Error(result.errors.join('; '));
      },
    },
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
