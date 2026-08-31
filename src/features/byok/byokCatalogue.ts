// The one place the shipped BYOK model catalogue is read. Isolated from the
// panel so that component stays free of a JSON import the Node test runner
// cannot resolve.
//
// Imported at build time rather than fetched, for the same reason
// reaction-config.ts is: `deploy-pages.yml` rebuilds the site on every push
// to `main`, so an edit to the JSON always ships, and the page avoids a
// second network round-trip for a file that changes almost never.
import raw from '../../../config/byok-models.json';
import { isByokModelsConfig, type ByokModelsConfig } from '../../../lib/byok-config-types.ts';

const EMPTY: ByokModelsConfig = [];

export const byokModelsConfig: ByokModelsConfig = isByokModelsConfig(raw) ? raw : EMPTY;
