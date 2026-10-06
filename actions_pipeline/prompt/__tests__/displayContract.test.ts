import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DISPLAY_CONTRACT } from '#actions_pipeline/prompt/displayContract.ts';

// The same lesson as the meta example below: a model handed a number
// reproduces it. Naming any concrete size would re-create the fixed-canvas
// problem this contract exists to prevent.
test('the display contract anchors the model to no particular size', () => {
  assert.doesNotMatch(
    DISPLAY_CONTRACT,
    /\b\d{3,4}\s*(?:px\b|[x\u00d7]\s*\d{3,4})/i,
    'the display contract names a pixel size, which models copy literally',
  );
});

// guardrails.md is injected verbatim into BOTH the generator and the
// moderator, which is why a display rule must not live there: the moderator
// judges content, and would start failing games closed over their layout.
test('the display contract is not part of the shared content guardrails', () => {
  const guardrails = readFileSync(
    new URL('../../../config/guardrails.md', import.meta.url),
    'utf8',
  );

  assert.ok(!guardrails.includes(DISPLAY_CONTRACT), 'display rules leaked into guardrails.md');
});
