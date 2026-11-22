#!/bin/bash
set -e

# ==============================================================================
# REMEMBER Twitch Overlay - Google Compute Engine (e2-micro) Automated Setup
# Always Free Tier 100% Compatible
# ==============================================================================

echo "=========================================================="
echo " Setting up REMEMBER Overlay on Google Compute Engine VM"
echo " (100% Always Free Tier Compatible)"
echo "=========================================================="

CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$CURRENT_DIR"

# 1. Setup 1GB Swap file to prevent OOM during builds/installs on 1GB RAM VM
if [ ! -f /swapfile ]; then
  echo "[1/6] Configuring 1GB Swap space for e2-micro..."
  sudo fallocate -l 1G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=1024
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
else
  echo "[1/6] Swap space already exists. Skipping."
fi

# 2. Install Node.js 24 if missing
if ! command -v node &> /dev/null || [[ "$(node -v)" != v24* && "$(node -v)" != v22* ]]; then
  echo "[2/6] Installing Node.js..."
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "[2/6] Node.js $(node -v) is already installed."
fi

# 3. Install Caddy for automatic HTTPS via Let's Encrypt
if ! command -v caddy &> /dev/null; then
  echo "[3/6] Installing Caddy Web Server for automatic HTTPS..."
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg --yes
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
  sudo apt-get update -y
  sudo apt-get install -y caddy
else
  echo "[3/6] Caddy is already installed."
fi

# 4. Install npm dependencies
echo "[4/6] Installing project dependencies..."
npm ci --omit=dev || npm install --omit=dev

# Check for .env file
if [ ! -f .env ]; then
  echo ""
  echo "⚠️  .env file not found!"
  read -p "Enter TWITCH_CLIENT_ID: " input_client_id
  read -p "Enter TWITCH_CLIENT_SECRET: " input_client_secret

  cat <<EOF > .env
PORT=3000
HOST=127.0.0.1
NODE_ENV=production
TWITCH_CLIENT_ID=${input_client_id}
TWITCH_CLIENT_SECRET=${input_client_secret}
EOF
  echo "Created .env file successfully."
fi

# 5. Detect Public IP & Configure Caddy
echo "[5/6] Detecting VM Public IP..."
PUBLIC_IP=$(curl -s -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip 2>/dev/null || curl -s https://api.ipify.org || echo "")

if [ -z "$PUBLIC_IP" ]; then
  echo "Could not auto-detect public IP. Please enter it manually:"
  read -p "External Public IP: " PUBLIC_IP
fi

DOMAIN="${PUBLIC_IP}.sslip.io"
echo "Configuring automatic HTTPS domain: https://${DOMAIN}"

sudo tee /etc/caddy/Caddyfile > /dev/null <<EOF
${DOMAIN} {
    reverse_proxy 127.0.0.1:3000
}
EOF

sudo systemctl restart caddy
sudo systemctl enable caddy

# 6. Configure systemd service for 24/7 background operation
echo "[6/6] Configuring systemd background service..."
SERVICE_FILE="/etc/systemd/system/remember-overlay.service"

sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=REMEMBER Twitch Overlay Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=${CURRENT_DIR}
ExecStart=$(which node) src/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=127.0.0.1

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable remember-overlay
sudo systemctl restart remember-overlay

echo "=========================================================="
echo " 🎉 Setup Completed Successfully!"
echo " Service is running 24/7 and will auto-restart on reboot."
echo "=========================================================="
echo ""
echo " 🌐 Your Live App URL (HTTPS):"
echo "    https://${DOMAIN}"
echo ""
echo " 🔑 Next Step: Update Twitch Developer Console:"
echo "    1. Go to: https://dev.twitch.tv/console/apps"
echo "    2. Add this OAuth Redirect URL:"
echo "       https://${DOMAIN}/auth/twitch/callback"
echo "    3. Click Save Changes"
echo "=========================================================="

