#! /bin/bash

set -e
docker compose -p ${DCS_COMPOSE_PROJECT:-dc-showcase} "$@"
