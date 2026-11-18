/**
 * Fail in seconds, not after a 20-minute wait, when the stack or config isn't
 * ready: every service answers, the e2e settings are in effect, and the
 * Preservica logins work.
 */
import assert from 'node:assert/strict';
import config from '../config.js';
import * as pg from '../lib/pg.js';
import * as es from '../lib/es.js';
import * as cask from '../lib/cask.js';
import { client } from '../lib/preservica.js';
import { listRunsByTags, listSensors, startSensor } from '@ucd-lib/argonath/lib/dagster.js';

// every sensor the Preservica -> showcase chain needs
const PIPELINE_SENSORS = [
  'bronze_preservica_auto_sync',
  'bronze_collection_partition_sync',
  'bronze_collection_cask_audit',
  'item_queue',
  'gold_dcs_collection_rollup_trigger',
  'process_item_failure',
];

describe('00 preflight', function() {

  it('has the Preservica settings', function() {
    // the manager (deletion approver) login falls back to the operator's
    for (const key of ['parentRef', 'username', 'password']) {
      assert.ok(config.preservica[key], `config.preservica.${key} is not set (see e2e/README.md)`);
    }
  });

  it('can log in to Preservica as operator and manager, and see the e2e parent folder', async function() {
    const writer = client();
    await writer.login();
    await writer.login({ manager: true });
    assert.ok(await writer.exists('SO', config.preservica.parentRef), 'E2E_PRESERVICA_PARENT_REF not found');
  });

  it('reaches postgres with the registry, reporting, caskfs and dcf schemas', async function() {
    const rows = await pg.query(
      "SELECT nspname FROM pg_namespace WHERE nspname IN ('collection_registry', 'reporting', $1)",
      [config.pg.caskSchema]);
    assert.equal(rows.length, 3, `missing schemas, found: ${rows.map(r => r.nspname)}`);
    await pg.query('SELECT 1 FROM dcf_edits.collection_edit LIMIT 1', [], { database: config.pg.dcfDatabase });
  });

  it('reaches Elasticsearch with the showcase read aliases', async function() {
    for (const index of [config.es.itemIndex, config.es.collectionIndex, config.es.pageSearchIndex]) {
      const res = await es.request('GET', `/${index}/_count`);
      assert.ok(res.count !== undefined, `${index}: ${JSON.stringify(res)}`);
    }
  });

  it('reaches CaskFS', async function() {
    assert.ok(await cask.ls('/'), 'cask root listing failed');
  });

  it('reaches Dagster GraphQL', async function() {
    await listRunsByTags({ 'argonath/kind': 'item' }, { baseUrl: config.dagster.url, limit: 1 });
  });

  it('has every pipeline sensor running on the e2e interval', async function() {
    // ARGONATH_SENSORS_DEFAULT_RUNNING only covers sensors with no saved state;
    // one switched off earlier on this Dagster instance stays off, so start them
    const dagster = { baseUrl: config.dagster.url };
    for (const name of PIPELINE_SENSORS) await startSensor(name, dagster);
    const sensors = Object.fromEntries((await listSensors(dagster)).map(s => [s.name, s]));
    for (const name of PIPELINE_SENSORS) {
      assert.equal(sensors[name]?.status, 'RUNNING', `${name} is not running`);
      assert.ok(sensors[name].minIntervalSeconds <= 30, `${name} ticks every ${sensors[name].minIntervalSeconds}s`);
    }
  });

  it('has the e2e sensor settings in the dagster daemon', async function() {
    // set by argonath-deployment compose.e2e.yaml; without them every stage waits ~10x longer
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { stdout } = await promisify(execFile)('docker', [
      'compose', '-p', config.compose.argonathProject, 'exec', '-T', 'dagster-daemon', 'env',
    ]).catch(e => ({ stdout: `docker failed: ${e.message}` }));
    assert.match(stdout, /ARGONATH_SENSOR_INTERVAL_SECONDS=30/, 'start the stack with cmds/e2e/up.sh');
    assert.match(stdout, new RegExp(`DIGTK_SHOWCASE_PUBLISH_TAG=${config.publishTag}`));
  });
});
