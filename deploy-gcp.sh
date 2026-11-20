#!/bin/bash
set -e

# Configuration
SERVICE_NAME="${SERVICE_NAME:-remember-overlay}"
REGION="${REGION:-asia-southeast1}"

if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
  if [ -z "$PROJECT_ID" ]; then
    echo "Error: PROJECT_ID is not set. Run: export PROJECT_ID=your-project-id"
    exit 1
  fi
fi

BUCKET_NAME="${BUCKET_NAME:-${PROJECT_ID}-remember-db}"

echo "=========================================================="
echo " Deploying REMEMBER Overlay to Google Cloud Run"
echo " Project: $PROJECT_ID"
echo " Region:  $REGION"
echo " Bucket:  $BUCKET_NAME"
echo "=========================================================="

# Check if bucket exists, create if missing
if ! gcloud storage buckets describe "gs://${BUCKET_NAME}" &>/dev/null; then
  echo "Creating persistent GCS bucket: gs://${BUCKET_NAME}..."
  gcloud storage buckets create "gs://${BUCKET_NAME}" --location="${REGION}" --uniform-bucket-level-access
fi

# Deploy service
gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1 \
  --cpu-allocation always \
  --memory 512Mi \
  --cpu 1 \
  --execution-environment gen2 \
  --add-volume "name=db-volume,type=cloud-storage,bucket=${BUCKET_NAME}" \
  --add-volume-mount "volume=db-volume,mount-path=/app/data" \
  --set-env-vars "NODE_ENV=production,DATA_DIR=/app/data"

echo "=========================================================="
echo " Deployment successful!"
echo " Remember to register your Cloud Run URL in Twitch Developer Console:"
echo " https://<your-service-url>/auth/twitch/callback"
echo "=========================================================="
