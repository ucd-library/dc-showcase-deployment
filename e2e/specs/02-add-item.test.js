/**
 * Adding an item to an existing collection: only the new item is processed,
 * and the first item's gold files are left byte-identical.
 */
import assert from 'node:assert/strict';
import ctx from '../lib/run-context.js';
import * as pg from '../lib/pg.js';
import * as preservica from '../lib/preservica.js';
import { esItem, hashes, itemPaths, waitForItemCount, waitForItemPublished } from '../lib/checks.js';
import { waitForQuiet } from '../lib/pipeline.js';

describe('02 add an item', function() {
  let goldOneBefore;
  let item;

  before(async function() {
    goldOneBefore = await hashes(itemPaths(ctx.items.one).gold);
    item = await preservica.ingestItem('two', { folderRef: ctx.folderRef, image: 'tiny-2.jpg' });
  });

  it('processes the new item through to gold and Elasticsearch', async function() {
    await waitForItemPublished(item);
    await waitForItemCount(2);
    await waitForQuiet();
  });

  it('links the second item in the registry', async function() {
    const registration = await pg.getCollection(ctx.collectionKey);
    const items = await pg.getItems(registration.id);
    assert.equal(items.length, 2, `items: ${JSON.stringify(items.map(i => i.name))}`);
    const results = await pg.getJobResults(registration.id);
    assert.deepEqual(results.filter(pg.isFailedResult), []);
  });

  it('indexes the new item private, like its collection (still no dcf_edits row)', async function() {
    assert.equal(await pg.getCollectionEdit(ctx.esCollectionId), null);
    const doc = await esItem(item.ark);
    assert.deepEqual([...doc.roles].sort(), ['admin']);
    ctx.setItem('two', { esId: doc['@id'] });
  });

  it('leaves the first item untouched', async function() {
    assert.ok(Object.keys(goldOneBefore).length > 0, 'item one had gold files');
    assert.deepEqual(await hashes(itemPaths(ctx.items.one).gold), goldOneBefore);
  });
});
