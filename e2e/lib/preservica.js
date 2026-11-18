/**
 * The Preservica changes the specs make, on top of the shared
 * PreservicaWriter (@ucd-lib/argonath/lib/preservica.js). Everything is
 * created under E2E_PRESERVICA_PARENT_REF and named with the run id.
 *
 * @module preservica
 */
import fs from 'node:fs';
import { PreservicaWriter, oaiDc } from '@ucd-lib/argonath/lib/preservica.js';
import config from '../config.js';
import ctx from './run-context.js';

const FIXTURES = new URL('../fixtures/', import.meta.url).pathname;

let writer = null;

/**
 * The shared writer, built from config on first use.
 *
 * @returns {PreservicaWriter} Writer.
 * @throws {Error} If the e2e parent folder isn't configured.
 */
function client() {
  if (!config.preservica.parentRef) {
    throw new Error('E2E_PRESERVICA_PARENT_REF is not set: the Preservica folder e2e runs are created under');
  }
  if (!writer) writer = new PreservicaWriter(config.preservica);
  return writer;
}

/**
 * Read a fixture file.
 *
 * @param {string} name - File name in fixtures/.
 * @returns {Buffer} Bytes.
 */
function fixture(name) {
  return fs.readFileSync(`${FIXTURES}${name}`);
}

/**
 * Create a collection folder under the e2e parent, tag it, and give it a
 * test ARK (building the gold collection record requires one).
 *
 * @param {string} title - Folder title (becomes the collection name).
 * @param {string} tags - 'argonath' identifier value, e.g. 'e2e-testing'.
 * @returns {Promise<string>} Folder ref.
 */
async function createCollectionFolder(title, tags) {
  const ref = await client().createFolder(title, {
    parent: config.preservica.parentRef,
    description: `argonath e2e run ${ctx.runId}`,
  });
  await client().addIdentifier('SO', ref, 'ark', `ark:/99999/fk4${title}`);
  await client().addIdentifier('SO', ref, 'argonath', tags);
  return ref;
}

/**
 * The title an item gets: it contains the run id so ES search finds it.
 *
 * @param {string} name - Item name, e.g. 'one'.
 * @param {string} [suffix=''] - Extra text, e.g. ' (updated)'.
 * @returns {string} Title.
 */
function itemTitle(name, suffix = '') {
  return `${ctx.runId} item ${name}${suffix}`;
}

/**
 * Ingest one single-image item into a folder and wait until Preservica has it.
 *
 * @param {string} name - Item name, e.g. 'one'.
 * @param {Object} opts - Options.
 * @param {string} opts.folderRef - Folder to ingest into.
 * @param {string} opts.image - Fixture file name.
 * @param {boolean} [opts.track=true] - Record it in the run context.
 * @returns {Promise<Object>} {ref, ark, title}.
 */
async function ingestItem(name, opts) {
  const ark = ctx.ark(name);
  const title = itemTitle(name);
  await client().ingestAsset({
    parent: opts.folderRef,
    title,
    description: `e2e item ${name}`,
    files: [{ filename: opts.image, data: fixture(opts.image) }],
    identifiers: [{ type: 'ark', value: ark }],
    dc: { title, description: `e2e item ${name}`, identifier: ark },
  });
  const found = await client().waitForIdentifier('ark', ark, {
    timeout: config.timing.ingest, interval: config.timing.interval,
  });
  const item = { ref: found.ref, ark, title, image: opts.image };
  if (opts.track !== false) ctx.setItem(name, item);
  return item;
}

/**
 * Change an item's title, both on the entity and in its oai_dc metadata.
 *
 * @param {string} ref - Item ref.
 * @param {string} title - New title.
 * @returns {Promise<void>}
 */
async function retitleItem(ref, title) {
  await client().updateEntity('IO', ref, { title });
  await client().setMetadata('IO', ref, oaiDc({ title }));
}

/**
 * Replace an item's (single) image with another fixture. Some tenancies
 * (e.g. Starter) don't offer content replacement and answer 403
 * 'unavailable.feature'; that returns false instead of throwing.
 *
 * @param {string} ref - Item ref.
 * @param {string} image - Fixture file name.
 * @returns {Promise<boolean>} True if replaced, false if the tenancy doesn't allow it.
 */
async function replaceItemImage(ref, image) {
  const [coRef] = await client().contentObjects(ref);
  if (!coRef) throw new Error(`No content object found for item ${ref}`);
  try {
    await client().replaceContent(coRef, { filename: image, data: fixture(image) }, {
      timeout: config.timing.ingest, interval: config.timing.interval,
    });
    return true;
  } catch (e) {
    if (/unavailable\.feature/.test(e.message)) return false;
    throw e;
  }
}

/**
 * Delete an entity (needs the manager login to approve).
 *
 * @param {string} type - 'IO' or 'SO'.
 * @param {string} ref - Entity ref.
 * @returns {Promise<void>}
 */
async function deleteEntity(type, ref) {
  await client().deleteEntity(type, ref, {
    comment: `argonath e2e ${ctx.runId}`, timeout: config.timing.ingest, interval: 5000,
  });
}

export { client, createCollectionFolder, itemTitle, ingestItem, retitleItem, replaceItemImage, deleteEntity };
