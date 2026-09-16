#! /bin/bash

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $ROOT_DIR/../..
ENV_FILE=./compose/local-dev/.env

DEPTH=$1
VERSION=$2
if [[ ! -z "$DEPTH" ]]; then
  DEPTH="--depth $DEPTH"
fi
if [[ -z "$VERSION" ]]; then
  VERSION="main"
fi

cork-kube build exec \
  -p dc-showcase \
  -v $VERSION \
  --set-env $ENV_FILE \
  -o sandbox $DEPTH 