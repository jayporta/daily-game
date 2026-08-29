// Loaded before every Vitest file. Named `vitest.setup.ts`, not
// `test-setup.ts`, because node --test's default glob claims `test-*`
// filenames and would try to run this as a suite.
// adds jest-dom's DOM matchers and
// unmounts anything a test rendered, so no test can observe another's DOM.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
