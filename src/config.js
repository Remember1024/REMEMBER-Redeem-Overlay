import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables from .env or fallback to .env.example
const envFile = path.join(rootDir, '.env');
const envExampleFile = path.join(rootDir, '.env.example');

if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile });
} else if (fs.existsSync(envExampleFile)) {
  dotenv.config({ path: envExampleFile });
}

const dataDir = process.env.DATA_DIR || path.join(rootDir, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '127.0.0.1',
  twitch: {
    clientId: process.env.TWITCH_CLIENT_ID?.trim() || '',
    clientSecret: process.env.TWITCH_CLIENT_SECRET?.trim() || '',
    redirectUri: process.env.TWITCH_REDIRECT_URI?.trim() || '',
    eventsubWsUrl: 'wss://eventsub.wss.twitch.tv/ws',
  },
  obs: {
    url: process.env.OBS_WS_URL?.trim() || 'ws://127.0.0.1:4455',
    password: process.env.OBS_WS_PASSWORD || '',
  },
  paths: {
    rootDir,
    dataDir,
    sessionFile: path.join(dataDir, 'session.json'),
    tokensFile: path.join(dataDir, 'tokens.json'),
  },
  // Note: Whitelist is now managed per-user in database (user.whitelist_words). Default is empty (allow all rewards).
  defaultWhitelist: [],

  isTwitchConfigured() {
    return Boolean(this.twitch.clientId && this.twitch.clientSecret);
  },
  updateObsConfig(url, password) {
    if (url) this.obs.url = url.trim();
    if (password !== undefined) this.obs.password = password;

    // Persist to .env file
    try {
      const envPath = path.join(this.paths.rootDir, '.env');
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf8');
        if (url) {
          envContent = envContent.replace(/^OBS_WS_URL=.*/m, `OBS_WS_URL=${this.obs.url}`);
        }
        if (password !== undefined) {
          envContent = envContent.replace(/^OBS_WS_PASSWORD=.*/m, `OBS_WS_PASSWORD=${this.obs.password}`);
        }
        fs.writeFileSync(envPath, envContent, 'utf8');
      }
    } catch (err) {
      console.warn('[Config] Could not save updated OBS settings to .env:', err.message);
    }
  },
  updateTwitchConfig(clientId, clientSecret, redirectUri) {
    if (clientId) this.twitch.clientId = clientId.trim();
    if (clientSecret) this.twitch.clientSecret = clientSecret.trim();
    if (redirectUri) this.twitch.redirectUri = redirectUri.trim();
  }
};

