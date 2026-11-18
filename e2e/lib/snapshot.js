/**
 * Snapshot comparison for wide state (cask trees, registry rows, ES docs).
 * Values that change every run (run id, refs, ARKs, hashes, timestamps,
 * uuids) are replaced with stable placeholders before comparing against
 * specs/__snapshots__/<name>.json.
 *
 * Set E2E_UPDATE_SNAPSHOTS=true to (re)write snapshots instead of comparing.
 * A missing snapshot is written on first run and reported, not failed.
 *
 * @module snapshot
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ctx from './run-context.js';

const SNAPSHOT_DIR = new URL('../specs/__snapshots__/', import.meta.url).pathname;

const PATTERNS = [
  [/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?\b/g, '<timestamp>'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
  [/\b[0-9a-f]{40,64}\b/gi, '<hash>'],
];

/**
 * Replace run-specific values in a string.
 *
 * @param {string} value - Input.
 * @returns {string} Normalized string.
 */
function normalizeString(value) {
  let out = value.split(ctx.runId).join('<runId>');
  for (const [name, item] of Object.entries(ctx.items)) {
    if (item.ref) out = out.split(item.ref).join(`<ref:${name}>`);
  }
  if (ctx.folderRef) out = out.split(ctx.folderRef).join('<ref:folder>');
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Deep-normalize a value: strings as above, numbers that look like
 * sizes/ids/epochs kept only when `opts.keepNumbers` is set.
 *
 * @param {*} value - Input.
 * @param {Object} [opts={}] - Options.
 * @param {string[]} [opts.dropKeys=[]] - Object keys to drop entirely.
 * @returns {*} Normalized copy.
 */
function normalize(value, opts = {}) {
  const drop = new Set(opts.dropKeys || []);
  if (typeof value === 'string') return normalizeString(value);
  if (Array.isArray(value)) return value.map(v => normalize(v, opts));
  if (value && typeof value === 'object') {
    if (value instanceof Date) return '<timestamp>';
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (!drop.has(key)) out[normalizeString(key)] = normalize(value[key], opts);
    }
    return out;
  }
  return value;
}

/**
 * Compare a value against its stored snapshot.
 *
 * @param {string} name - Snapshot name, e.g. '01-cask-bronze'.
 * @param {*} value - Value to compare (normalized here).
 * @param {Object} [opts={}] - normalize() options.
 * @returns {void}
 * @throws {AssertionError} On a mismatch.
 */
function matchSnapshot(name, value, opts = {}) {
  const normalized = normalize(value, opts);
  const file = path.join(SNAPSHOT_DIR, `${name}.json`);
  const update = process.env.E2E_UPDATE_SNAPSHOTS === 'true';
  if (update || !fs.existsSync(file)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`);
    console.log(`      snapshot ${update ? 'updated' : 'written'}: ${name}`);
    return;
  }
  const expected = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(normalized, expected, `snapshot ${name} differs (E2E_UPDATE_SNAPSHOTS=true to accept)`);
}

export { normalize, matchSnapshot };
