/**
 * CaskFS probes over its HTTP API (/fs for files, /dir for listings).
 *
 * @module cask
 */
import config from '../config.js';

/**
 * Request headers; local-dev cask trusts the x-anduin-user header.
 *
 * @returns {Object} Headers.
 */
function headers() {
  return { 'X-Anduin-User': JSON.stringify({ username: config.cask.trustedUser }) };
}

/**
 * Build an API URL for a CaskFS path.
 *
 * @param {string} kind - 'fs' or 'dir'.
 * @param {string} path - CaskFS-absolute path, e.g. '/bronze/...'.
 * @param {Object} [params={}] - Query params.
 * @returns {string} URL.
 */
function url(kind, path, params = {}) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const query = new URLSearchParams(params).toString();
  return `${config.cask.apiUrl}/${kind}${encoded}${query ? `?${query}` : ''}`;
}

/**
 * Whether a file or directory exists.
 *
 * @param {string} path - CaskFS-absolute path.
 * @returns {Promise<boolean>} True if it exists.
 */
async function exists(path) {
  const res = await fetch(url('fs', path, { metadata: 'true' }), { headers: headers() });
  if (res.status === 404) return false;
  if (res.ok || res.status === 400 || res.status === 409) return true;
  throw new Error(`cask exists ${path}: HTTP ${res.status}`);
}

/**
 * Read a JSON file.
 *
 * @param {string} path - CaskFS-absolute path.
 * @returns {Promise<Object|null>} Parsed JSON, or null if missing.
 */
async function readJson(path) {
  const res = await fetch(url('fs', path), { headers: headers() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`cask read ${path}: HTTP ${res.status}`);
  return res.json();
}

/**
 * List one directory.
 *
 * @param {string} path - CaskFS-absolute directory path.
 * @returns {Promise<Object|null>} {files: [{name, path, size, hash}], dirs: [{name, path}]}, or null if missing.
 */
async function ls(path) {
  const res = await fetch(url('dir', path, { limit: '1000' }), { headers: headers() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`cask ls ${path}: HTTP ${res.status}`);
  const body = await res.json();
  return {
    files: (body.files || []).map(f => ({ name: f.filename, path: f.filepath, size: f.size, hash: f.hash_value })),
    dirs: (body.directories || []).map(d => ({ name: d.name, path: d.fullname })),
  };
}

/**
 * Recursively list every file under a directory.
 *
 * @param {string} path - CaskFS-absolute directory path.
 * @returns {Promise<Array<Object>>} [{path, size, hash}] sorted by path; [] if missing.
 */
async function walk(path) {
  const listing = await ls(path);
  if (!listing) return [];
  const files = listing.files.map(f => ({ path: f.path || `${path}/${f.name}`, size: f.size, hash: f.hash }));
  for (const dir of listing.dirs) {
    files.push(...await walk(dir.path || `${path}/${dir.name}`));
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Delete a directory tree (cleanup only).
 *
 * @param {string} path - CaskFS-absolute directory path.
 * @returns {Promise<boolean>} True if something was deleted.
 */
async function deleteDir(path) {
  const res = await fetch(url('fs', path, { directory: 'true' }), { method: 'DELETE', headers: headers() });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`cask delete ${path}: HTTP ${res.status}`);
  return true;
}

export { exists, readJson, ls, walk, deleteDir };
