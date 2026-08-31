import { readFile, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { loadGenerationConfig } from './scripts/lib/config/generation.ts';

const GAMES_DIR = resolve(import.meta.dirname, 'games');

/**
 * Serve archived games byte-for-byte in dev.
 *
 * Vite's HTML pipeline otherwise injects its HMR client and React Refresh
 * into any `.html` it serves. Those injections fail inside the sandboxed
 * iframe (opaque origin, so they're CORS-blocked) and — more importantly —
 * mean the game previewed in dev is not the game that ships. Published
 * bundles must be exactly what the pipeline wrote and the smoke test
 * approved, so this bypasses the transform entirely.
 *
 * Registered directly (not via a returned post hook) so it runs before
 * Vite's own middlewares get the request.
 */
function serveArchivedGamesRaw(): Plugin {
  return {
    name: 'daily-game:serve-archived-games-raw',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0] ?? '';
        if (!/^\/games\/.+\.html$/.test(pathname)) return next();

        // A path that escapes the archive is REFUSED, never passed on with
        // next(): Vite's own static middleware would happily follow a
        // symlink out of the repo. Only a genuine miss falls through.
        const deny = (): void => {
          res.statusCode = 403;
          res.end('Forbidden');
        };

        const requested = resolve(
          join(GAMES_DIR, decodeURIComponent(pathname).replace(/^\/games\//, '')),
        );
        if (!requested.startsWith(GAMES_DIR + sep)) return deny();

        void (async () => {
          let realPath: string;
          try {
            // Resolves symlinks, so a link inside games/ cannot point out of it.
            realPath = await realpath(requested);
          } catch {
            return next(); // genuinely missing — let Vite answer
          }

          if (!realPath.startsWith(GAMES_DIR + sep)) return deny();

          try {
            const contents = await readFile(realPath);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(contents);
          } catch {
            next();
          }
        })();
      });
    },
  };
}

// The Vite root is the repo root, so `manifest.json` and `games/archive/*`
// resolve at the same URLs in dev as they do on Pages — the dev server
// reads the very files the daily pipeline writes.
//
// `base: './'` keeps asset URLs relative, so the build works whether it's
// served from a domain root or from /daily-game/.
//
// Config is a function so `mode` can be read: it becomes the Sentry
// environment tag, which is what keeps a local run's errors filterable
// apart from real visitors'. tsconfig.web.json sets `types: []`, so
// `import.meta.env` is deliberately not available to src/.
export default defineConfig(({ mode }) => ({
  base: './',
  define: {
    // config/generation.json is the DSN's single source of truth — publish.ts
    // reads the same field for the snippet it appends to game bundles.
    // Inlined at build time rather than written into src/, where
    // .github/workflows/secret-scan.yml treats a DSN literal as a leaked
    // credential. Read through the validating loader, so a malformed DSN
    // fails the build instead of shipping a client that posts nowhere.
    __SENTRY_DSN__: JSON.stringify(loadGenerationConfig().sentryDsn),
    __SENTRY_ENVIRONMENT__: JSON.stringify(mode),
  },
  plugins: [serveArchivedGamesRaw(), react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Emitted so the frames in a Sentry event name real files and lines.
    // Without them every report from the page shell arrives minified, which
    // is most of the value of having wired Sentry up at all.
    sourcemap: true,
  },
}));
