// One real generation attempt per candidate, through the actual pipeline
// stages: prompt -> model -> extract -> moderate -> smoke test.
import { buildPrompt, SYSTEM_PROMPT } from './scripts/build-prompt.ts';
import { extractBundle } from './lib/extract-bundle-shared.ts';
import { createSmokeTester } from './scripts/smoke-test.ts';
import { createOpenRouterClient } from './scripts/lib/openrouter-client.ts';
import { loadAllConfig } from './scripts/lib/config-store.ts';
import { readHotWindow, readSummary } from './scripts/lib/history-store.ts';

const key = process.env['OPENROUTER_API_KEY'];
if (!key) throw new Error('no key');
const client = createOpenRouterClient({ apiKey: key });
const { genres, guardrails } = loadAllConfig();
const prompt = buildPrompt({
  guardrailsText: guardrails,
  genres,
  historyEntries: readHotWindow(),
  summary: readSummary(),
});

const candidates = [
  'cohere/north-mini-code:free',
  'poolside/laguna-s-2.1:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'minimax/minimax-m3:free',
  'minimax/minimax-m2.7:free',
  'inclusionai/ling-3.0-flash-fin:free',
  'dots-studio/dots-3-note-preview:free',
  'openrouter/free',
];

const tester = await createSmokeTester();
try {
  for (const model of candidates) {
    const started = Date.now();
    let raw: string;
    try {
      raw = await client.complete({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
      });
    } catch (error) {
      console.log(`${model.padEnd(48)} CALL FAILED  ${(error as Error).message.slice(0, 60)}`);
      continue;
    }

    const extracted = extractBundle(raw);
    if (!extracted.ok) {
      console.log(`${model.padEnd(48)} EXTRACT      ${extracted.reason}  (${Math.round((Date.now() - started) / 1000)}s)`);
      continue;
    }

    const smoke = await tester.test(extracted.html);
    const secs = Math.round((Date.now() - started) / 1000);
    if (smoke.pass) {
      console.log(`${model.padEnd(48)} PLAYABLE     "${extracted.meta.title}" drew=${smoke.canvasDrawn} (${secs}s, ${extracted.html.length}b)`);
    } else {
      console.log(`${model.padEnd(48)} SMOKE FAIL   ${smoke.reasons.join('; ').slice(0, 70)} (${secs}s)`);
    }
  }
} finally {
  await tester.close();
}
