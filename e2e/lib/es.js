/**
 * Elasticsearch probes. Every e2e title contains the run id, so documents
 * are found by phrase-searching for it instead of guessing @id formats.
 *
 * @module es
 */
import config from '../config.js';

/**
 * Send a request to Elasticsearch.
 *
 * @param {string} method - HTTP method.
 * @param {string} path - Path, e.g. '/item-read/_search'.
 * @param {Object} [body] - JSON body.
 * @returns {Promise<Object>} Parsed response.
 */
async function request(method, path, body) {
  const res = await fetch(`${config.es.url}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 404) {
    throw new Error(`ES ${method} ${path}: HTTP ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

/**
 * Find documents whose text contains a phrase.
 *
 * @param {string} index - Index or alias.
 * @param {string} phrase - Phrase to match, e.g. the run id.
 * @param {Object} [opts={}] - Options.
 * @param {number} [opts.size=50] - Max hits.
 * @returns {Promise<Array<Object>>} Hits' _source, each with `_id` added.
 */
async function findByPhrase(index, phrase, opts = {}) {
  // refresh so a just-written doc is searchable
  await request('POST', `/${index}/_refresh`);
  const data = await request('POST', `/${index}/_search`, {
    size: opts.size || 50,
    query: { multi_match: { query: phrase, type: 'phrase', fields: ['*'], lenient: true } },
  });
  return (data.hits?.hits || []).map(h => ({ _id: h._id, ...h._source }));
}

/**
 * Find item documents for this run.
 *
 * @param {string} runId - Run id.
 * @returns {Promise<Array<Object>>} Item docs.
 */
function findItems(runId) {
  return findByPhrase(config.es.itemIndex, runId);
}

/**
 * Find this run's collection document.
 *
 * @param {string} runId - Run id.
 * @returns {Promise<Object|null>} Collection doc, or null.
 */
async function findCollection(runId) {
  const hits = await findByPhrase(config.es.collectionIndex, runId);
  return hits[0] || null;
}

/**
 * Find page-search documents for this run.
 *
 * @param {string} runId - Run id.
 * @returns {Promise<Array<Object>>} Page docs.
 */
function findPages(runId) {
  return findByPhrase(config.es.pageSearchIndex, runId);
}

/**
 * The first graph node's title, for an item document.
 *
 * @param {Object} doc - Item doc.
 * @returns {string|undefined} Title.
 */
function titleOf(doc) {
  const graph = doc['@graph'] || [];
  const root = graph.find(n => n['@id'] === doc['@id']) || graph[0] || doc;
  return root.name || root.title || doc.name;
}

/**
 * Delete every document matching the run id from one index (cleanup only).
 *
 * @param {string} index - Index or alias.
 * @param {string} runId - Run id.
 * @returns {Promise<number>} Documents deleted.
 */
async function deleteByPhrase(index, runId) {
  const data = await request('POST', `/${index}/_delete_by_query?refresh=true&conflicts=proceed`, {
    query: { multi_match: { query: runId, type: 'phrase', fields: ['*'], lenient: true } },
  });
  return data.deleted || 0;
}

export { request, findByPhrase, findItems, findCollection, findPages, titleOf, deleteByPhrase };
