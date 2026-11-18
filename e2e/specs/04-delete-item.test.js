/**
 * Deleting an item in Preservica: its tree entry, silver/gold folders and
 * ES docs are removed; its bronze by-ref copy is kept by design.
 */
import assert from 'node:assert/strict';
import ctx from '../lib/run-context.js';
import * as cask from '../lib/cask.js';
import * as es from '../lib/es.js';
import * as pg from '../lib/pg.js';
import * as preservica from '../lib/preservica.js';
import { esItem, itemPaths, waitForItemCount } from '../lib/checks.js';
import { failFastFrom, waitForQuiet } from '../lib/pipeline.js';
import { matchSnapshot } from '../lib/snapshot.js';
import { stage } from '../lib/wait.js';

describe('04 delete an item', function() {
  let item;
  let p;

  before(async function() {
    item = ctx.items.two;
    p = itemPaths(item);
    await preservica.deleteEntity('IO', item.ref);
  });

  it('removes the item from the tree, gold and Elasticsearch', async function() {
    const failFast = failFastFrom();
    await stage('tree entry removed', async () => !await cask.exists(p.tree), { failFast });
    await stage('ES item doc removed', async () => !await esItem(item.ark), { failFast });
    await stage('gold folder removed', async () => !await cask.exists(p.gold), { failFast });
    await waitForItemCount(1);
    await waitForQuiet();
  });

  it('removes silver and page docs but keeps bronze by-ref', async function() {
    assert.equal(await cask.exists(p.silver), false, 'silver folder removed');
    assert.ok(await cask.exists(`${p.byRef}/entity.json`), 'by-ref kept (never-delete bronze)');
    const pages = await es.findPages(ctx.runId);
    assert.equal(pages.filter(d => JSON.stringify(d).includes(item.ark)).length, 0, 'no page-search docs');
  });

  it('leaves the remaining item published', async function() {
    assert.ok(await esItem(ctx.items.one.ark), 'item one still indexed');
    assert.ok(await cask.exists(itemPaths(ctx.items.one).goldRecord));
  });

  it('records the registry state after the delete', async function() {
    const registration = await pg.getCollection(ctx.collectionKey);
    const items = await pg.getItems(registration.id);
    const results = await pg.getJobResults(registration.id);
    assert.deepEqual(results.filter(pg.isFailedResult), []);
    // the expected item/result rows after a delete are pinned by this snapshot
    matchSnapshot('04-registry', {
      items: items.map(i => ({ name: i.name, identifiers: i.identifiers })),
      jobResults: results.map(r => ({ job: r.job_name, item: r.item_name, failed: pg.isFailedResult(r) })),
    });
  });
});
