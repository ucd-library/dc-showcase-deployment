/**
 * Public/private switching, a dc-showcase application control: the app saves
 * dcf_edits.collection_edit.visibility and rewrites roles on the collection,
 * item and page docs. Checks the roles flip and the public API follows.
 *
 * New items take the collection's current dcf_edits state when argonath
 * indexes them: with no row they are private (01/02); here an item imported
 * while the row says public is indexed public, and one imported after it is
 * switched back to private is indexed private.
 *
 * Goes through the admin API when E2E_DCS_ADMIN_TOKEN or E2E_OIDC_* is set,
 * else through bin/set-visibility.js in the client container (same code path).
 */
import assert from 'node:assert/strict';
import ctx from '../lib/run-context.js';
import * as dcs from '../lib/dcs.js';
import * as pg from '../lib/pg.js';
import * as preservica from '../lib/preservica.js';
import { esCollection, esItem, waitForItemPublished } from '../lib/checks.js';
import { failFastFrom, waitForQuiet } from '../lib/pipeline.js';
import { stage } from '../lib/wait.js';

const PUBLIC = ['admin', 'public'];
const PRIVATE = ['admin'];

/**
 * Wait until the collection doc and the given item docs have these roles.
 *
 * @param {string[]} roles - Expected roles, sorted.
 * @param {string[]} arks - Item ARKs.
 * @returns {Promise<void>}
 */
async function waitForRoles(roles, arks) {
  await stage(`roles = ${roles.join(',')}`, async () => {
    const docs = [await esCollection(), ...await Promise.all(arks.map(esItem))];
    return docs.every(d => d && JSON.stringify([...d.roles].sort()) === JSON.stringify(roles));
  }, { failFast: failFastFrom() });
}

describe('05 public/private visibility', function() {

  it('makes the collection and its items public', async function() {
    const { via } = await dcs.setVisibility(ctx.esCollectionId, 'public');
    console.log(`      visibility set via ${via}`);
    assert.equal((await pg.getCollectionEdit(ctx.esCollectionId))?.visibility, 'public');
    await waitForRoles(PUBLIC, [ctx.items.one.ark]);
    assert.ok(await dcs.getPublic('item', ctx.items.one.esId), 'public API returns the item');
  });

  it('indexes an item added to a public collection as public', async function() {
    const item = await preservica.ingestItem('three', { folderRef: ctx.folderRef, image: 'tiny-2.jpg' });
    const doc = await waitForItemPublished(item);
    assert.equal((await pg.getCollectionEdit(ctx.esCollectionId))?.visibility, 'public');
    assert.deepEqual([...doc.roles].sort(), PUBLIC);
    ctx.setItem('three', { esId: doc['@id'] });
    await waitForQuiet();
  });

  it('makes the collection private again', async function() {
    await dcs.setVisibility(ctx.esCollectionId, 'private');
    assert.equal((await pg.getCollectionEdit(ctx.esCollectionId))?.visibility, 'private');
    await waitForRoles(PRIVATE, [ctx.items.one.ark, ctx.items.three.ark]);
    assert.equal(await dcs.getPublic('item', ctx.items.one.esId), null, 'public API hides the item');
  });

  it('indexes an item added after switching back to private as private', async function() {
    // a dcf_edits row now exists and says private: new items must follow it
    const item = await preservica.ingestItem('four', { folderRef: ctx.folderRef, image: 'tiny-1.jpg' });
    const doc = await waitForItemPublished(item);
    assert.equal((await pg.getCollectionEdit(ctx.esCollectionId))?.visibility, 'private');
    assert.deepEqual([...doc.roles].sort(), PRIVATE);
    assert.equal(await dcs.getPublic('item', doc['@id']), null, 'public API hides the new item');
    await waitForQuiet();
  });
});
