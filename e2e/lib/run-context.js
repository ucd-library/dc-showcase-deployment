/**
 * State shared by every spec in one suite run: the run id, the collection's
 * names and keys, and refs/ARKs captured along the way. Mocha loads all
 * specs into one process, so this module is a shared singleton. It is also
 * written to .artifacts/<runId>/context.json after each change, so a failed
 * run can be inspected and cleaned up later.
 *
 * @module run-context
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import config from '../config.js';

/**
 * Build a new run id, e.g. 'e2e-20261118-0742-a1b2'.
 *
 * @returns {string} Run id.
 */
function newRunId() {
  const iso = new Date().toISOString();
  const stamp = `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 16).replace(':', '')}`;
  return `e2e-${stamp}-${crypto.randomBytes(2).toString('hex')}`;
}

class RunContext {

  constructor() {
    this.runId = process.env.E2E_RUN_ID || newRunId();
    // the folder title is the collection name, slugified
    this.collection = this.runId;
    this.group = config.group;
    this.collectionKey = `bronze/${this.group}/${this.collection}`;
    this.folderRef = null;
    this.items = {};
    this.startedAt = new Date();
  }

  /**
   * This run's artifacts directory, created on first use.
   *
   * @returns {string} Absolute path.
   */
  get artifactsDir() {
    const dir = path.join(config.artifactsDir, this.runId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * A test ARK in the NAAN reserved for testing (99999, 'fk' = fake), unique to this run.
   *
   * @param {string} name - Item name, e.g. 'one'.
   * @returns {string} e.g. 'ark:/99999/fk4e2e20261118-0742-a1b2-one'.
   */
  ark(name) {
    return `ark:/99999/fk4${this.runId}-${name}`;
  }

  /**
   * Record an item and persist the context.
   *
   * @param {string} name - Item name, e.g. 'one'.
   * @param {Object} data - Fields to merge, e.g. {ref, ark, title, slug}.
   * @returns {Object} The item record.
   */
  setItem(name, data) {
    this.items[name] = { ...(this.items[name] || {}), ...data };
    this.save();
    return this.items[name];
  }

  /**
   * Set top-level fields and persist the context.
   *
   * @param {Object} data - Fields to merge.
   */
  set(data) {
    Object.assign(this, data);
    this.save();
  }

  /**
   * Write context.json to the artifacts directory.
   */
  save() {
    const data = {
      runId: this.runId, collection: this.collection, group: this.group,
      collectionKey: this.collectionKey, folderRef: this.folderRef,
      items: this.items, startedAt: this.startedAt,
    };
    fs.writeFileSync(path.join(this.artifactsDir, 'context.json'), JSON.stringify(data, null, 2));
  }
}

const ctx = new RunContext();

export default ctx;
export { newRunId };
