/**
 * Postgres probes: argonath's collection_registry and reporting schemas, the
 * CaskFS audit log, and dc-showcase's dcf_edits.
 *
 * @module pg
 */
import pg from 'pg';
import config from '../config.js';

const pools = {};

/**
 * A pooled connection to one database.
 *
 * @param {string} [database] - Database name (default the argonath one).
 * @returns {pg.Pool} Pool.
 */
function pool(database = config.pg.database) {
  if (!pools[database]) {
    pools[database] = new pg.Pool({
      host: config.pg.host, port: config.pg.port, user: config.pg.user,
      password: config.pg.password, database, max: 3,
    });
  }
  return pools[database];
}

/**
 * Run a query and return its rows.
 *
 * @param {string} sql - SQL text.
 * @param {Array} [params=[]] - Parameters.
 * @param {Object} [opts={}] - Options.
 * @param {string} [opts.database] - Database (default the argonath one).
 * @returns {Promise<Array<Object>>} Rows.
 */
async function query(sql, params = [], opts = {}) {
  const res = await pool(opts.database).query(sql, params);
  return res.rows;
}

/**
 * A collection's registry row.
 *
 * @param {string} key - e.g. 'bronze/preservica/e2e-...'.
 * @returns {Promise<Object|null>} Row, or null if unregistered.
 */
async function getCollection(key) {
  const rows = await query('SELECT * FROM collection_registry.collection WHERE name = $1', [key]);
  return rows[0] || null;
}

/**
 * A collection's stored identifiers.
 *
 * @param {string} collectionId - Registry id (uuid).
 * @returns {Promise<Array<Object>>} [{id_type, id_value}].
 */
async function getCollectionIdentifiers(collectionId) {
  return query(
    'SELECT id_type, id_value FROM collection_registry.collection_identifiers WHERE collection_id = $1 ORDER BY id_type, id_value',
    [collectionId],
  );
}

/**
 * Items linked to a collection, with their identifiers.
 *
 * @param {string} collectionId - Registry id (uuid).
 * @returns {Promise<Array<Object>>} [{id, name, identifiers: [{id_type, id_value}]}].
 */
async function getItems(collectionId) {
  return query(`
    SELECT i.id, i.name,
      COALESCE(json_agg(json_build_object('id_type', ii.id_type, 'id_value', ii.id_value)
        ORDER BY ii.id_type, ii.id_value) FILTER (WHERE ii.id IS NOT NULL), '[]') AS identifiers
    FROM collection_registry.collection_item ci
    JOIN collection_registry.item i ON i.id = ci.item_id
    LEFT JOIN collection_registry.item_identifiers ii ON ii.item_id = i.id
    WHERE ci.collection_id = $1
    GROUP BY i.id, i.name
    ORDER BY i.name`, [collectionId]);
}

/**
 * Job results for a collection and its items.
 *
 * @param {string} collectionId - Registry id (uuid).
 * @returns {Promise<Array<Object>>} [{job_name, item_name, status, result, updated_at}].
 */
async function getJobResults(collectionId) {
  return query(`
    SELECT jr.job_name, i.name AS item_name, jr.result->>'status' AS status, jr.result, jr.updated_at
    FROM collection_registry.job_result jr
    LEFT JOIN collection_registry.item i ON i.id = jr.item_id
    WHERE jr.collection_id = $1
       OR jr.item_id IN (SELECT item_id FROM collection_registry.collection_item WHERE collection_id = $1)
    ORDER BY jr.job_name, i.name`, [collectionId]);
}

/**
 * Whether a job_result row records a failure. Item results carry
 * {status: 'success'|'failed'}; collection rollup results carry a summary
 * {succeeded, failed, failed_items, ...} instead.
 *
 * @param {Object} row - A getJobResults() row.
 * @returns {boolean} True if it failed.
 */
function isFailedResult(row) {
  if (row.status) return row.status !== 'success';
  return Number(row.result?.failed || 0) > 0;
}

/**
 * Number of queued jobs for a collection or its items.
 *
 * @param {string} collectionId - Registry id (uuid).
 * @returns {Promise<number>} Count.
 */
async function getQueueCount(collectionId) {
  const rows = await query(`
    SELECT count(*)::int AS n FROM collection_registry.job_queue
    WHERE collection_id = $1
       OR item_id IN (SELECT item_id FROM collection_registry.collection_item WHERE collection_id = $1)`,
  [collectionId]);
  return rows[0].n;
}

/**
 * Failed reporting commands that mention the collection, with their errors.
 *
 * @param {string} collection - Collection name (slug).
 * @param {Date} since - Only commands started at or after this time.
 * @returns {Promise<Array<Object>>} [{job_id, stage, item_id, message}].
 */
async function getFailedCommands(collection, since) {
  return query(`
    SELECT c.job_id, c.stage, c.item_id, e.message
    FROM reporting.command c
    LEFT JOIN reporting.error e ON e.command_id = c.id
    WHERE c.status = 'failed' AND c.started_at >= $2
      AND (c.collection LIKE '%' || $1 || '%' OR c.item_id LIKE '%' || $1 || '%')
    ORDER BY c.started_at`, [collection, since]);
}

/**
 * CaskFS audit events under a path prefix.
 *
 * @param {string} prefix - CaskFS path prefix, e.g. '/bronze/preservica/e2e-.../'.
 * @returns {Promise<Array<Object>>} [{audit_log_id, created, operation, resource_path}].
 */
async function getAuditEvents(prefix) {
  return query(
    `SELECT audit_log_id, created, operation, resource_path FROM ${config.pg.caskSchema}.audit_log
     WHERE resource_path LIKE $1 || '%' ORDER BY audit_log_id`,
    [prefix],
  );
}

/**
 * dc-showcase's edit row for a collection (visibility lives here).
 *
 * @param {string} collectionId - The collection's ES @id.
 * @returns {Promise<Object|null>} Row, or null.
 */
async function getCollectionEdit(collectionId) {
  const rows = await query(
    'SELECT collection_id, visibility, updated_by FROM dcf_edits.collection_edit WHERE collection_id = $1',
    [collectionId], { database: config.pg.dcfDatabase },
  );
  return rows[0] || null;
}

/**
 * Close every pool.
 *
 * @returns {Promise<void>}
 */
async function close() {
  await Promise.all(Object.values(pools).map(p => p.end()));
  for (const key of Object.keys(pools)) delete pools[key];
}

export {
  query, getCollection, getCollectionIdentifiers, getItems, getJobResults, isFailedResult, getQueueCount,
  getFailedCommands, getAuditEvents, getCollectionEdit, close,
};
