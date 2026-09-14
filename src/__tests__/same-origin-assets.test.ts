import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { paths, REPO_ROOT } from '#actions_pipeline/lib/paths.ts';

const INDEX_CSS = join(REPO_ROOT, 'src', 'index.css');

/** Every `src`/`href` the document declares, in source order. */
function subresourceUrls(html: string): string[] {
  return [...html.matchAll(/\s(?:src|href)="([^"]*)"/gi)].map(([, url]) => url ?? '');
}

/** Every `url()` target a stylesheet declares, quotes stripped, in source order. */
function stylesheetUrls(css: string): string[] {
  return [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map(([, url]) => url ?? '');
}

// The three faces are npm packages declared in src/index.css and emitted into
// the build, so the page fetches them from its own origin. A <link> to a font
// CDN would render-block on a third party and hand every visitor's IP to it,
// and nothing else here would notice.
test('index.html requests no subresource from another origin', () => {
  const html = readFileSync(paths.indexHtml, 'utf8');

  const external = subresourceUrls(html).filter((url) => /^(?:https?:)?\/\//i.test(url));

  assert.deepEqual(external, []);
});

// A url() Vite cannot resolve is a warning, not an error: the build stays
// green, the asset is dropped, and the page 404s it at runtime. For the fonts
// that degrades to the fallback stack with nothing anywhere saying so, so the
// check that a package upgrade has not moved a file out from under us has to
// live here.
test('every url() in index.css resolves to a file that exists', () => {
  const missing = stylesheetUrls(readFileSync(INDEX_CSS, 'utf8')).filter((specifier) => {
    try {
      return !existsSync(fileURLToPath(import.meta.resolve(specifier)));
    } catch {
      return true;
    }
  });

  assert.deepEqual(missing, []);
});
