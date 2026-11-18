/**
 * A brand-new collection: one folder tagged argonath=e2e-testing
 * with one single-image item, picked up with no manual step (auto-discovery
 * -> bronze -> silver/gold -> ES). A control folder tagged only for
 * discovery must reach bronze and stop there.
 */
import assert from 'node:assert/strict';
import config from '../config.js';
import ctx from '../lib/run-context.js';
import * as cask from '../lib/cask.js';
import * as dcs from '../lib/dcs.js';
import * as es from '../lib/es.js';
import * as pg from '../lib/pg.js';
import * as preservica from '../lib/preservica.js';
import { esCollection, esItem, itemPaths, roots, waitForItemCount, waitForItemPublished } from '../lib/checks.js';
import { failFastFrom, waitForQuiet } from '../lib/pipeline.js';
import { matchSnapshot } from '../lib/snapshot.js';
import { stage } from '../lib/wait.js';

const CONTROL_TAG = 'e2e-testing-bronze';

describe('01 new collection, one item', function() {
  let item;
  let control;

  before(async function() {
    const folderRef = await preservica.createCollectionFolder(ctx.runId, config.publishTag);
    const controlTitle = `${ctx.runId}-bronze-only`;
    const controlFolderRef = await preservica.createCollectionFolder(controlTitle, CONTROL_TAG);
    ctx.set({ folderRef, controlFolderRef, controlCollection: controlTitle });

    [item, control] = await Promise.all([
      preservica.ingestItem('one', { folderRef, image: 'tiny-1.jpg' }),
      preservica.ingestItem('control', { folderRef: controlFolderRef, image: 'tiny-2.jpg', track: false }),
    ]);
  });

  it('auto-registers the collection with its tags', async function() {
    const registration = await stage('collection registered', async () => {
      const row = await pg.getCollection(ctx.collectionKey);
      return row?.status === 'active' ? row : false;
    }, { failFast: failFastFrom() });

    assert.equal(registration.source_type, 'preservica');
    assert.ok(registration.workflow_tags.includes(config.publishTag), `tags: ${registration.workflow_tags}`);
    const identifiers = await pg.getCollectionIdentifiers(registration.id);
    assert.deepEqual(
      identifiers.filter(i => ['preservica_ref', 'argonath'].includes(i.id_type)),
      [{ id_type: 'argonath', id_value: config.publishTag }, { id_type: 'preservica_ref', id_value: ctx.folderRef }],
    );
  });

  it('writes the bronze collection manifest with itemsRoot=tree', async function() {
    const manifest = await stage('collection manifest', () => cask.readJson(`${roots().bronze}/manifest.json`));
    assert.equal(manifest.itemsRoot, 'tree');
    assert.equal(manifest.preservicaRootRef, ctx.folderRef);
  });

  it('processes the item through to gold and Elasticsearch', async function() {
    await waitForItemPublished(item);
    await waitForItemCount(1);
    await waitForQuiet();
  });

  it('leaves the expected Postgres state', async function() {
    const registration = await pg.getCollection(ctx.collectionKey);
    const items = await pg.getItems(registration.id);
    assert.equal(items.length, 1, `items: ${JSON.stringify(items)}`);
    assert.equal(await pg.getQueueCount(registration.id), 0);

    const results = await pg.getJobResults(registration.id);
    const failed = results.filter(pg.isFailedResult);
    assert.deepEqual(failed, [], 'every job result succeeded');
    assert.ok(results.some(r => r.job_name === 'process_item_job'), 'item job result recorded');
    assert.ok(results.some(r => r.job_name === 'collection_rollup_job'), 'rollup result recorded');

    assert.deepEqual(await pg.getFailedCommands(ctx.collection, ctx.startedAt), []);
    assert.ok((await pg.getAuditEvents(`${roots().bronze}/`)).length > 0, 'CaskFS audit events under bronze');

    matchSnapshot('01-registry', {
      registration: { source_type: registration.source_type, status: registration.status, workflow_tags: registration.workflow_tags },
      items: items.map(i => ({ name: i.name, identifiers: i.identifiers })),
      jobResults: results.map(r => ({ job: r.job_name, item: r.item_name, failed: pg.isFailedResult(r) })),
    });
  });

  it('creates the expected CaskFS files', async function() {
    const r = roots();
    const p = itemPaths(item);
    for (const file of [`${p.byRef}/entity.json`, `${p.byRef}/identifiers.json`, `${p.tree}/metadata.json`, p.goldRecord]) {
      assert.ok(await cask.exists(file), `missing ${file}`);
    }
    const silver = await cask.walk(r.silver);
    assert.ok(silver.length > 0, `no silver derivatives under ${r.silver}`);
    const gold = await cask.walk(r.gold);
    assert.ok(gold.some(f => f.path.startsWith(`${p.gold}/`) && /\.(jpe?g|png|webp|tiff?)$/i.test(f.path)),
      'a promoted image under the gold item folder');

    // paths only: hashes and sizes are covered by the 02/03 change checks
    const listing = async dir => (await cask.walk(dir)).map(f => f.path);
    matchSnapshot('01-cask', { bronze: await listing(r.bronze), silver: await listing(r.silver), gold: await listing(r.gold) });
  });

  it('indexes the item and collection as private by default (no dcf_edits row)', async function() {
    const collection = await esCollection();
    assert.ok(collection, 'collection doc indexed');
    // the default case: dc-showcase has no visibility row for a new collection
    assert.equal(await pg.getCollectionEdit(collection['@id']), null, 'no dcf_edits.collection_edit row yet');

    const doc = await esItem(item.ark);
    assert.equal(es.titleOf(doc), item.title);
    assert.deepEqual([...doc.roles].sort(), ['admin']);

    assert.deepEqual([...collection.roles].sort(), ['admin']);
    ctx.set({ esCollectionId: collection['@id'] });
    ctx.setItem('one', { esId: doc['@id'] });

    assert.equal(await dcs.getPublic('item', doc['@id']), null, 'private item is hidden from the public API');
    matchSnapshot('01-es-item', doc);
  });

  it('keeps the bronze-only control collection out of silver, gold and ES', async function() {
    const controlKey = `bronze/${ctx.group}/${ctx.controlCollection}`;
    const registration = await stage('control registered', async () => {
      const row = await pg.getCollection(controlKey);
      return row?.status === 'active' ? row : false;
    });
    assert.ok(registration.workflow_tags.includes(CONTROL_TAG));
    assert.ok(!registration.workflow_tags.includes(config.publishTag));

    const r = roots(ctx.controlCollection);
    await stage('control in bronze', () => cask.exists(`${r.byRef}/${control.ref}/entity.json`));
    // the published collection has been idle long enough for any control work to have started
    assert.deepEqual(await cask.walk(r.silver), [], 'no silver for the control');
    assert.deepEqual(await cask.walk(r.gold), [], 'no gold for the control');
    assert.equal(await esItem(control.ark), null, 'control item not indexed');
  });
});
