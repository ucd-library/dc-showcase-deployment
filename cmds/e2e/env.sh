#! /bin/bash
# Names for the e2e stacks, sourced by the other cmds/e2e scripts. Everything
# is separate from the regular local-dev stacks (projects argonath and
# dc-showcase): containers, volumes (fresh Dagster storage and databases)
# and the shared network. Host ports are the same, so only one of the two
# setups can run at a time.
export ARGONATH_COMPOSE_PROJECT=argonath-e2e
export DCS_COMPOSE_PROJECT=dc-showcase-e2e
export ARGONATH_SHARED_NETWORK=argonath-e2e-shared
export ARGONATH_CASKFS_VOLUME=${ARGONATH_COMPOSE_PROJECT}_caskfs_data
# read by e2e/config.js
export E2E_ARGONATH_COMPOSE_PROJECT=$ARGONATH_COMPOSE_PROJECT
export E2E_DCS_COMPOSE_PROJECT=$DCS_COMPOSE_PROJECT
