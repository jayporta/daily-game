import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readJson, readJsonOrNull, writeJson } from '#scripts/lib/json-file.ts';

function scratchDir(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'daily-game-json-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a written file reads back as the value that was written', (t) => {
  const file = join(scratchDir(t), 'value.json');
  const value = { b: [1, 2], a: 'x', nested: { deep: true } };

  writeJson(file, value);

  assert.deepEqual(readJson(file), value);
});

// The daily job commits these files, so the indentation and the trailing
// newline decide whether a run shows up as a one-line diff or a whole-file
// one. Asserted on the bytes rather than the parsed value.
test('a written file is two-space indented and ends in one newline', (t) => {
  const file = join(scratchDir(t), 'format.json');

  writeJson(file, { a: 1, b: [2] });

  assert.equal(readFileSync(file, 'utf8'), '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}\n');
});

test('writing creates a directory that is not there yet', (t) => {
  const file = join(scratchDir(t), 'deep', 'deeper', 'value.json');

  writeJson(file, { ok: true });

  assert.deepEqual(readJson(file), { ok: true });
});

test('readJson names the file it could not parse', (t) => {
  const file = join(scratchDir(t), 'broken.json');
  writeFileSync(file, '{ not json', 'utf8');

  assert.throws(() => readJson(file), new RegExp(`${file}: could not read or parse JSON`));
});

test('readJsonOrNull answers null for a file that is not there', (t) => {
  assert.equal(readJsonOrNull(join(scratchDir(t), 'absent.json')), null);
});

test('readJsonOrNull answers null for a file that is not JSON', (t) => {
  const file = join(scratchDir(t), 'broken.json');
  writeFileSync(file, 'not json at all', 'utf8');

  assert.equal(readJsonOrNull(file), null);
});
