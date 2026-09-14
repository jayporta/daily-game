#!/usr/bin/env node
// CLI entrypoint for the daily run.
//
// Keeps this name because every workflow and npm script command line already
// points at it; the pipeline itself lives in runDailyPipeline.ts.
import { pathToFileURL } from 'node:url';
import {
  dsnFromConfigOrNull,
  pipelineEnvironment,
  reportPipelineCrash,
} from '#actions_pipeline/lib/pipelineReporting.ts';
import {
  type RunDailyPipelineOptions,
  runDailyPipeline,
} from '#actions_pipeline/runDailyPipeline.ts';

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
  runDailyPipeline(parseCliArgs(process.argv.slice(2))).catch(async (error: unknown) => {
    console.error('Pipeline crashed:', error);
    process.exitCode = 1;
    // The DSN is read defensively: an unreadable config is itself one of the
    // things that gets a run here.
    await reportPipelineCrash({
      error,
      dsn: dsnFromConfigOrNull(),
      release: process.env['GITHUB_SHA'],
      environment: pipelineEnvironment(),
    });
  });
}
