// What a generation run reports back: the game it published, or the failure
// records it leaves when every attempt fell through. The loop that produces
// it lives in generateDailyGame.ts.

import type { FailureKind } from '#actions_pipeline/lib/historyStore.ts';
import type { GeneratedMeta } from '#lib/extractBundleShared.ts';

/** The outcome of `generateDailyGame`, discriminated on `status`. */
export type GenerateResult =
  | {
      status: 'success';
      meta: GeneratedMeta;
      html: string;
      model: string;
      attempts: number;
      /** Whether the game painted anything during the smoke test. */
      canvasDrawn: boolean;
      /** The exact user-turn prompt that produced this bundle — persisted by publish.ts. */
      prompt: string;
      /**
       * The same failures as `reasons` would describe on a failed run, as
       * closed-vocabulary ids, for every attempt before this one succeeded.
       * Empty when the first attempt won on the model it asked for.
       *
       * One attempt can contribute more than one record: each model that
       * failed over to a fallback within it has a `generation-failover`
       * record of its own, so a first attempt served by a fallback is not
       * empty.
       */
      kinds: FailureKind[];
      /**
       * The model each of those records is charged to, parallel to `kinds` by
       * index. A failed-over model appears here ahead of the one that served.
       */
      attemptModels: string[];
      /** Whether any of those attempts was refused for provider capacity. */
      quotaAffected: boolean;
    }
  | {
      status: 'failed_kept_previous';
      attempts: number;
      /** Why each attempt failed, one per attempt. Failovers appear only in `kinds`. */
      reasons: string[];
      /**
       * The same failures as `reasons`, as closed-vocabulary ids, plus a
       * `generation-failover` record for each model that failed over to a
       * fallback within an attempt. It is longer than `reasons` when any did.
       */
      kinds: FailureKind[];
      /**
       * The model each record is charged to, parallel to `kinds` by index. A
       * failed-over model appears here ahead of the one that served.
       */
      attemptModels: string[];
      model: string;
      /**
       * Whether every attempt failed because the provider had no capacity
       * left, which is the one failure no retry and no other model can fix.
       */
      quotaExhausted: boolean;
      /**
       * Whether any attempt — not necessarily every one — was refused for
       * provider capacity.
       *
       * A superset of `quotaExhausted`: true whenever that is, and also true
       * on a day that failed for mixed reasons. `checkModels.ts` skips a day
       * this flags entirely rather than only the exhausted case, so a model
       * that merely happened to run out the rotation's clock on a quota
       * refusal is not blamed for it as a `generation-call` failure.
       */
      quotaAffected: boolean;
    };
