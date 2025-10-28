#!/bin/bash

set -e  # Exit on any error

# Configuration
IMAGE_NAME="richloh/repo:autark-demo"
REMOTE_HOST="root@lohwasser.de"
REMOTE_PATH="/root/autark-demo"
COMPOSE_FILE="docker-compose.yml"

echo "========================================="
echo "Starting deployment process..."
echo "========================================="

# Prep: Change working directory to the script's location
cd "$(dirname "$0")"

# Step 1: Build the Docker image
echo ""
echo "[1/4] Building Docker image: $IMAGE_NAME"
docker build --build-arg SITE_URL=https://autark-demo.tmt-labs.de -t "$IMAGE_NAME" ..

# Step 2: Push the image to Docker Hub
echo ""
echo "[2/4] Pushing image to Docker Hub..."
docker push "$IMAGE_NAME"

# Step 3: Copy docker-compose.yml to remote server
echo ""
echo "[3/4] Copying docker-compose.yml to $REMOTE_HOST:$REMOTE_PATH"
ssh "$REMOTE_HOST" "mkdir -p $REMOTE_PATH"
scp "$COMPOSE_FILE" "$REMOTE_HOST:$REMOTE_PATH/"

# Step 4: Start the application with docker compose
echo ""
echo "[4/4] Starting application on remote server..."
ssh "$REMOTE_HOST" "cd $REMOTE_PATH && docker compose pull && docker compose up -d"

echo ""
echo "========================================="
echo "Deployment completed successfully!"
echo "========================================="
echo "Application should be running at autark-demo.tmt-labs.de"
