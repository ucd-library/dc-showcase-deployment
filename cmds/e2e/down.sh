#! /bin/bash

# Stop the e2e stacks (see env.sh). Pass -v to also remove their volumes
# for a completely fresh start next time.
#
# Usage: down.sh [-v]

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
DCS_DEPLOY_DIR="$( cd "$ROOT_DIR/../.." && pwd )"
ARGO_DEPLOY_DIR="$( cd "$DCS_DEPLOY_DIR/../argonath-deployment" && pwd )"
source "$ROOT_DIR/env.sh"

"$DCS_DEPLOY_DIR/cmds/local-dev/down.sh" "$@"
"$ARGO_DEPLOY_DIR/cmds/local-dev/down.sh" "$@"
