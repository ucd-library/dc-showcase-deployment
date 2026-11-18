/**
 * Failure diagnostics: everything needed to see where a run stalled, written
 * to .artifacts/<runId>/<stage>/ so the stack can be torn down afterwards.
 *
 * @module diagnostics
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import config from '../config.js';
import ctx from './run-context.js';

const run = promisify(execFile);

/**
 * Write a JSON or text file, recording (not throwing) collection errors.
 *
 * @param {string} dir - Directory.
 * @param {string} name - File name.
 * @param {Function} produce - async () => data (string or JSON-able).
 * @returns {Promise<void>}
 */
async function capture(dir, name, produce) {
  let data;
  try {
    data = await produce();
  } catch (e) {
    data = `capture failed: ${e.message}`;
  }
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(path.join(dir, name), text);
}

/**
 * Dump Postgres rows, cask listings, ES docs, recent Dagster runs and
 * container logs for this run.
 *
 * @param {string} label - Stage that failed.
 * @returns {Promise<string>} The directory written.
 */
async function dumpDiagnostics(label) {
  // lazy imports avoid a cycle with wait.js
  const pg = await import('./pg.js');
  const cask = await import('./cask.js');
  const es = await import('./es.js');
  const { collectionRuns } = await import('./pipeline.js');

  const dir = path.join(ctx.artifactsDir, label.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
  fs.mkdirSync(dir, { recursive: true });
  const bronze = `/bronze/${ctx.group}/${ctx.collection}`;

  await Promise.all([
    capture(dir, 'context.json', async () => ctx),
    capture(dir, 'registry.json', async () => {
      const registration = await pg.getCollection(ctx.collectionKey);
      if (!registration) return { registration: null };
      return {
        registration,
        identifiers: await pg.getCollectionIdentifiers(registration.id),
        items: await pg.getItems(registration.id),
        jobResults: await pg.getJobResults(registration.id),
        queued: await pg.getQueueCount(registration.id),
      };
    }),
    capture(dir, 'failed-commands.json', () => pg.getFailedCommands(ctx.collection, ctx.startedAt)),
    capture(dir, 'audit-log.json', () => pg.getAuditEvents(`${bronze}/`)),
    capture(dir, 'cask-bronze.json', () => cask.walk(bronze)),
    capture(dir, 'cask-silver.json', () => cask.walk(`/silver/${ctx.group}/${ctx.collection}`)),
    capture(dir, 'cask-gold.json', () => cask.walk(`/gold/${config.goldProject}/collections/${ctx.collection}`)),
    capture(dir, 'es-items.json', () => es.findItems(ctx.runId)),
    capture(dir, 'es-collection.json', () => es.findCollection(ctx.runId)),
    capture(dir, 'dagster-runs.json', () => collectionRuns()),
    capture(dir, 'logs-argonath.txt', async () => (await run('docker', [
      'compose', '-p', config.compose.argonathProject, 'logs', '--no-color', '--since', '30m', '--tail', '2000',
    ], { maxBuffer: 64 * 1024 * 1024 })).stdout),
    capture(dir, 'logs-dc-showcase.txt', async () => (await run('docker', [
      'compose', '-p', config.compose.dcsProject, 'logs', '--no-color', '--since', '30m', '--tail', '1000',
    ], { maxBuffer: 64 * 1024 * 1024 })).stdout),
  ]);
  return dir;
}

export { dumpDiagnostics };
