#! /bin/bash

set -e

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $ROOT_DIR/../..

docker compose -f compose/local-dev/compose.yaml -p dc-showcase exec client \
  bash -c "cd client && npm run watch"
