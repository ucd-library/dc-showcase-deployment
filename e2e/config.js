/**
 * E2E settings. Every value comes from an env var, with defaults for the
 * local dev stack (argonath-deployment + dc-showcase-deployment local-dev,
 * started by cmds/e2e/up.sh). A k8s dev environment later only needs a
 * different set of env vars.
 *
 * @module config
 */
import fs from 'node:fs';

/**
 * Read KEY=value lines from an env file (no quoting or expansion beyond
 * stripping surrounding quotes).
 *
 * @param {string} file - Path.
 * @returns {Object} Parsed values; {} if the file is missing.
 */
function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) out[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

// The local stack's Preservica login lives in argonath-deployment's
// local-dev .env; reuse its PRESERVICA_* (and E2E_PRESERVICA_PARENT_REF)
// values unless already set.
const ARGONATH_ENV_FILE = process.env.E2E_ARGONATH_ENV_FILE
  || new URL('../../argonath-deployment/compose/local-dev/.env', import.meta.url).pathname;
const fileEnv = readEnvFile(ARGONATH_ENV_FILE);
const env = { ...process.env };
for (const [key, value] of Object.entries(fileEnv)) {
  if ((key.startsWith('PRESERVICA_') || key === 'E2E_PRESERVICA_PARENT_REF') && env[key] === undefined) env[key] = value;
}

/**
 * Read a number env var.
 *
 * @param {string} name - Env var name.
 * @param {number} fallback - Default.
 * @returns {number} Value.
 */
function num(name, fallback) {
  return env[name] ? Number(env[name]) : fallback;
}

const config = {
  // Preservica: the folder every e2e run creates its collection folder under,
  // plus operator and deletion-approver (manager) logins
  preservica: {
    // digtk's default: https://<tenant>.preservica.com
    baseUrl: env.PRESERVICA_BASE_URL || `https://${env.PRESERVICA_TENANT || 'starter1'}.preservica.com`,
    tenant: env.PRESERVICA_TENANT || 'starter1',
    username: env.PRESERVICA_USERNAME,
    password: env.PRESERVICA_PASSWORD,
    managerUsername: env.PRESERVICA_MANAGER_USERNAME,
    managerPassword: env.PRESERVICA_MANAGER_PASSWORD,
    parentRef: env.E2E_PRESERVICA_PARENT_REF,
  },

  // workflow tag the stack auto-discovers and publishes (compose.e2e.yaml)
  publishTag: env.E2E_PUBLISH_TAG || 'e2e-testing',
  group: env.E2E_BRONZE_GROUP || 'preservica',
  goldProject: env.E2E_GOLD_PROJECT || 'digital-dev',

  // argonath's postgres: collection_registry, reporting and caskfs schemas
  pg: {
    host: env.E2E_PG_HOST || 'localhost',
    port: num('E2E_PG_PORT', 5432),
    user: env.E2E_PG_USER || 'postgres',
    password: env.E2E_PG_PASSWORD || 'postgres',
    database: env.E2E_PG_DATABASE || 'postgres',
    dcfDatabase: env.E2E_PG_DCF_DATABASE || 'dcf',
    caskSchema: env.E2E_CASK_SCHEMA || 'caskfs',
  },

  cask: {
    apiUrl: (env.E2E_CASK_API_URL || 'http://localhost:3001/cask/api').replace(/\/+$/, ''),
    // local-dev cask trusts this header instead of a login
    trustedUser: env.E2E_CASK_TRUSTED_USER || 'dagster',
  },

  es: {
    url: (env.E2E_ES_URL || 'http://localhost:9200').replace(/\/+$/, ''),
    itemIndex: env.E2E_ES_ITEM_INDEX || 'item-read',
    collectionIndex: env.E2E_ES_COLLECTION_INDEX || 'collection-read',
    pageSearchIndex: env.E2E_ES_PAGE_SEARCH_INDEX || 'page-search-read',
  },

  dagster: {
    url: (env.DAGSTER_URL || 'http://localhost:3000/dagster').replace(/\/+$/, ''),
  },

  // dc-showcase gateway; admin calls need a Keycloak token with ui-admin
  dcs: {
    url: (env.E2E_DCS_URL || 'http://localhost:8000').replace(/\/+$/, ''),
    adminToken: env.E2E_DCS_ADMIN_TOKEN,
    oidcTokenUrl: env.E2E_OIDC_TOKEN_URL,
    oidcClientId: env.E2E_OIDC_CLIENT_ID,
    oidcClientSecret: env.E2E_OIDC_CLIENT_SECRET,
  },

  // compose projects of the e2e stacks (cmds/e2e/env.sh), kept apart from
  // the regular local-dev projects 'argonath' and 'dc-showcase'
  compose: {
    argonathProject: env.E2E_ARGONATH_COMPOSE_PROJECT || 'argonath-e2e',
    dcsProject: env.E2E_DCS_COMPOSE_PROJECT || 'dc-showcase-e2e',
  },

  // per-stage timeouts and poll interval (ms)
  timing: {
    interval: num('E2E_POLL_INTERVAL_MS', 10000),
    ingest: num('E2E_TIMEOUT_INGEST_MS', 15 * 60000),
    stage: num('E2E_TIMEOUT_STAGE_MS', 10 * 60000),
    process: num('E2E_TIMEOUT_PROCESS_MS', 20 * 60000),
  },

  artifactsDir: env.E2E_ARTIFACTS_DIR || new URL('./.artifacts', import.meta.url).pathname,
};

export default config;
