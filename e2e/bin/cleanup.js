#!/usr/bin/env node
/**
 * Clean up e2e runs left behind (E2E_KEEP=true, or an interrupted run).
 *
 *   npm run cleanup -- <runId> [<runId>...]   clean specific runs
 *   npm run cleanup -- --stale [--hours 24]   clean every e2e-* run registered over N hours ago
 */
import { Command } from 'commander';
import { cleanupRun, staleRunIds } from '../lib/cleanup.js';
import * as pg from '../lib/pg.js';

const program = new Command();

program
  .name('e2e-cleanup')
  .description('Remove the Preservica folders, registry rows, CaskFS folders and ES docs of e2e runs.')
  .argument('[runIds...]', 'Run ids, e.g. e2e-20261118-0742-a1b2')
  .option('--stale', 'Clean every active e2e-* run older than --hours')
  .option('--hours <n>', 'Age threshold for --stale', '24')
  .action(async (runIds, opts) => {
    let ids = runIds;
    if (opts.stale) ids = [...new Set([...ids, ...await staleRunIds({ olderThanHours: Number(opts.hours) })])];
    if (!ids.length) {
      console.log('Nothing to clean (pass run ids or --stale).');
    }
    let failed = false;
    for (const runId of ids) {
      console.log(`cleaning ${runId}`);
      const report = await cleanupRun(runId);
      console.log(JSON.stringify(report, null, 2));
      if (report.errors.length) failed = true;
    }
    await pg.close();
    process.exitCode = failed ? 1 : 0;
  });

program.parseAsync();
