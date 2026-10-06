import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  workflowOutputLines,
  writeWorkflowOutputs,
} from '#actions_pipeline/lib/workflowOutputs.ts';

function scratchFile(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'daily-game-outputs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'github_output');
}

test('every outcome maps to its status and the slot date', () => {
  for (const status of ['success', 'failed_kept_previous', 'already_published'] as const) {
    assert.deepEqual(workflowOutputLines({ status, date: '2026-10-05' }), [
      `outcome=${status}`,
      'date=2026-10-05',
    ]);
  }
});

test('writing without an output file does nothing and does not throw', () => {
  assert.doesNotThrow(() =>
    writeWorkflowOutputs({ status: 'success', date: '2026-10-05' }, undefined),
  );
});

// The file already holds other steps' outputs, and truncating it would drop them.
test('writing appends to what the file already holds', (t) => {
  const file = scratchFile(t);
  writeFileSync(file, 'changed=true\n');

  writeWorkflowOutputs({ status: 'failed_kept_previous', date: '2026-10-05' }, file);

  assert.equal(
    readFileSync(file, 'utf8'),
    'changed=true\noutcome=failed_kept_previous\ndate=2026-10-05\n',
  );
});

// A newline in a value would start another `key=value` line, which is how one
// step could set an output it was never meant to.
test('a value containing a newline is refused and nothing is written', (t) => {
  const file = scratchFile(t);
  writeFileSync(file, 'changed=true\n');

  assert.throws(
    () => writeWorkflowOutputs({ status: 'success', date: '2026-10-05\npublished=true' }, file),
    /newline/,
  );
  assert.throws(
    () => writeWorkflowOutputs({ status: 'success', date: '2026-10-05\rpublished=true' }, file),
    /newline/,
  );
  assert.equal(readFileSync(file, 'utf8'), 'changed=true\n');
});
