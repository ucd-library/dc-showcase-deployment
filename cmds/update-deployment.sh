#! /bin/bash

set -e

ENVIRONMENT=$1
VERSION=$2

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $ROOT_DIR/..

ALLOWED_ENVIRONMENTS=("prod")

# unlike argonath-deployment, dc-showcase has no cork-build-registry wiring
# (no multi-repo version chain) - all four built images come from this one
# repo's own .cork-build, tagged with the same VERSION, so no external
# registry lookup is needed here.
REGISTRY="us-west1-docker.pkg.dev/argonath-508815/pub"

if [[ ! " ${ALLOWED_ENVIRONMENTS[@]} " =~ " ${ENVIRONMENT} " ]]; then
  echo "Error: Invalid environment. Allowed environments are: ${ALLOWED_ENVIRONMENTS[@]}"
  echo "Usage: $0 <environment> <version>"
  exit 1
fi

if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <environment> <version>"
  exit 1
fi

edit() {
  ROOT=$1
  RESOURCE_TYPE=$2
  IMAGE=$3
  CONTAINER=$4
  OVERLAY=$5

  echo "Updating $ROOT resource=$RESOURCE_TYPE container=$CONTAINER image=$IMAGE overlay=$OVERLAY"

  cork-kube edit -o $OVERLAY \
    -f $RESOURCE_TYPE \
    -e "\$.spec.template.spec.containers[?(@.name==\"$CONTAINER\")].image=$IMAGE" \
    --replace \
    -- kustomize/$ROOT
}

echo "Updating dc-showcase $ENVIRONMENT to version: $VERSION"

edit dcs-gateway       deployment  "$REGISTRY/dcs-gateway:$VERSION"          service       $ENVIRONMENT
edit dcs-client        deployment  "$REGISTRY/dcs-client:$VERSION"           service       $ENVIRONMENT
edit dcs-iiif          deployment  "$REGISTRY/dcs-iipimage-server:$VERSION" service       $ENVIRONMENT
edit dcs-elasticsearch statefulset "$REGISTRY/dcs-elastic-search:$VERSION"   elasticsearch $ENVIRONMENT

# dcs-kibana is intentionally excluded - it runs the stock upstream
# docker.elastic.co/kibana image, not one of dc-showcase's own built images.

echo ""
read -p "Would you like to commit the changes to git? (y/n): " COMMIT_CHANGES

if [[ "$COMMIT_CHANGES" == "y" ]]; then
  echo -e "\nCommitting changes to git"

  git add --all
  git commit -m "Updated $ENVIRONMENT to version $VERSION"
  git pull
  git push
else
  echo ""
  echo "Changes not committed to git."
fi

echo ""
echo "Done updating deployment $ENVIRONMENT to version $VERSION"
