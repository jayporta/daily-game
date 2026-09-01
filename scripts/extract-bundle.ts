#!/usr/bin/env node
// Thin Node wrapper around the isomorphic extraction core, plus a CLI mode
// for manually debugging a real model response:
//   node scripts/extract-bundle.ts < response.txt
import { pathToFileURL } from 'node:url';
import { extractBundle } from '#lib/extract-bundle-shared.ts';

export { extractBundle };

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const result = extractBundle(raw);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
