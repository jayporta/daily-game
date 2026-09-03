// The one place the shipped BYOK model catalogue is read. Isolated from the
// panel so that component stays free of a JSON import the Node test runner
// cannot resolve.
//
// Imported at build time rather than fetched, for the same reason
// reaction-config.ts is: `deploy-pages.yml` rebuilds the site on every push
// to `main`, so an edit to the JSON always ships, and the page avoids a
// second network round-trip for a file that changes almost never.
import raw from '#config/byok-models.json';
import { type ByokModelsConfig, isByokModelsConfig } from '#lib/byok-config-types.ts';

const EMPTY: ByokModelsConfig = [];

/**
 * The providers and models the panel offers, as this site shipped them.
 *
 * Validated rather than trusted even though it is our own file: it is
 * hand-edited, and `resolveJsonModule` types it by its current contents, so
 * an edit that changed its shape would type-check and fail in the browser.
 *
 * A malformed file degrades to an empty catalogue, which the panel renders as
 * nothing at all rather than as a pair of empty menus.
 */
export const byokModelsConfig: ByokModelsConfig = isByokModelsConfig(raw) ? raw : EMPTY;
