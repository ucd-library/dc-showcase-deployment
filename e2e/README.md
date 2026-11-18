# dc-showcase e2e

End-to-end tests for the full dc-showcase pipeline:

```
Preservica change -> bronze_preservica_auto_sync -> bronze (by-ref, tree)
  -> bronze_collection_cask_audit -> item_queue -> gold_dcs_process_item (silver, gold, ES)
  -> gold_dcs_collection_rollup -> collection doc in ES
```

The suite makes real changes in Preservica and waits for the local dev stack to pick them up. It checks Postgres, CaskFS and Elasticsearch at every step. The suite lives in this deployment repo because it tests a deployed combination of argonath, dc-showcase, caskfs and anduin images. argonath-only e2e tests should go in `argonath-deployment/e2e` with the same layout.

## Scenarios

The specs run in order against one collection named `e2e-<date>-<time>-<rand>`, and the suite stops at the first failure.

| Spec | What it does | What it checks |
|---|---|---|
| `00-preflight` | Checks that the stack and settings are ready | Services reachable, logins working, e2e env present in the daemon |
| `01-new-collection` | Creates a folder tagged `argonath=e2e-testing` holding one single-image item, plus a control folder tagged `e2e-testing-bronze` | Auto-registration with tags, `itemsRoot=tree` manifest, bronze/silver/gold files, registry and job results, ES docs indexed private. The control folder reaches bronze only. |
| `02-add-item` | Ingests a second item | Only the new item is processed, and the first item's gold files are unchanged |
| `03-update-item` | Retitles item one and replaces its image | Item one is re-processed with the new title and new derivatives. The tree and gold folders move. Item two is untouched. |
| `04-delete-item` | Deletes item two in Preservica | Tree entry, silver, gold and ES docs are removed. Bronze `by-ref` is kept by design. |
| `05-visibility` | Switches the collection public, adds an item, switches it back to private (needs admin auth, otherwise skipped) | ES `roles` flip on every doc, and the anonymous API follows. The new item is indexed public. |

Everything the run created is removed at the end, including after a failure, unless `E2E_KEEP=true`.

## Running

```bash
# 1. settings (see the table below). PRESERVICA_TENANT/USERNAME/PASSWORD are
#    read from argonath-deployment/compose/local-dev/.env unless already set;
#    the manager login and parent folder can go in that file too.
export E2E_PRESERVICA_PARENT_REF=<ref of the e2e folder in Preservica>

# 2. everything: e2e stacks up, suite, cleanup
./cmds/e2e/run.sh            # add --down to stop the e2e stacks afterwards

# or step by step
./cmds/e2e/up.sh
cd e2e && npm install && npm test
./cmds/e2e/down.sh           # -v also drops the e2e volumes
```

The e2e stacks run as their own compose projects, `argonath-e2e` and `dc-showcase-e2e`. They have their own network (`argonath-e2e-shared`) and volumes, set in `cmds/e2e/env.sh`, so e2e runs never touch your regular local-dev databases, Dagster storage or CaskFS. They publish the same host ports as the regular `argonath` / `dc-showcase` stacks. `up.sh` stops with instructions if those stacks, or anything else, are holding the ports.

To run a single spec, use `npx mocha specs/00-preflight.test.js`. Specs after 00 depend on the ones before them.

`cmds/e2e/up.sh` starts argonath-e2e with `argonath-deployment/compose/local-dev/compose.e2e.yaml` layered on. That file makes the following changes:
- Sensors start running, and they tick every 30s instead of every 300s.
- The cask-audit settle window drops to 30s.
- Discovery and publishing are scoped to the `e2e-testing` tag (plus the `e2e-testing-bronze` control tag), publishing to the `digital-dev` gold project.

A full run takes roughly 15–30 minutes. Most of that is Preservica ingest and the settle and sensor windows.

Sensors start running only on a fresh Dagster instance. If you switched a sensor off in the UI, Dagster keeps it off, so switch it back on.

## Settings

| Env var | Default | Purpose |
|---|---|---|
| `E2E_PRESERVICA_PARENT_REF` | (required) | Preservica folder that every run creates its folders under |
| `PRESERVICA_USERNAME` / `PRESERVICA_PASSWORD` | (required) | Operator login: creates, ingests and edits |
| `PRESERVICA_MANAGER_USERNAME` / `PRESERVICA_MANAGER_PASSWORD` | the operator login | Login that approves deletions, if the tenant needs a separate one |
| `PRESERVICA_TENANT` / `PRESERVICA_BASE_URL` | `starter1` / `https://<tenant>.preservica.com` | Tenant and host |
| `E2E_ARGONATH_ENV_FILE` | `../argonath-deployment/compose/local-dev/.env` | Where unset `PRESERVICA_*` values are read from |
| `E2E_DCS_ADMIN_TOKEN` | (none) | Keycloak token with `admin` or `ui-admin`, for 05 |
| `E2E_OIDC_TOKEN_URL` / `E2E_OIDC_CLIENT_ID` / `E2E_OIDC_CLIENT_SECRET` | (none) | Alternative to the token: a client-credentials service account |
| `E2E_PG_*`, `E2E_ES_URL`, `E2E_CASK_API_URL`, `DAGSTER_URL`, `E2E_DCS_URL` | local-dev ports | Endpoints (see `config.js`) |
| `E2E_TIMEOUT_INGEST_MS` / `_STAGE_MS` / `_PROCESS_MS` | 15m / 10m / 20m | Per-stage timeouts |
| `E2E_QUIET_MS` | 90s | How long the collection must stay idle before final assertions |
| `E2E_KEEP` | `false` | Skip cleanup, so you can inspect the state |
| `E2E_ARGONATH_COMPOSE_PROJECT` / `E2E_DCS_COMPOSE_PROJECT` | `argonath-e2e` / `dc-showcase-e2e` | Compose projects, used for logs, the daemon env check, and running `bin/set-visibility.js` |
| `E2E_UPDATE_SNAPSHOTS` | `false` | Rewrite `specs/__snapshots__` |

The dev and prod configs share the `starter1` tenant. Prod only auto-registers folders tagged `sync`, `ai` or `public-showcase-prod` (`ARGONATH_DISCOVERY_TAGS` in the prod overlay), so it ignores the `e2e-testing` folders this suite creates. Local dev (`.env.example`: `public-showcase-dev`) ignores them too.

## Tenant notes (starter1, Preservica 9.4)

These were found by running against the tenant, and the client and specs handle them:

- **Login:** don't send `tenant` when logging in; Starter takes it from the hostname.
- **Upload bucket:** the upload bucket is named after the tenant's internal ID (e.g. `t1b208e31adfde268.package.upload`), so it's found with `ListBuckets`. Packages land about 30s after upload, and they keep the asset ref from the package.
- **Deletes:** a delete completes without a separate approval, so the operator login is enough. `updated-since` reports a deleted entity as an untyped `<Entity ref="..." deleted="true"/>` and never reports its parent folder. argonath finds the parent from bronze.
- **Content replacement:** Starter returns 403 `unavailable.feature`, so `03-update-item` runs as a title/metadata update and skips the image checks. They'll run automatically on a tenancy that allows replacement.
- **Collection ARK:** building the collection record needs a collection ARK, so run folders get a test ARK (`ark:/99999/fk4...`, the NAAN reserved for testing).

## How waiting works

- **`stage(label, probe)`** (`lib/wait.js`) polls a probe until it returns a truthy value. Each stage has its own timeout, so a failure names the step that stalled, for example `item one: gold record`.
- **Fail fast.** On every poll, `lib/pipeline.js` looks for new failures in three places: FAILURE Dagster runs tagged with the collection, failed `reporting.command` rows, and failed `job_result` rows. The suite aborts as soon as it finds one, instead of waiting out the timeout.
- **Quiet before asserting.** `waitForQuiet()` requires that nothing is queued and nothing is running for the collection, and that this holds for `E2E_QUIET_MS`. The final state assertions run only after that.
- **Diagnostics.** On a failure, `.artifacts/<runId>/<stage>/` gets the registry rows, the audit log, the cask listings, the ES docs, the Dagster runs and the compose logs.
- **Snapshots.** Wide state (cask listings, registry rows, the item doc) is compared against `specs/__snapshots__/*.json`. Run ids, refs, hashes and timestamps are normalized first. A missing snapshot is written on the first run. Review it and commit it.

## Cleanup

```bash
npm run cleanup -- e2e-20261118-0742-a1b2   # one run
npm run cleanup -- --stale --hours 24        # every leftover e2e-* run
```

Cleanup runs in this order:
1. Delete the Preservica folders, which needs the manager login.
2. Disable the registry rows and clear their queue.
3. Delete the bronze, silver and gold folders.
4. Delete the ES docs and the `dcf_edits` row.
