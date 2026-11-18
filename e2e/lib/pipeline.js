/**
 * Pipeline health and idleness for one collection, read from Dagster runs
 * and argonath's Postgres state.
 *
 * - assertNoFailures() is the fail-fast hook every stage runs on each poll.
 * - waitForQuiet() is the "done" check before asserting final state: nothing
 *   queued and nothing running, holding steady across a window longer than
 *   the cask-audit settle time plus a sensor tick.
 *
 * @module pipeline
 */
import { listRunsByTags, runUrl } from '@ucd-lib/argonath/lib/dagster.js';
import config from '../config.js';
import ctx from './run-context.js';
import * as pg from './pg.js';
import { PipelineFailure, waitFor } from './wait.js';

const IN_FLIGHT = ['QUEUED', 'NOT_STARTED', 'STARTING', 'STARTED', 'CANCELING'];
const DAGSTER = { baseUrl: config.dagster.url };

// failures already reported, so a later (passing) stage doesn't re-trip on them
const acknowledged = new Set();

/**
 * Dagster runs for this collection: item and cask-change runs carry
 * argonath/collection; partitioned runs (rollup, reconcile) carry dagster/partition.
 *
 * @param {Object} [opts={}] - listRunsByTags() options, e.g. {statuses}.
 * @returns {Promise<Array<Object>>} Runs, deduped by runId.
 */
async function collectionRuns(opts = {}) {
  const [byTag, byPartition] = await Promise.all([
    listRunsByTags({ 'argonath/collection': ctx.collectionKey }, { ...DAGSTER, ...opts }),
    listRunsByTags({ 'dagster/partition': ctx.collectionKey }, { ...DAGSTER, ...opts }),
  ]);
  const runs = new Map();
  for (const run of [...byTag, ...byPartition]) runs.set(run.runId, run);
  return [...runs.values()];
}

/**
 * Throw if the pipeline reported a new failure for this collection since `since`:
 * a FAILURE Dagster run, a failed reporting command, or a failed job_result.
 *
 * @param {Date} since - Ignore failures older than this.
 * @returns {Promise<void>}
 * @throws {PipelineFailure} With run links and error messages.
 */
async function assertNoFailures(since) {
  const problems = [];
  const sinceSec = since.getTime() / 1000;

  const failedRuns = (await collectionRuns({ statuses: ['FAILURE'] }))
    .filter(r => (r.startTime || 0) >= sinceSec && !acknowledged.has(`run:${r.runId}`));
  for (const run of failedRuns) {
    acknowledged.add(`run:${run.runId}`);
    problems.push(`Dagster ${run.jobName} FAILURE: ${runUrl(run.runId, DAGSTER)}`);
  }

  for (const cmd of await pg.getFailedCommands(ctx.collection, since)) {
    const key = `cmd:${cmd.job_id}:${cmd.stage}:${cmd.item_id}`;
    if (acknowledged.has(key)) continue;
    acknowledged.add(key);
    problems.push(`reporting.command ${cmd.stage} failed (run ${cmd.job_id}, item ${cmd.item_id}): ${cmd.message || ''}`);
  }

  const registration = await pg.getCollection(ctx.collectionKey);
  if (registration) {
    for (const r of await pg.getJobResults(registration.id)) {
      const key = `result:${r.job_name}:${r.item_name}:${r.updated_at?.toISOString?.()}`;
      if (!pg.isFailedResult(r) || r.updated_at < since || acknowledged.has(key)) continue;
      acknowledged.add(key);
      const detail = r.result?.error || (r.result?.failed_items ? JSON.stringify(r.result.failed_items) : '');
      problems.push(`job_result ${r.job_name} ${r.item_name || '(collection)'} failed: ${detail}`);
    }
  }

  if (problems.length) throw new PipelineFailure(`pipeline reported failures:\n  ${problems.join('\n  ')}`);
}

/**
 * A fail-fast hook for stage()/waitFor(), checking for failures since now.
 *
 * @returns {Function} async () => void.
 */
function failFastFrom() {
  const since = new Date();
  return () => assertNoFailures(since);
}

/**
 * Whether the collection has no queued jobs and no in-flight runs.
 *
 * @returns {Promise<Object>} {idle, queued, running}.
 */
async function idleState() {
  const registration = await pg.getCollection(ctx.collectionKey);
  const queued = registration ? await pg.getQueueCount(registration.id) : 0;
  const running = (await collectionRuns({ statuses: IN_FLIGHT })).length;
  return { idle: queued === 0 && running === 0, queued, running };
}

/**
 * Wait until the collection stays idle for `quietMs`.
 *
 * @param {Object} [opts={}] - Options.
 * @param {number} [opts.quietMs] - How long idle must hold (default E2E_QUIET_MS or 90s:
 *   settle 30s + two 30s sensor ticks).
 * @param {number} [opts.timeout] - Overall timeout (default config.timing.process).
 * @returns {Promise<void>}
 */
async function waitForQuiet(opts = {}) {
  const quietMs = opts.quietMs ?? Number(process.env.E2E_QUIET_MS || 90000);
  let idleSince = null;
  await waitFor(async () => {
    const state = await idleState();
    if (!state.idle) {
      idleSince = null;
      return false;
    }
    idleSince = idleSince || Date.now();
    return Date.now() - idleSince >= quietMs ? state : false;
  }, {
    label: `collection idle for ${Math.round(quietMs / 1000)}s`,
    timeout: opts.timeout ?? config.timing.process,
    interval: Math.min(config.timing.interval, 10000),
    failFast: failFastFrom(),
  });
}

export { collectionRuns, assertNoFailures, failFastFrom, idleState, waitForQuiet };
