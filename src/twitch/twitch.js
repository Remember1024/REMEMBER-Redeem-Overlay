import { EventEmitter } from 'events';
import { config } from '../config.js';
import { twitchOAuth } from './oauth.js';
import { twitchEventSub } from './eventsub.js';
import { userRepo, sessionRepo, authRepo } from '../db/db.js';
import { broadcaster } from '../websocket/broadcaster.js';

export class TwitchMultiUserManager extends EventEmitter {
  constructor() {
    super();
    this.ready = false;
    this.recentLogs = [];
    this.setupListeners();
  }

  addLog(msg) {
    const time = new Date().toLocaleTimeString('th-TH');
    this.recentLogs.unshift(`[${time}] ${msg}`);
    if (this.recentLogs.length > 50) this.recentLogs.pop();
    console.log(`[Twitch Multi-User] ${msg}`);
  }

  setupListeners() {
    // Handle incoming Channel Points Redemption
    twitchEventSub.on('redemption', ({ broadcasterId, redemption }) => {
      const user = userRepo.findUserById(broadcasterId);
      if (!user) {
        this.addLog(`⚠️ ได้รับแต้มจาก broadcasterId=${broadcasterId} แต่ไม่พบ user ในฐานข้อมูล`);
        return;
      }

      // Check User's Custom Whitelist
      let whitelist = [];
      try {
        whitelist = JSON.parse(user.whitelist_words || '[]');
      } catch {}

      const cleanReward = String(redemption.rewardTitle || '').trim().toLowerCase();
      // Match if whitelist is empty OR exact/substring match
      const isAllowed = whitelist.length === 0 || whitelist.some((w) => {
        const cleanW = String(w).trim().toLowerCase();
        return cleanReward === cleanW || cleanReward.includes(cleanW) || cleanW.includes(cleanReward);
      });

      if (!isAllowed) {
        this.addLog(`⚠️ ข้ามแต้ม "${redemption.rewardTitle}" ของ @${user.login} (ไม่ตรงกับ Whitelist: ${JSON.stringify(whitelist)})`);
        broadcaster.broadcastToUser(broadcasterId, 'SKIPPED_REDEMPTION', {
          rewardTitle: redemption.rewardTitle,
          displayName: redemption.displayName,
          whitelist,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      this.addLog(`🎉 รับแต้มสำเร็จ @${user.login}: ${redemption.displayName} แลก "${redemption.rewardTitle}"`);
      const formatted = sessionRepo.setLatestRedemption(broadcasterId, redemption);
      broadcaster.broadcastRedemption(broadcasterId, formatted);
    });

    // Handle Stream Online
    twitchEventSub.on('stream_online', ({ broadcasterId }) => {
      const user = userRepo.findUserById(broadcasterId);
      if (!user) return;

      const current = sessionRepo.getSession(broadcasterId);
      const recentRedeemAgeMs = current.latestRedemption
        ? Date.now() - new Date(current.latestRedemption.redeemedAt || current.updatedAt).getTime()
        : Infinity;
      const hasRecentRedemption = current.latestRedemption && recentRedeemAgeMs < 10 * 60 * 1000;

      this.addLog(`@${user.login} started streaming.${hasRecentRedemption ? ' Preserving recent 1st redemption.' : ' Resetting session.'}`);
      const session = sessionRepo.startStream(broadcasterId);
      if (!hasRecentRedemption) {
        broadcaster.broadcastClear(broadcasterId, 'stream_started');
      }
      broadcaster.broadcastSessionState(broadcasterId, session);
    });

    // Handle Stream Offline
    twitchEventSub.on('stream_offline', ({ broadcasterId }) => {
      const user = userRepo.findUserById(broadcasterId);
      if (!user) return;

      this.addLog(`@${user.login} stopped streaming. Clearing overlay.`);
      const session = sessionRepo.endStream(broadcasterId);
      broadcaster.broadcastClear(broadcasterId, 'stream_stopped');
      broadcaster.broadcastSessionState(broadcasterId, session);
    });
  }

  async init() {
    if (!config.isTwitchConfigured()) {
      console.warn('[Twitch Multi-User] Twitch Client ID or Secret missing in .env');
      return;
    }
    this.ready = true;
    this.addLog('Subscribing all registered users to Twitch EventSub...');
    await this.subscribeAllUsers();
  }

  async subscribeAllUsers() {
    const users = userRepo.getAllUsers();
    for (const user of users) {
      await this.ensureUserSubscribed(user);
    }
  }

  async ensureUserSubscribed(user) {
    try {
      // Validate or refresh token
      let accessToken = user.access_token;
      const validation = await twitchOAuth.validateToken(accessToken);

      if (!validation.valid || validation.expiresIn < 300) {
        // Token invalid or expiring soon -> refresh
        console.log(`[Twitch Multi-User] Refreshing token for @${user.login}...`);
        const refreshed = await twitchOAuth.refreshAccessToken(user.refresh_token);
        accessToken = refreshed.access_token;
        user.access_token = refreshed.access_token;
        user.refresh_token = refreshed.refresh_token || user.refresh_token;
        user.token_expires_at = Date.now() + (refreshed.expires_in || 3600) * 1000;
        userRepo.upsertUser(user);
      }

      await twitchEventSub.subscribeUser(user);
    } catch (err) {
      console.error(`[Twitch Multi-User] Error subscribing user @${user.login}:`, err.message);
    }
  }

  async handleOAuthCallback(code, state) {
    const stateData = twitchOAuth.validateStateToken(state);
    if (!stateData) {
      throw new Error('Invalid or expired OAuth state token.');
    }

    const tokenData = await twitchOAuth.exchangeCodeForTokens(code, stateData.redirectUri);
    const profile = await twitchOAuth.getUserProfile(tokenData.access_token);

    if (!profile) {
      throw new Error('Failed to retrieve user profile from Twitch.');
    }

    const user = userRepo.upsertUser({
      id: profile.id,
      login: profile.login,
      displayName: profile.display_name,
      profileImageUrl: profile.profile_image_url,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
    });

    // Subscribe immediately in EventSub
    await this.ensureUserSubscribed(user);

    // Create web session token
    const sessionToken = authRepo.createSession(user.id);
    return { user, sessionToken };
  }
}

export const twitchManager = new TwitchMultiUserManager();
