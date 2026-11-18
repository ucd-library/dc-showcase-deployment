#! /bin/bash

# Full e2e run: start the e2e stacks (argonath-e2e, dc-showcase-e2e), run the suite (which always
# cleans up its own Preservica/registry/cask/ES state), optionally stop.
#
# Usage: run.sh [--down] [mocha args...]
#   --down  stop the e2e stacks afterwards
#   Env: see e2e/README.md (Preservica logins, parent folder, admin token)

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
DCS_DEPLOY_DIR="$( cd "$ROOT_DIR/../.." && pwd )"
ARGO_DEPLOY_DIR="$( cd "$DCS_DEPLOY_DIR/../argonath-deployment" && pwd )"

DOWN=false
if [ "$1" == "--down" ]; then
  DOWN=true
  shift
fi

source "$ROOT_DIR/env.sh"
"$ROOT_DIR/up.sh" || exit 1

cd "$DCS_DEPLOY_DIR/e2e"
[ -d node_modules ] || npm install
npm test -- "$@"
STATUS=$?

if [ "$DOWN" == "true" ]; then
  "$ROOT_DIR/down.sh"
fi

exit $STATUS
