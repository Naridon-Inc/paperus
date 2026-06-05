#!/usr/bin/env bash
# Deploy the standalone Notionless landing page to its own Lightsail container
# service (separate from the signaling relay). Idempotent: creates the service
# on first run, then builds → pushes → deploys on every run.
#
#   ./landing/deploy.sh
#
# Requires: aws cli (configured), the lightsailctl plugin, and docker.
set -euo pipefail

SERVICE="${LIGHTSAIL_LANDING_SERVICE:-notionless-landing}"
REGION="${AWS_REGION:-eu-central-1}"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "▸ Syncing page into the relay copy (backend/public) too…"
( cd "$HERE/.." && npm run build:site >/dev/null 2>&1 || true )

echo "▸ Ensuring container service '$SERVICE' exists ($REGION, nano)…"
aws lightsail create-container-service --service-name "$SERVICE" \
  --power nano --scale 1 --region "$REGION" >/dev/null 2>&1 \
  && echo "  created (provisioning may take a few minutes)" \
  || echo "  already exists"

echo "▸ Building linux/amd64 image…"
docker buildx build --platform linux/amd64 -t "$SERVICE:amd64" --load "$HERE" >/dev/null

echo "▸ Pushing image to Lightsail…"
PUSH_OUT="$(aws lightsail push-container-image --service-name "$SERVICE" \
  --label landing --image "$SERVICE:amd64" --region "$REGION" 2>&1)"
echo "$PUSH_OUT" | tail -1
REF="$(echo "$PUSH_OUT" | grep -oE ':[a-zA-Z0-9._-]+\.landing\.[0-9]+' | tail -1)"
[ -n "$REF" ] || { echo "‼ could not parse pushed image ref"; exit 1; }
echo "  image ref: $REF"

echo "▸ Deploying…"
cat > /tmp/notionless-landing-deploy.json <<JSON
{
  "serviceName": "$SERVICE",
  "containers": { "landing": { "image": "$REF", "ports": { "80": "HTTP" } } },
  "publicEndpoint": {
    "containerName": "landing",
    "containerPort": 80,
    "healthCheck": { "path": "/", "intervalSeconds": 30, "timeoutSeconds": 10, "healthyThreshold": 2, "unhealthyThreshold": 5, "successCodes": "200-399" }
  }
}
JSON
aws lightsail create-container-service-deployment \
  --cli-input-json file:///tmp/notionless-landing-deploy.json --region "$REGION" >/dev/null

URL="$(aws lightsail get-container-services --service-name "$SERVICE" --region "$REGION" \
  --query 'containerServices[0].url' --output text)"
echo "✓ Deployment started. Live at: $URL  (takes a few minutes to flip to RUNNING)"
