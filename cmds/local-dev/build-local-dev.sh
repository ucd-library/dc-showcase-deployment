#! /bin/bash

DEPTH=$1
VERSION=$2
if [[ ! -z "$DEPTH" ]]; then
  DEPTH="--depth $DEPTH"
fi
if [[ -z "$VERSION" ]]; then
  VERSION="sandbox"
fi

cork-kube build exec \
  -p dc-showcase \
  -v $VERSION \
  -o sandbox $DEPTH 