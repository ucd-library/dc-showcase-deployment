#! /bin/bash

set -e

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $ROOT_DIR/../..

if ! docker network inspect argonath-shared >/dev/null 2>&1; then
  echo "argonath-shared network not found — start argonath first:" >&2
  echo "  (cd ../../../argonath-deployment && ./cmds/up.sh)" >&2
  exit 1
fi

docker compose -f compose/local-dev/compose.yaml -p dc-showcase up -d

echo "Digital Collection Showcase deployment (local-dev) is up and running."
echo " - Gateway URL      : http://localhost:3002"
echo " - Client URL       : http://localhost:8000"
echo " - Kibana URL       : http://localhost:5601"
