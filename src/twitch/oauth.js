import crypto from 'crypto';
import { config } from '../config.js';

export class TwitchOAuth {
  constructor() {
    this.csrfStates = new Map();
  }

  generateStateToken(data = {}) {
    const state = crypto.randomBytes(24).toString('hex');
    this.csrfStates.set(state, {
      expiresAt: Date.now() + 10 * 60 * 1000,
      ...data,
    });
    this.cleanupStates();
    return state;
  }

  validateStateToken(state) {
    if (!state) return null;
    const entry = this.csrfStates.get(state);
    if (!entry) return null;
    this.csrfStates.delete(state);
    if (Date.now() > entry.expiresAt) return null;
    return entry;
  }

  cleanupStates() {
    const now = Date.now();
    for (const [state, entry] of this.csrfStates.entries()) {
      if (now > entry.expiresAt) {
        this.csrfStates.delete(state);
      }
    }
  }

  getAuthorizationUrl(customRedirectUri) {
    if (!config.twitch.clientId) {
      throw new Error('TWITCH_CLIENT_ID is not configured. Please add TWITCH_CLIENT_ID to .env or Environment Variables.');
    }
    const redirectUri = customRedirectUri || config.twitch.redirectUri;
    const state = this.generateStateToken({ redirectUri });
    const params = new URLSearchParams({
      client_id: config.twitch.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'channel:read:redemptions',
      state,
      force_verify: 'true',
    });

    return {
      url: `https://id.twitch.tv/oauth2/authorize?${params.toString()}`,
      state,
    };
  }

  async exchangeCodeForTokens(code, customRedirectUri) {
    if (!config.twitch.clientId || !config.twitch.clientSecret) {
      throw new Error('Twitch Client ID and Client Secret must be configured.');
    }
    const redirectUri = customRedirectUri || config.twitch.redirectUri;

    const params = new URLSearchParams({
      client_id: config.twitch.clientId,
      client_secret: config.twitch.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });

    const res = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Failed to exchange code: HTTP ${res.status} - ${errBody}`);
    }

    return await res.json();
  }

  async refreshAccessToken(refreshToken) {
    if (!refreshToken) {
      throw new Error('No refresh token provided.');
    }

    const params = new URLSearchParams({
      client_id: config.twitch.clientId,
      client_secret: config.twitch.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    const res = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Failed to refresh token: HTTP ${res.status} - ${errBody}`);
    }

    return await res.json();
  }

  async validateToken(accessToken) {
    if (!accessToken) {
      return { valid: false, reason: 'No access token' };
    }

    try {
      const res = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: {
          Authorization: `OAuth ${accessToken}`,
        },
      });

      if (res.status === 200) {
        const data = await res.json();
        return {
          valid: true,
          clientId: data.client_id,
          login: data.login,
          scopes: data.scopes,
          userId: data.user_id,
          expiresIn: data.expires_in,
        };
      }

      return { valid: false, status: res.status };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  async getUserProfile(accessToken) {
    const res = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Client-Id': config.twitch.clientId,
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch user profile: HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.data?.[0]; // { id, login, display_name, profile_image_url }
  }

  async getAppAccessToken() {
    if (this.appToken && this.appTokenExpiresAt > Date.now() + 60000) {
      return this.appToken;
    }

    const params = new URLSearchParams({
      client_id: config.twitch.clientId,
      client_secret: config.twitch.clientSecret,
      grant_type: 'client_credentials',
    });

    const res = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to get app access token: ${err}`);
    }

    const data = await res.json();
    this.appToken = data.access_token;
    this.appTokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    return this.appToken;
  }
}

export const twitchOAuth = new TwitchOAuth();
