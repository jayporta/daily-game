import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOpenRouterClient } from '#scripts/lib/get-client.ts';

test('forceMock uses the given fixture sequence', async () => {
  const client = getOpenRouterClient({ forceMock: true, fixtureSequence: ['fixture-a'] });
  const result = await client.complete({ model: 'm', messages: [], temperature: 0.7 });
  assert.equal(result.text, 'fixture-a');
});

test('falls back to mock with default fixtures when no API key is set', async (t) => {
  const original = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  t.after(() => {
    if (original !== undefined) process.env.OPENROUTER_API_KEY = original;
  });

  const client = getOpenRouterClient();
  const result = await client.complete({ model: 'm', messages: [], temperature: 0.7 });
  assert.match(result.text, /```json/);
});
