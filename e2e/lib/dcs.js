/**
 * dc-showcase calls: anonymous reads (what the public sees) and the
 * collection visibility switch.
 *
 * Visibility is a dc-showcase application control: the app saves
 * dcf_edits.collection_edit.visibility (argonath reads it when indexing later
 * imports) and rewrites roles on the collection's ES docs. With admin auth
 * configured this goes through the admin API; otherwise it runs the same code
 * path via bin/set-visibility.js inside the client container.
 *
 * @module dcs
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import config from '../config.js';

const run = promisify(execFile);

/**
 * The path part of an ES @id, which may be a full URI
 * (https://digital.ucdavis.edu/collection/ark:/...) or already a path.
 *
 * @param {string} id - @id.
 * @returns {string} e.g. '/collection/ark:/...'.
 */
function idPath(id) {
  return /^https?:\/\//.test(id) ? id.replace(/^https?:\/\/[^/]+/, '') : (id.startsWith('/') ? id : `/${id}`);
}

let cachedToken = null;

/**
 * A Keycloak token with dc-showcase's admin/ui-admin role: E2E_DCS_ADMIN_TOKEN
 * if set, else a client-credentials grant for a service-account client.
 *
 * @returns {Promise<string|null>} Bearer token, or null if none is configured.
 */
async function adminToken() {
  if (config.dcs.adminToken) return config.dcs.adminToken;
  if (!config.dcs.oidcTokenUrl || !config.dcs.oidcClientId || !config.dcs.oidcClientSecret) return null;
  if (cachedToken && cachedToken.expires > Date.now() + 30000) return cachedToken.token;

  const res = await fetch(config.dcs.oidcTokenUrl, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.dcs.oidcClientId,
      client_secret: config.dcs.oidcClientSecret,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`OIDC token request failed: HTTP ${res.status}`);
  cachedToken = { token: data.access_token, expires: Date.now() + (data.expires_in || 60) * 1000 };
  return cachedToken.token;
}

/**
 * Whether admin calls can be made (a token or client credentials are configured).
 *
 * @returns {boolean} True if configured.
 */
function hasAdminAuth() {
  return Boolean(config.dcs.adminToken || (config.dcs.oidcTokenUrl && config.dcs.oidcClientId && config.dcs.oidcClientSecret));
}

/**
 * Set a collection's visibility: through the admin API when admin auth is
 * configured, else with bin/set-visibility.js in the client container.
 *
 * @param {string} collectionId - The collection's ES @id (URI or path).
 * @param {string} visibility - 'public' or 'private'.
 * @returns {Promise<Object>} {via: 'api'|'cli', saved}.
 * @throws {Error} On a failed call.
 */
async function setVisibility(collectionId, visibility) {
  if (hasAdminAuth()) return { via: 'api', saved: await setVisibilityApi(collectionId, visibility) };
  const { stdout } = await run('docker', [
    'compose', '-p', config.compose.dcsProject, 'exec', '-T', 'client',
    'node', 'bin/set-visibility.js', idPath(collectionId), visibility, '--user', 'e2e',
  ]);
  const last = stdout.trim().split('\n').filter(line => line.startsWith('{"previous"')).pop();
  if (!last) throw new Error(`set-visibility printed no result: ${stdout.slice(-500)}`);
  return { via: 'cli', saved: JSON.parse(last).saved };
}

/**
 * Set a collection's visibility through the admin API.
 *
 * @param {string} collectionId - The collection's ES @id (URI or path).
 * @param {string} visibility - 'public' or 'private'.
 * @returns {Promise<Object>} The saved edit row.
 * @throws {Error} On a missing token or non-2xx response.
 */
async function setVisibilityApi(collectionId, visibility) {
  const token = await adminToken();
  if (!token) throw new Error('No dc-showcase admin auth configured (E2E_DCS_ADMIN_TOKEN or E2E_OIDC_*)');
  const path = idPath(collectionId);
  const res = await fetch(`${config.dcs.url}/api/app-config${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ visibility }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`visibility PUT ${path}: HTTP ${res.status} ${data.message || ''}`);
  return data;
}

/**
 * Fetch a document anonymously, the way the public site does.
 *
 * @param {string} model - 'item' or 'collection'.
 * @param {string} id - The doc's @id, e.g. '/item/ark:/99999/...'.
 * @returns {Promise<Object|null>} The document, or null if hidden or missing.
 */
async function getPublic(model, id) {
  const path = idPath(id);
  const rest = path.startsWith(`/${model}/`) ? path.slice(model.length + 1) : path;
  const res = await fetch(`${config.dcs.url}/api/${model}${rest}`);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data || data.error || !data['@id']) return null;
  return data;
}

export { adminToken, hasAdminAuth, setVisibility, setVisibilityApi, getPublic, idPath };
