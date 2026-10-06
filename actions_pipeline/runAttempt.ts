// One model's turn at a game: generate, extract, check the metadata,
// moderate, smoke test. The loop that rotates models and records failures
// around it lives in generateDailyGame.ts.

import {
  type AttemptOutcome,
  type AttemptProvenance,
  extractRejection,
  generationCallRejection,
  moderationRejection,
  placeholderMetaRejection,
  placeholderScriptRejection,
  smokeRejection,
  unknownGenreRejection,
} from '#actions_pipeline/attemptOutcome.ts';
import type { GenresConfig } from '#actions_pipeline/lib/config/genres.ts';
import type { OpenRouterClient } from '#actions_pipeline/lib/openRouterClient.ts';
import { failedOverModels } from '#actions_pipeline/lib/servedModel.ts';
import { moderate } from '#actions_pipeline/moderate.ts';
import { isPlaceholderScript } from '#actions_pipeline/placeholderScript.ts';
import { isPlaceholderMeta } from '#actions_pipeline/prompt/outputContract.ts';
import type { SmokeTester } from '#actions_pipeline/smokeTest.ts';
import { extractBundle } from '#lib/extractBundleShared.ts';
import type { ProviderStopReason } from '#lib/providerResponse.ts';
import { SYSTEM_PROMPT } from '#lib/systemPrompt.ts';

/**
 * Where a run's progress output goes.
 *
 * Injected rather than hardcoded so a test can silence a run. Several
 * exercise the every-attempt-failed path, whose reasons would otherwise land
 * in the test runner's own output.
 */
export type Logger = (message: string) => void;

/**
 * How many stand-in moderators one attempt may try after the dedicated one
 * fails to answer.
 *
 * Bounded because each gets its own timeout: the rotation is the attempt
 * count, so an unbounded chain multiplies the two and a run of hung
 * moderators would overrun the workflow's cap before it could record
 * `failed_kept_previous`. A 429 — the case this exists for — fails
 * immediately and never approaches that.
 */
export const MAX_MODERATION_FALLBACKS = 2;

/**
 * The rotation models that may moderate a game when the dedicated moderator
 * cannot be reached, at most {@link MAX_MODERATION_FALLBACKS} of them.
 *
 * Unrequested models come first, as a served id that resolved to the primary
 * may hide which requested one wrote the game. A rotation too small to fill
 * the cap with them tops it up from the requested models other than the one
 * that served, which is the primary when the served id was ambiguous.
 *
 * @param rotation - Every id in the active rotation, in order.
 * @param requested - The generation's primary followed by its fallbacks.
 * @param served - The model the provider reported as serving the generation.
 * @param moderationModel - The dedicated moderator, never its own stand-in.
 */
function standInModerators(
  rotation: readonly string[],
  requested: readonly string[],
  served: string,
  moderationModel: string,
): string[] {
  const others = rotation.filter((id) => id !== moderationModel);
  const unrequested = others.filter((id) => !requested.includes(id));
  const requestedButIdle = others.filter((id) => requested.includes(id) && id !== served);
  return [...unrequested, ...requestedButIdle].slice(0, MAX_MODERATION_FALLBACKS);
}

interface AttemptParams {
  readonly client: OpenRouterClient;
  readonly model: string;
  readonly prompt: string;
  readonly guardrails: string;
  /** The catalogue the reported genre has to name one of. */
  readonly genres: GenresConfig;
  /** OpenRouter-side fallbacks for the generation call; see `GENERATION_FALLBACKS`. */
  readonly fallbackModels: readonly string[];
  readonly moderationModel: string;
  /**
   * Every id in the active rotation. Stand-in moderators are drawn from it,
   * as {@link standInModerators} describes, and used only when
   * {@link moderationModel} is unreachable.
   */
  readonly rotation: readonly string[];
  readonly temperature: number;
  readonly smokeTester: SmokeTester;
  /** Already bound to this attempt's number by the loop. */
  readonly log: Logger;
}

/**
 * One model's turn: generate, extract, moderate, smoke test.
 *
 * Every rejection is an ordinary outcome rather than a throw, so the loop
 * that calls this has one place to record a failure and rotate the model.
 */
export async function runAttempt({
  client,
  model,
  prompt,
  guardrails,
  genres,
  fallbackModels,
  moderationModel,
  rotation,
  temperature,
  smokeTester,
  log,
}: AttemptParams): Promise<AttemptOutcome> {
  let raw: string;
  let stop: ProviderStopReason;
  let served: string;
  const requested = [model, ...fallbackModels];

  log('Requesting LLM generation...');
  try {
    ({
      text: raw,
      stop,
      model: served,
    } = await client.complete({
      model,
      fallbackModels,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature,
    }));
    if (served !== model) log(`served by ${served} (fallback from ${model})`);
    log(`Generation finished (Stop reason: ${stop})`);
  } catch (error) {
    return { served: model, failedOver: [], ...generationCallRejection(error) };
  }

  const provenance: AttemptProvenance = {
    served,
    failedOver: failedOverModels(served, model, fallbackModels),
  };

  const extracted = extractBundle(raw);
  log(`Bundle extraction: ${extracted.ok ? 'Success' : 'Failed'}`);

  if (!extracted.ok) {
    return { ...provenance, ...extractRejection(extracted.reason, stop === 'truncated') };
  }

  // The one field of the model's metadata with a fixed vocabulary, so the
  // one that can be checked outright. A response that leaves the output
  // format's example in place fails here rather than publishing as "...".
  if (!genres.some((genre) => genre.id === extracted.meta.genre)) {
    return { ...provenance, ...unknownGenreRejection() };
  }

  // The rest of the metadata has no fixed vocabulary, so it is checked here
  // for the literal example text instead. A model can pair a real genre id
  // with an otherwise-unfilled example — and a game that paints a static
  // overlay still passes the smoke test's render check — so this is what
  // catches it.
  if (isPlaceholderMeta(extracted.meta)) {
    return { ...provenance, ...placeholderMetaRejection() };
  }

  // A script of comments or a few stub lines parses, moderates and runs
  // cleanly, so it is stopped here before either is spent on it.
  if (isPlaceholderScript(extracted.html)) {
    return { ...provenance, ...placeholderScriptRejection() };
  }

  log('Running moderation...');
  const moderation = await moderate(client, {
    meta: extracted.meta,
    html: extracted.html,
    guardrailsText: guardrails,
    moderationModel,
    fallbackModels: standInModerators(rotation, requested, served, moderationModel),
  });

  if (!moderation.pass) return { ...provenance, ...moderationRejection(moderation) };

  log('Running smoke test...');
  const smoke = await smokeTester.test(extracted.html);

  if (!smoke.pass) {
    return { ...provenance, ...smokeRejection(smoke, moderation.quotaAffected) };
  }

  return {
    ...provenance,
    ok: true,
    meta: extracted.meta,
    html: extracted.html,
    canvasDrawn: smoke.canvasDrawn,
    quotaAffected: moderation.quotaAffected,
  };
}
