#! /bin/bash

# Start (or restart) the e2e stacks (compose projects argonath-e2e and
# dc-showcase-e2e, see env.sh) and initialize them. argonath runs with
# compose.e2e.yaml: sensors on and fast, tag-scoped discovery and
# publishing. Needs sibling checkouts of argonath-deployment, argonath,
# caskfs and dc-showcase, and their .env files.
#
# The regular local-dev stacks use the same host ports, so this refuses to
# start while they are running.
#
# Usage: up.sh [worker-count]

set -e

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
DCS_DEPLOY_DIR="$( cd "$ROOT_DIR/../.." && pwd )"
ARGO_DEPLOY_DIR="$( cd "$DCS_DEPLOY_DIR/../argonath-deployment" && pwd )"
WORKERS=${1:-2}
source "$ROOT_DIR/env.sh"

# the regular local-dev stacks would collide on host ports
RUNNING=""
for project in argonath dc-showcase; do
  if [ -n "$(docker compose -p $project ps -q 2>/dev/null)" ]; then
    RUNNING="$RUNNING $project"
  fi
done
if [ -n "$RUNNING" ]; then
  echo "The regular local-dev stack(s) are running:$RUNNING" >&2
  echo "They use the same host ports as the e2e stacks. Stop them first (data is kept):" >&2
  echo "  $DCS_DEPLOY_DIR/cmds/local-dev/down.sh" >&2
  echo "  $ARGO_DEPLOY_DIR/cmds/local-dev/down.sh" >&2
  exit 1
fi

# anything else holding the ports
BUSY=""
for port in 3000 3001 4000 5432 5601 5672 8000 8088 9200 15672; do
  if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then
    owner=$(docker ps --filter "publish=$port" --format '{{.Names}}' | head -1)
    case "$owner" in
      ${ARGONATH_COMPOSE_PROJECT}-*|${DCS_COMPOSE_PROJECT}-*) ;;
      *) BUSY="$BUSY $port${owner:+ ($owner)}" ;;
    esac
  fi
done
if [ -n "$BUSY" ]; then
  echo "Ports the e2e stacks need are in use:$BUSY" >&2
  exit 1
fi

"$ARGO_DEPLOY_DIR/cmds/local-dev/up.sh" $WORKERS --e2e
"$DCS_DEPLOY_DIR/cmds/local-dev/up.sh"

echo "Waiting for postgres and cask..."
for i in $(seq 1 60); do
  if curl -sf -o /dev/null http://localhost:3001/cask/api/dir/ -H 'X-Anduin-User: {"username":"dagster"}' \
    && "$ARGO_DEPLOY_DIR/cmds/local-dev/dc.sh" exec -T postgres pg_isready -U postgres >/dev/null; then
    break
  fi
  sleep 5
done

echo "Waiting for dc-showcase client..."
for i in $(seq 1 60); do
  curl -sf -o /dev/null http://localhost:8000/ && break
  sleep 5
done

"$ARGO_DEPLOY_DIR/cmds/local-dev/init-services.sh" dagster

echo "e2e stacks ($ARGONATH_COMPOSE_PROJECT, $DCS_COMPOSE_PROJECT) are up. Run: (cd e2e && npm test)"
