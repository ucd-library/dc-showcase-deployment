#! /bin/bash

docker compose -p ${DCS_COMPOSE_PROJECT:-dc-showcase} down "$@"