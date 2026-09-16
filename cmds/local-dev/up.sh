#! /bin/bash

set -e

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $ROOT_DIR/../..

docker compose -f compose/local-dev/compose.yaml -p dc-showcase up -d

# join docker compose network to argonath
docker network connect argonath_default dc-showcase_gateway_1 || true

echo "Digital Collection Showcase deployment (local-dev) is up and running."
echo " - Client URL       : http://localhost:3002"
echo " - Kibana URL       : http://localhost:5601"