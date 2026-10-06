# Public Showcase Digital Collections (DC Showcase) Deployment

For the main source code, see the [dc-showcase](https://github.com/ucd-library/dc-showcase) repo.




Powered by [Argonath](https://github.com/ucd-library/argonath) an implementation of 
[Anduin](https://github.com/ucd-library/anduin) and [CaskFS](https://github.com/ucd-library/caskfs).

## Requires

Sibling checkouts at the same level as `dc-showcase-deployment`'s parent dir:
`argonath`, `argonath-deployment` and `dc-showcase`.

## Usage

```
docker compose up -d --build   # first run, or after a services/client Dockerfile change
./bootstrap.sh                 # one-time per fresh volume set - inits CaskFS's
                                # schema and grants CASK_USER access to gold/digital-dev
```

Then:
- `http://localhost:8000` - public showcase client/server (`/health`, `/api`)
- `http://localhost:3001` - cask directly
- `http://localhost:4000` - auth-gateway (AUTH_ENABLED=false by default - see `.env`)
- `http://localhost:5432` - shared postgres
- `http://localhost:9200` - elasticsearch (same custom image real dev/prod runs, single-node here)


`fcrepo-middeware.js`'s cask-calling branches are still stubs (Phase 2, not
yet wired into `index.js`) - this stack proves the *server* can reach cask
with a correctly-scoped identity, not yet that `/fcrepo/*` requests resolve
through it end to end.

## Teardown

```
docker compose down -v
```
