# dams + argonath local dev

Docker-compose stack for developing/testing dams's server (`services/client`,
built from the sibling `dams` repo) against a local stand-in for argonath's
`cask`/`auth-gateway`/`postgres` - no k8s, no real argonath-prod access
needed. Mirrors the pattern in
`aggie-experts-deployment/compose/local-dev` (source-mounted volumes from
sibling repo checkouts, sandboxed images pulled from Artifact Registry).

See `../../../dams/docs/PORT-PLAN.md` Phase 1 for the background: why
argonath has no real dev namespace yet, and why CaskFS's ACL is
username-keyed rather than Keycloak-role-keyed.

## Requires

Sibling checkouts at the same level as `dams-deployment`'s parent dir:
`dams`, `caskfs`, `project-anduin`. Docker Desktop with Kubernetes not
required for this - plain `docker compose` only.

## Usage

```
docker compose up -d --build   # first run, or after a services/client Dockerfile change
./bootstrap.sh                 # one-time per fresh volume set - inits CaskFS's
                                # schema and grants CASK_USER access to gold/digital-dev
```

Then:
- `http://localhost:8000` - dams client/server (`/health`, `/api`)
- `http://localhost:3001` - cask directly
- `http://localhost:4000` - auth-gateway (AUTH_ENABLED=false by default - see `.env`)
- `http://localhost:5432` - shared postgres
- `http://localhost:9200` - elasticsearch (same custom image real dev/prod runs, single-node here)

`services/client/{controllers,lib,models,index.js,config.js}` are
live-mounted from the `dams` checkout - edit and `docker compose restart
client` to pick up changes, no rebuild needed unless `package.json` changes.

`fcrepo-middeware.js`'s cask-calling branches are still stubs (Phase 2, not
yet wired into `index.js`) - this stack proves the *server* can reach cask
with a correctly-scoped identity, not yet that `/fcrepo/*` requests resolve
through it end to end.

## Teardown

```
docker compose down -v
```
