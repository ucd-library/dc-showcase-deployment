#! /bin/bash

# Run the dc-showcase init Job (kustomize/init) against an environment. The
# Job runs `dcs-prod-init` in the dcs-client image, which installs the app's
# dcf schema, seeds its cask gold files (hero banner, browse by images) and
# creates the elasticsearch indices/aliases (dcs-client only verifies them at
# startup in prod, so it won't start until this has run).
# Safe to re-run.
#
# Run after argonath's own init (argonath-deployment's cmds/prod-init.sh): it
# creates the dcf database, the cask tables and the dcs-gateway cask admin
# role this job depends on.
#
# Jobs are immutable, so kustomize/init is not listed in .cork-kube-config's
# services; this script deletes any previous init Job before applying.

set -e

ENVIRONMENT=$1

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd $ROOT_DIR/..

ALLOWED_ENVIRONMENTS=("prod")
JOB_NAME=dcs-init
TIMEOUT=${INIT_TIMEOUT:-10m}

if [[ ! " ${ALLOWED_ENVIRONMENTS[@]} " =~ " ${ENVIRONMENT} " ]]; then
  echo "Error: Invalid environment. Allowed environments are: ${ALLOWED_ENVIRONMENTS[@]}"
  echo "Usage: $0 <environment>"
  exit 1
fi

NAMESPACE=$(jq -r ".environments[\"$ENVIRONMENT\"].namespace" .cork-kube-config)

# point kubectl at the environment's cluster
cork-kube init $ENVIRONMENT -c .

echo ""
echo "Target cluster/context: $(kubectl config current-context)"
echo "Target namespace: $NAMESPACE"
read -p "Run the init job against $ENVIRONMENT? (y/n): " RUN_INIT

if [[ "$RUN_INIT" != "y" ]]; then
  echo "Init job not run."
  exit 0
fi

# remove any previous run, then start a fresh job
kubectl -n $NAMESPACE delete job $JOB_NAME --ignore-not-found
kubectl -n $NAMESPACE apply -k kustomize/init/overlays/$ENVIRONMENT

# follow the job's logs once its pod is up, in the background, while we wait
# for the job to either complete or fail
kubectl -n $NAMESPACE wait --for=condition=Ready pod -l job-name=$JOB_NAME --timeout=5m || true
kubectl -n $NAMESPACE logs -f job/$JOB_NAME &
LOGS_PID=$!

kubectl -n $NAMESPACE wait --for=condition=complete job/$JOB_NAME --timeout=$TIMEOUT &
COMPLETE_PID=$!
kubectl -n $NAMESPACE wait --for=condition=failed job/$JOB_NAME --timeout=$TIMEOUT > /dev/null 2>&1 &
FAILED_PID=$!

# poll until one of the two waits exits
while kill -0 $COMPLETE_PID 2> /dev/null && kill -0 $FAILED_PID 2> /dev/null; do
  sleep 1
done

if ! kill -0 $COMPLETE_PID 2> /dev/null && wait $COMPLETE_PID; then
  kill $FAILED_PID $LOGS_PID 2> /dev/null || true
  echo ""
  echo "Done: init job completed for $ENVIRONMENT"
  exit 0
fi

kill $COMPLETE_PID $FAILED_PID $LOGS_PID 2> /dev/null || true
echo ""
echo "Error: init job failed or timed out for $ENVIRONMENT. Inspect with:"
echo "  kubectl -n $NAMESPACE describe job $JOB_NAME"
echo "  kubectl -n $NAMESPACE logs job/$JOB_NAME"
exit 1
