/**
 * Mocha root hooks: print the run id up front and always clean up at the
 * end (also after a failure), unless E2E_KEEP=true.
 *
 * @module hooks
 */
import ctx from './run-context.js';
import { cleanupRun } from './cleanup.js';
import * as pg from './pg.js';

export const mochaHooks = {
  beforeAll() {
    console.log(`\n  e2e run ${ctx.runId} (artifacts: ${ctx.artifactsDir})\n`);
    ctx.save();
  },

  async afterAll() {
    this.timeout(30 * 60000);
    if (process.env.E2E_KEEP === 'true') {
      console.log(`\n  E2E_KEEP=true: leaving run ${ctx.runId} in place. Clean up with: npm run cleanup -- ${ctx.runId}`);
    } else {
      console.log(`\n  cleaning up ${ctx.runId}...`);
      const folderRefs = [ctx.folderRef, ctx.controlFolderRef].filter(Boolean);
      const report = await cleanupRun(ctx.runId, { folderRefs });
      console.log(`  cleanup: ${JSON.stringify(report)}`);
    }
    await pg.close();
  },
};
