/**
 * Updating an item: a new title (entity + oai_dc), plus a replaced image
 * where the tenancy allows content replacement (Starter does not). The item
 * is re-processed (new gold record and ES title, new derivatives when the
 * image changed), and the other item is left alone.
 */
import assert from 'node:assert/strict';
import ctx from '../lib/run-context.js';
import * as cask from '../lib/cask.js';
import * as es from '../lib/es.js';
import * as preservica from '../lib/preservica.js';
import { esItem, hashes, itemPaths, waitForItemPublished } from '../lib/checks.js';
import { failFastFrom, waitForQuiet } from '../lib/pipeline.js';
import { stage } from '../lib/wait.js';

describe('03 update an item', function() {
  let before_;
  let updated;
  let changedAt;
  let imageReplaced;

  before(async function() {
    const one = ctx.items.one;
    before_ = {
      media: await hashes(`${itemPaths(one).byRef}/media`),
      silver: await hashes(itemPaths(one).silver),
      goldTwo: await hashes(itemPaths(ctx.items.two).gold),
    };
    changedAt = new Date();
    const title = preservica.itemTitle('one', ' updated');
    await preservica.retitleItem(one.ref, title);
    imageReplaced = await preservica.replaceItemImage(one.ref, 'tiny-1-v2.jpg');
    if (!imageReplaced) console.log('      image replacement unavailable in this tenancy: metadata-only update');
    updated = ctx.setItem('one', { title, previousTitle: one.title });
  });

  it('re-processes the item with its new title', async function() {
    await waitForItemPublished(updated, { after: changedAt, requireJob: imageReplaced });
    await stage('ES title updated', async () => {
      const doc = await esItem(updated.ark);
      return es.titleOf(doc) === updated.title ? doc : false;
    }, { failFast: failFastFrom() });
    await waitForQuiet();
  });

  it('moves the tree entry and gold record to the new title', async function() {
    const now = itemPaths(updated);
    const old = itemPaths({ ...updated, title: updated.previousTitle });
    assert.ok(await cask.exists(`${now.tree}/metadata.json`), 'new tree entry');
    assert.equal(await cask.exists(old.tree), false, 'old tree entry gone');
    assert.ok(await cask.exists(now.goldRecord), 'gold record at the new path');
  });

  it('downloads the replaced image and builds new derivatives', async function() {
    if (!imageReplaced) this.skip();
    const media = await hashes(`${itemPaths(updated).byRef}/media`);
    assert.notDeepEqual(media, before_.media, 'bronze media changed');
    const silverHashes = new Set(Object.values(await hashes(itemPaths(updated).silver)));
    const oldHashes = new Set(Object.values(before_.silver));
    assert.ok([...silverHashes].some(h => !oldHashes.has(h)), 'at least one new silver derivative');
  });

  it('leaves the other item untouched', async function() {
    assert.deepEqual(await hashes(itemPaths(ctx.items.two).gold), before_.goldTwo);
  });
});
