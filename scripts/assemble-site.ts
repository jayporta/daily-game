#!/usr/bin/env node
// Combines the Vite build output with the published content into one
// deployable site directory.
//
// The build (`dist/`) and the published content (`manifest.json`,
// `games/archive/**`) live in different places: the first is generated and
// gitignored, the second is committed by the daily job. Pages needs them
// merged. Doing that here rather than in workflow YAML means it can be run
// and verified locally exactly as CI runs it.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPaths, paths as defaultPaths, REPO_ROOT } from './lib/paths.ts';
import { isManifest } from '../lib/manifest.ts';

export interface AssembleSiteParams {
  /** Repo root to read from — overridden in tests. */
  root?: string;
  /** Build output directory, also the assembly target. */
  outDir?: string;
}

export interface AssembleSiteResult {
  outDir: string;
  copiedManifest: boolean;
  copiedArchive: boolean;
}

/**
 * The files `manifest.json` points at that are not actually here.
 *
 * The manifest and the archive are written together by `publish.ts`, but they
 * are separate files, and a commit carrying one without the other deploys a
 * site whose only page 404s — with the pipeline green, the build green, and
 * nothing to notice until a visitor does.
 *
 * Checked here rather than in `npm run validate`: validate runs *before* the
 * daily generation, and failing there would block the very run that would
 * publish the missing bundle. Assembly is the moment the two must agree.
 *
 * @returns An empty array when no manifest exists, or when it is the
 *   seed-state `null` — nothing has been published yet.
 */
export function missingPublishedFiles(manifestPath: string, root: string): string[] {
  if (!existsSync(manifestPath)) return [];

  const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (parsed === null) return [];
  if (!isManifest(parsed)) return ['manifest.json is neither null nor a complete manifest'];

  // An absent promptPath is a game archived before prompts were, not an
  // omission; a declared one must be on disk like any other file.
  const declared = parsed.promptPath === undefined ? [parsed.path] : [parsed.path, parsed.promptPath];
  return declared.filter((file) => !existsSync(join(root, file)));
}

export function assembleSite({
  root = REPO_ROOT,
  outDir,
}: AssembleSiteParams = {}): AssembleSiteResult {
  const paths = root === REPO_ROOT ? defaultPaths : createPaths(root);
  const target = outDir ?? join(root, 'dist');

  if (!existsSync(target)) {
    throw new Error(`assemble-site: ${target} does not exist — run \`vite build\` first`);
  }

  // Pages would otherwise run the output through Jekyll, which strips
  // directories beginning with an underscore and can mangle asset paths.
  writeFileSync(join(target, '.nojekyll'), '', 'utf8');

  const missing = missingPublishedFiles(paths.manifest, root);
  if (missing.length > 0) {
    throw new Error(
      `assemble-site: manifest.json points at ${missing.join(', ')}, ` +
        'which the repo does not contain — the deployed site would 404',
    );
  }

  const copiedManifest = existsSync(paths.manifest);
  if (copiedManifest) {
    cpSync(paths.manifest, join(target, 'manifest.json'));
  }

  const copiedArchive = existsSync(paths.archiveDir);
  if (copiedArchive) {
    const archiveTarget = join(target, 'games', 'archive');
    mkdirSync(archiveTarget, { recursive: true });
    // Published bundles must land byte-for-byte as the pipeline wrote them
    // and the smoke test approved them — a plain copy, no transformation.
    cpSync(paths.archiveDir, archiveTarget, { recursive: true });
  }

  return { outDir: target, copiedManifest, copiedArchive };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = assembleSite();
  console.log(
    `Assembled site in ${result.outDir} ` +
      `(manifest: ${result.copiedManifest ? 'yes' : 'missing'}, ` +
      `archive: ${result.copiedArchive ? 'yes' : 'missing'})`,
  );
}
