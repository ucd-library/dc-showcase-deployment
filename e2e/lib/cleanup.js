/**
 * Remove everything one e2e run created: its Preservica folders, its
 * registry rows, its bronze/silver/gold CaskFS folders and its ES docs.
 *
 * Order matters: the Preservica folder goes first, then the registry rows
 * are disabled, so the auto-sync sensor neither re-registers nor re-syncs
 * the collection while its CaskFS folders and ES docs are removed.
 *
 * @module cleanup
 */
import config from '../config.js';
import * as cask from './cask.js';
import * as es from './es.js';
import * as pg from './pg.js';
import { PreservicaWriter } from '@ucd-lib/argonath/lib/preservica.js';

/**
 * Clean up one run.
 *
 * @param {string} runId - Run id (e.g. 'e2e-20261118-0742-a1b2').
 * @param {Object} [opts={}] - Options.
 * @param {string[]} [opts.folderRefs=[]] - Preservica folder refs; when empty they are
 *   looked up by title under the e2e parent folder.
 * @param {Function} [opts.log=console.log] - Logger.
 * @returns {Promise<Object>} What was removed, plus any errors (cleanup never throws).
 */
async function cleanupRun(runId, opts = {}) {
  const log = opts.log || console.log;
  const report = { runId, preservica: [], registry: [], cask: [], es: {}, errors: [] };
  const attempt = async (what, fn) => {
    try {
      await fn();
    } catch (e) {
      report.errors.push(`${what}: ${e.message}`);
      log(`  cleanup ${what} failed: ${e.message}`);
    }
  };

  // 1. Preservica folders (title starts with the run id)
  if (config.preservica.parentRef && config.preservica.username) {
    const writer = new PreservicaWriter(config.preservica);
    await attempt('preservica', async () => {
      let refs = opts.folderRefs || [];
      if (!refs.length) {
        refs = (await writer.getChildren(config.preservica.parentRef))
          .filter(c => c.type === 'SO' && c.title?.startsWith(runId)).map(c => c.ref);
      }
      for (const ref of refs) {
        if (!await writer.exists('SO', ref)) continue;
        await writer.deleteEntity('SO', ref, { comment: `argonath e2e cleanup ${runId}`, interval: 5000 });
        report.preservica.push(ref);
      }
    });
  }

  // 2. registry rows -> disabled, queue cleared
  await attempt('registry', async () => {
    const rows = await pg.query(
      "SELECT id, name FROM collection_registry.collection WHERE slug LIKE $1 || '%'", [runId]);
    for (const row of rows) {
      await pg.query(
        `DELETE FROM collection_registry.job_queue WHERE collection_id = $1
           OR item_id IN (SELECT item_id FROM collection_registry.collection_item WHERE collection_id = $1)`,
        [row.id]);
      await pg.query(
        "UPDATE collection_registry.collection SET status = 'disabled', last_updated_at = now() WHERE id = $1",
        [row.id]);
      report.registry.push(row.name);
    }

    // 3. cask folders for every collection of this run
    for (const row of rows) {
      const [, group, slug] = row.name.split('/');
      for (const dir of [
        `/bronze/${group}/${slug}`,
        `/silver/${group}/${slug}`,
        `/gold/${config.goldProject}/collections/${slug}`,
      ]) {
        await attempt(`cask ${dir}`, async () => {
          if (await cask.deleteDir(dir)) report.cask.push(dir);
        });
      }
    }
  });

  // 4. ES docs, and the dcf_edits visibility row
  for (const index of [config.es.itemIndex, config.es.collectionIndex, config.es.pageSearchIndex]) {
    await attempt(`es ${index}`, async () => {
      report.es[index] = await es.deleteByPhrase(index, runId);
    });
  }
  await attempt('dcf_edits', async () => {
    await pg.query(
      "DELETE FROM dcf_edits.collection_edit WHERE collection_id LIKE '%' || $1 || '%'",
      [runId], { database: config.pg.dcfDatabase });
  });

  return report;
}

/**
 * Run ids of earlier e2e runs still registered (active), for sweeping.
 *
 * @param {Object} [opts={}] - Options.
 * @param {number} [opts.olderThanHours=24] - Only runs registered at least this long ago.
 * @returns {Promise<string[]>} Run ids.
 */
async function staleRunIds(opts = {}) {
  const hours = opts.olderThanHours ?? 24;
  const rows = await pg.query(
    `SELECT slug FROM collection_registry.collection
     WHERE slug LIKE 'e2e-%' AND status = 'active' AND created_at < now() - ($1 || ' hours')::interval`,
    [String(hours)]);
  const ids = rows.map(r => r.slug.match(/^(e2e-\d{8}-\d{4}-[0-9a-f]{4})/)?.[1]).filter(Boolean);
  return [...new Set(ids)];
}

export { cleanupRun, staleRunIds };
