#! /bin/bash

set -e

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $ROOT_DIR/../..

NETWORK=${ARGONATH_SHARED_NETWORK:-argonath-shared}
if ! docker network inspect $NETWORK >/dev/null 2>&1; then
  echo "$NETWORK network not found — start argonath first:" >&2
  echo "  (cd ../../../argonath-deployment && ./cmds/up.sh)" >&2
  exit 1
fi

docker compose -f compose/local-dev/compose.yaml -p ${DCS_COMPOSE_PROJECT:-dc-showcase} up -d

echo "Digital Collection Showcase deployment (local-dev) is up and running."
echo " - Site (gateway)   : http://localhost:8000"
echo " - Kibana URL       : http://localhost:5601"
