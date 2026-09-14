// JSON on disk: the two shapes of read this pipeline does, and the one write
// format every generated file is in.
//
// The format is load-bearing rather than cosmetic. These files are committed
// by the daily job, so a change to the indentation or the trailing newline
// shows up as a whole-file diff on the next run.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { errorMessage } from '#lib/errors.ts';

/**
 * Reads and parses a JSON file.
 *
 * @returns Whatever the file held, including `null` for a seed-state file.
 * @throws If the file cannot be read or is not JSON. The message names the
 *   path, since the caller is usually reporting on a file it was handed.
 */
export function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${filePath}: could not read or parse JSON — ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

/**
 * Like {@link readJson}, but answers `null` instead of throwing.
 *
 * For a reader that treats an unreadable file the same as an absent one.
 * A file that genuinely holds `null` is indistinguishable from a failure
 * here, which suits the callers that ask: both mean "no game named".
 */
export function readJsonOrNull(filePath: string): unknown {
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

/**
 * Writes `value` as JSON, creating the directory if it is not there.
 *
 * Two-space indented with a trailing newline — the format every JSON file in
 * the repo is already in, and the one the daily commit's diffs assume.
 */
export function writeJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
