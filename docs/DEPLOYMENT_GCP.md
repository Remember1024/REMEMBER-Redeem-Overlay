# Google Cloud Run Deployment Guide: REMEMBER Twitch Overlay

This guide details how to deploy the REMEMBER Multi-User Twitch Overlay to **Google Cloud Run** using a single instance with persistent Cloud Storage volume for SQLite storage.

---

## 🌟 Key Architecture Requirements on Google Cloud Run

1. **Persistent SQLite Database (`/app/data`)**:
   - Cloud Run containers are stateless by default.
   - We mount a **Google Cloud Storage (GCS) Bucket** as a volume at `/app/data` (via Cloud Run Volume Mounts / Cloud Storage FUSE) so that `app.db` persists across container redeployments and restarts.
2. **Always-On CPU & Min Instances (`--min-instances 1 --cpu-allocation always`)**:
   - The application maintains a persistent outbound WebSocket connection to Twitch EventSub (`wss://eventsub.wss.twitch.tv/ws`).
   - If CPU is throttled during idle periods or if the service scales to 0, the Twitch WebSocket connection would terminate. Setting `--min-instances 1` and `--cpu-allocation always` keeps the connection alive 24/7.
3. **Single Instance (`--max-instances 1`)**:
   - Ensures all user WebSockets and EventSub listeners are centralized on one active instance, preventing SQLite file lock contention across multiple containers.

---

## 🚀 1-Click Deployment Commands

### Prerequisites
- [Google Cloud CLI (`gcloud`)](https://cloud.google.com/sdk/docs/install) installed and logged in (`gcloud auth login`).
- A GCP project with Billing enabled.
- Twitch Developer Application with Client ID & Client Secret.

### Step 1: Set GCP Project & Region
```bash
PROJECT_ID="your-gcp-project-id"
REGION="asia-southeast1" # or us-central1, etc.
SERVICE_NAME="remember-overlay"
BUCKET_NAME="${PROJECT_ID}-remember-db"

gcloud config set project $PROJECT_ID
```

### Step 2: Enable Required APIs
```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com
```

### Step 3: Create GCS Bucket for SQLite Persistence
```bash
# Create bucket for the persistent SQLite database
gcloud storage buckets create gs://${BUCKET_NAME} \
  --location=${REGION} \
  --uniform-bucket-level-access
```

### Step 4: Store Secrets in Secret Manager
```bash
# Add Twitch Client ID
echo -n "your_twitch_client_id" | gcloud secrets create TWITCH_CLIENT_ID --data-file=-

# Add Twitch Client Secret
echo -n "your_twitch_client_secret" | gcloud secrets create TWITCH_CLIENT_SECRET --data-file=-
```

### Step 5: Deploy to Cloud Run with GCS Volume Mount
```bash
gcloud run deploy ${SERVICE_NAME} \
  --source . \
  --region ${REGION} \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1 \
  --cpu-allocation always \
  --memory 512Mi \
  --cpu 1 \
  --execution-environment gen2 \
  --add-volume name=db-volume,type=cloud-storage,bucket=${BUCKET_NAME} \
  --add-volume-mount volume=db-volume,mount-path=/app/data \
  --set-env-vars "NODE_ENV=production,DATA_DIR=/app/data" \
  --set-secrets "TWITCH_CLIENT_ID=TWITCH_CLIENT_ID:latest,TWITCH_CLIENT_SECRET=TWITCH_CLIENT_SECRET:latest"
```

### Step 6: Update Twitch Developer Console
1. Copy the Service URL printed by `gcloud run deploy` (e.g., `https://remember-overlay-xxxxxx.run.app`).
2. Go to your [Twitch Developer Console](https://dev.twitch.tv/console/apps).
3. Under **OAuth Redirect URLs**, add:
   ```text
   https://remember-overlay-xxxxxx.run.app/auth/twitch/callback
   ```
4. Click **Save Changes**.

---

## 🧪 Verification & Health Check

- Open `https://remember-overlay-xxxxxx.run.app/health` to confirm the server and uptime.
- Open `https://remember-overlay-xxxxxx.run.app/` and test Twitch login and OBS Browser Source URL.
