#!/usr/bin/env bash
# Build the Autark demo container locally and roll it out to lohwasser.de (served at autark.lohwasser.de
# via the caddy-docker-proxy running there). The image is shipped over SSH — no registry needed.
set -euo pipefail

IMAGE="autark-demo:latest"
REMOTE="${REMOTE:-richard@lohwasser.de}"
REMOTE_PATH="${REMOTE_PATH:-/apps/autark}"

cd "$(dirname "$0")"

echo "[1/4] Building image $IMAGE"
docker build -t "$IMAGE" ..

echo "[2/4] Shipping image to $REMOTE"
docker save "$IMAGE" | gzip | ssh "$REMOTE" "gunzip | docker load"

echo "[3/4] Uploading compose file to $REMOTE:$REMOTE_PATH"
ssh "$REMOTE" "mkdir -p $REMOTE_PATH"
scp docker-compose.yml "$REMOTE:$REMOTE_PATH/docker-compose.yml"

echo "[4/4] Starting container"
ssh "$REMOTE" "cd $REMOTE_PATH && docker compose up -d --force-recreate && docker image prune -f >/dev/null"

echo "Done → https://autark.lohwasser.de"
