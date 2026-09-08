#!/usr/bin/env node
// CLI entrypoint for the daily run.
//
// Keeps this name because every workflow and npm script command line already
// points at it; the pipeline itself lives in run-daily-pipeline.ts.
import { pathToFileURL } from 'node:url';
import { type RunDailyPipelineOptions, runDailyPipeline } from '#scripts/run-daily-pipeline.ts';

const FORCE_MODEL_FLAG = '--force-model=';

function parseCliArgs(argv: string[]): RunDailyPipelineOptions {
  const forceModelArg = argv.find((arg) => arg.startsWith(FORCE_MODEL_FLAG));
  // Slice rather than split('=') so a model id containing '=' survives intact.
  const forceModel = forceModelArg?.slice(FORCE_MODEL_FLAG.length);
  return {
    dryRun: argv.includes('--dry-run'),
    verbose: argv.includes('--verbose'),
    ...(forceModel ? { forceModel } : {}),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // A failed generation is a normal outcome and must still exit green;
  // only an unexpected crash is a real CI failure.
  runDailyPipeline(parseCliArgs(process.argv.slice(2))).catch((error: unknown) => {
    console.error('Pipeline crashed:', error);
    process.exitCode = 1;
  });
}
