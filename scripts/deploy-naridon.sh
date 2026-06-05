#!/usr/bin/env bash
#
# Deploy the Notionless signaling relay to AWS Lightsail at
# wss://oss.naridon.com/signaling (+ https://oss.naridon.com/health).
#
# Notionless ships as a desktop (Mac) app only — there is NO hosted web app.
# The only thing hosted is the stateless WebRTC signaling relay, which the
# desktop apps use to find each other. One Lightsail container service
# ("notionless", eu-central-1) runs a single `backend` container (the relay on
# :9008), exposed directly as the service's public HTTPS endpoint (Lightsail
# terminates TLS). No nginx, no static site.
#
# Prereqs: Docker running, AWS CLI configured.
# Idempotent: re-run any time to ship a new relay build.
set -euo pipefail

REGION="eu-central-1"
SERVICE="notionless"
DOMAIN="oss.naridon.com"
ZONE_ID="Z03845791SUWSZWYLX4SI"   # naridon.com
CERT_NAME="notionless-oss"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> 1/6  Ensure container service '$SERVICE' exists ($REGION, nano)"
if ! aws lightsail get-container-services --region "$REGION" \
      --service-name "$SERVICE" >/dev/null 2>&1; then
  aws lightsail create-container-service --region "$REGION" \
    --service-name "$SERVICE" --power nano --scale 1
fi
echo "    waiting for service to be deploy-ready (READY or RUNNING)..."
# A brand-new service settles at READY; one with an active deployment sits at
# RUNNING. Both accept a new deployment — only PENDING/UPDATING/DEPLOYING don't.
until case "$(aws lightsail get-container-services --region "$REGION" \
      --service-name "$SERVICE" --query 'containerServices[0].state' \
      --output text)" in READY|RUNNING) true;; *) false;; esac; do sleep 10; done

echo "==> 2/6  Build + push relay image (linux/amd64 — Lightsail requirement)"
docker build --platform linux/amd64 -t notionless-backend ./backend
BACKEND_IMG=$(aws lightsail push-container-image --region "$REGION" \
  --service-name "$SERVICE" --label backend --image notionless-backend:latest 2>&1 \
  | grep -oE ":$SERVICE\.backend\.[0-9]+" | tail -1)
echo "    backend=$BACKEND_IMG"
if [ -z "$BACKEND_IMG" ]; then
  echo "    !! image push failed (empty ref) — aborting." >&2; exit 1
fi

echo "==> 3/6  Render deployment from lightsail-deployment.json"
TMP=$(mktemp)
sed -e "s#:$SERVICE.backend.latest#$BACKEND_IMG#" \
    lightsail-deployment.json > "$TMP"

echo "==> 4/6  Deploy"
# Remember the currently-live deployment version so we can tell when the NEW one
# actually goes live (the service stays RUNNING throughout, so polling state
# alone races — currentDeployment.version only flips once the new one is ACTIVE).
PREV_VER=$(aws lightsail get-container-services --region "$REGION" \
  --service-name "$SERVICE" --query 'containerServices[0].currentDeployment.version' \
  --output text 2>/dev/null || echo "None")
aws lightsail create-container-service-deployment --region "$REGION" \
  --service-name "$SERVICE" --cli-input-json "file://$TMP"
rm -f "$TMP"

echo "    waiting for the new deployment (was v$PREV_VER) to go live..."
while true; do
  read -r STATE CURVER < <(aws lightsail get-container-services --region "$REGION" \
    --service-name "$SERVICE" \
    --query 'containerServices[0].[state,currentDeployment.version]' --output text)
  if [ "$STATE" = "RUNNING" ] && [ "$CURVER" != "$PREV_VER" ]; then break; fi
  NEXT_STATE=$(aws lightsail get-container-services --region "$REGION" \
    --service-name "$SERVICE" --query 'containerServices[0].nextDeployment.state' \
    --output text 2>/dev/null || echo "None")
  if [ "$NEXT_STATE" = "FAILED" ]; then
    echo "    !! new deployment FAILED — check container logs:" >&2
    echo "       aws lightsail get-container-log --region $REGION --service-name $SERVICE --container-name backend" >&2
    exit 1
  fi
  sleep 15
done
echo "    deployment v$CURVER is live."

echo "==> 5/6  Attach custom domain $DOMAIN (cert $CERT_NAME)"
CERT_STATUS=$(aws lightsail get-certificates --region "$REGION" \
  --certificate-name "$CERT_NAME" \
  --query 'certificates[0].certificateDetail.status' --output text)
if [ "$CERT_STATUS" != "ISSUED" ]; then
  echo "    !! cert is $CERT_STATUS, not ISSUED — waiting on DNS validation."
  echo "       (validation CNAME is already in Route53; this can take a few min.)"
  echo "       Re-run this script once the cert shows ISSUED."
  exit 1
fi
aws lightsail update-container-service --region "$REGION" \
  --service-name "$SERVICE" \
  --public-domain-names "{\"$CERT_NAME\":[\"$DOMAIN\"]}"

echo "==> 6/6  Point $DOMAIN at the service in Route53"
TARGET=$(aws lightsail get-container-services --region "$REGION" \
  --service-name "$SERVICE" --query 'containerServices[0].url' --output text \
  | sed -E 's#https?://##; s#/$##')
cat > /tmp/oss-cname.json <<JSON
{ "Comment": "oss.naridon.com -> Lightsail notionless relay",
  "Changes": [{ "Action": "UPSERT", "ResourceRecordSet": {
    "Name": "$DOMAIN.", "Type": "CNAME", "TTL": 300,
    "ResourceRecords": [{ "Value": "$TARGET." }] }}] }
JSON
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" \
  --change-batch file:///tmp/oss-cname.json

echo
echo "Done. Relay live shortly at: wss://$DOMAIN/signaling"
echo "Health check:                https://$DOMAIN/health"
