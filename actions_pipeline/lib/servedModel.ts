// Which of a request's models answered: read off the stream's frames, mapped
// back to the id that was requested, and the ones OpenRouter skipped to reach
// it. The client that sends the request lives in openRouterClient.ts.

import { stringAt } from '#lib/guards.ts';

/**
 * The model id a frame says served the response, read from its top-level
 * `model` field.
 *
 * @remarks
 * OpenRouter stamps every streamed frame with the model that produced it,
 * which is the only way to learn which of several requested models answered.
 *
 * @returns `null` for a frame that carries no model, or an empty one.
 */
export function servedModel(data: unknown): string | null {
  const model = stringAt(data, 'model');
  return model === '' ? null : model;
}

/** A model id without its `:variant` suffix (`:free`, `:nitro`, ...). */
function baseModelId(id: string): string {
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(0, colon);
}

/**
 * Maps the model id a stream reported back to the id that was requested.
 *
 * @remarks
 * A provider may report its own spelling of a requested id, such as dropping
 * the `:free` suffix, so an exact match is tried first and then a match on the
 * base id with any `:variant` suffix stripped from both sides.
 *
 * @param served The id from the stream's frames, or `null` when none carried one.
 * @param primary The request's `model`.
 * @param fallbacks The request's `fallbackModels`, in order.
 * @returns The matching requested id, or `primary` when nothing matches, so a
 *   result never names a model that was not asked for.
 */
export function resolveServedModel(
  served: string | null,
  primary: string,
  fallbacks: readonly string[],
): string {
  if (served === null) return primary;
  const requested = [primary, ...fallbacks];
  const servedBase = baseModelId(served);
  return (
    requested.find((id) => id === served) ??
    requested.find((id) => baseModelId(id) === servedBase) ??
    primary
  );
}

/**
 * The requested models ahead of the one that served, in request order: the
 * ones OpenRouter skipped.
 *
 * @param served The id {@link resolveServedModel} returned.
 * @param primary The request's `model`.
 * @param fallbacks The request's `fallbackModels`, in order.
 * @returns Empty when `served` is the primary, or was not requested at all.
 */
export function failedOverModels(
  served: string,
  primary: string,
  fallbacks: readonly string[],
): string[] {
  const requested = [primary, ...fallbacks];
  const servedAt = requested.indexOf(served);
  return servedAt === -1 ? [] : requested.slice(0, servedAt);
}
