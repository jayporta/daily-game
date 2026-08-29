import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// Component tests run under Vitest because Node's test runner cannot load
// .tsx at all — its type stripping does not transform JSX. The split is by
// what the code needs, not by directory:
//
//   *.test.tsx  → Vitest + jsdom  (rendering, hooks, user interaction)
//   *.test.ts   → node --test     (pure logic and the Node pipeline)
//
// Because the patterns are disjoint, neither runner picks up the other's
// files and nothing is executed twice.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.tsx'],
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/vitest.setup.ts'],
      restoreMocks: true,
    },
  }),
);
