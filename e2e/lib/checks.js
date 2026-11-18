/**
 * Reusable stage probes and state reads shared by the specs.
 *
 * @module checks
 */
import config from '../config.js';
import ctx from './run-context.js';
import * as cask from './cask.js';
import * as es from './es.js';
import * as pg from './pg.js';
import { itemPaths, roots } from './paths.js';
import { stage } from './wait.js';
import { failFastFrom } from './pipeline.js';

/**
 * This run's item doc for an ARK, from ES.
 *
 * @param {string} ark - Item ARK.
 * @returns {Promise<Object|null>} Doc, or null.
 */
async function esItem(ark) {
  const docs = await es.findItems(ctx.runId);
  return docs.find(d => JSON.stringify(d).includes(ark)) || null;
}

/**
 * This run's (published) collection doc, from ES. The control folder's title
 * also contains the run id, so it is excluded explicitly.
 *
 * @returns {Promise<Object|null>} Doc, or null.
 */
async function esCollection() {
  const docs = await es.findByPhrase(config.es.collectionIndex, ctx.runId);
  return docs.find(d => !JSON.stringify(d).includes('bronze-only')) || null;
}

/**
 * The item_count the collection doc reports, whichever field name it uses.
 *
 * @param {Object} doc - Collection doc.
 * @returns {number|undefined} Count.
 */
function itemCountOf(doc) {
  const graph = doc?.['@graph']?.[0] || {};
  return doc?.itemCount ?? graph.itemCount ?? doc?.item_count;
}

/**
 * Latest process_item_job result for an ARK.
 *
 * @param {string} ark - Item ARK.
 * @returns {Promise<Object|null>} {status, result, updated_at}, or null.
 */
async function itemResult(ark) {
  const registration = await pg.getCollection(ctx.collectionKey);
  if (!registration) return null;
  const results = await pg.getJobResults(registration.id);
  return results.find(r => r.job_name === 'process_item_job' && r.result?.ark === ark) || null;
}

/**
 * Wait for one item to go all the way through: bronze by-ref and tree,
 * a successful item job, a gold record, and an ES doc.
 *
 * @param {Object} item - {ref, ark, title}.
 * @param {Object} [opts={}] - Options.
 * @param {Date} [opts.after] - The item job result must be newer than this (re-processing).
 * @param {boolean} [opts.requireJob=true] - Wait for a process_item_job result; false for
 *   metadata-only changes, which may be reindexed by gold_dcs_apply_cask_changes instead.
 * @returns {Promise<Object>} The ES doc.
 */
async function waitForItemPublished(item, opts = {}) {
  const p = itemPaths(item);
  const failFast = failFastFrom();
  const name = item.title;

  await stage(`${name}: bronze by-ref`, () => cask.exists(`${p.byRef}/entity.json`), { failFast });
  await stage(`${name}: bronze tree entry`, () => cask.exists(`${p.tree}/metadata.json`), { failFast });
  if (opts.requireJob !== false) {
    await stage(`${name}: item job succeeded`, async () => {
      const r = await itemResult(item.ark);
      if (!r || r.status !== 'success') return false;
      return !opts.after || new Date(r.updated_at) > opts.after ? r : false;
    }, { failFast, timeout: config.timing.process });
  }
  await stage(`${name}: gold record`, () => cask.exists(p.goldRecord), { failFast, timeout: config.timing.process });
  return stage(`${name}: indexed in ES`, () => esItem(item.ark), { failFast });
}

/**
 * Wait for the collection doc to report an item count.
 *
 * @param {number} count - Expected count.
 * @returns {Promise<Object>} The collection doc.
 */
async function waitForItemCount(count) {
  // the count is refreshed by the rollup and by dc-showcase's 5-minute cron
  return stage(`collection itemCount = ${count}`, async () => {
    const doc = await esCollection();
    return itemCountOf(doc) === count ? doc : false;
  }, { failFast: failFastFrom(), timeout: config.timing.process });
}

/**
 * File paths (and hashes) under a CaskFS folder, relative to it.
 *
 * @param {string} dir - CaskFS folder.
 * @returns {Promise<Object>} {relPath: hash}.
 */
async function hashes(dir) {
  const out = {};
  for (const f of await cask.walk(dir)) out[f.path.slice(dir.length + 1)] = f.hash;
  return out;
}

export { esItem, esCollection, itemCountOf, itemResult, waitForItemPublished, waitForItemCount, hashes, roots, itemPaths };
