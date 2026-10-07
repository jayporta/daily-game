// The one number the hang tests in smokeTest.test.ts and pageActivity.test.ts
// share.

/**
 * The probe deadline the smoke tests use for a page that hangs. Must exceed a
 * full probe of a page that merely does nothing (about 2.6s), or a slow probe
 * reads as a hang and the tests stop telling the two apart.
 */
export const HANG_BUDGET_MS = 4000;
