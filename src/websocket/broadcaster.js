import { WebSocketServer, WebSocket } from 'ws';
import { userRepo, sessionRepo, authRepo } from '../db/db.js';

export class MultiUserBroadcaster {
  constructor() {
    this.wss = null;
    this.userClients = new Map(); // userId -> Set of WebSockets
    this.pingInterval = null;
  }

  init(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      ws.isAlive = true;

      // Extract token from URL query: /ws?token=usr_xxx or cookie
      const url = new URL(req.url, 'http://localhost');
      const overlayToken = url.searchParams.get('token');
      const authSessionToken = url.searchParams.get('auth');

      let user = null;

      if (overlayToken) {
        user = userRepo.findUserByOverlayToken(overlayToken);
      } else if (authSessionToken) {
        user = authRepo.getUserBySessionToken(authSessionToken);
      } else {
        // Check cookie
        const cookieHeader = req.headers.cookie;
        if (cookieHeader) {
          const match = cookieHeader.match(/session_token=([a-zA-Z0-9_-]+)/);
          if (match) {
            user = authRepo.getUserBySessionToken(match[1]);
          }
        }
      }

      if (!user) {
        try {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized: Invalid token' }));
          ws.close(4001, 'Unauthorized');
        } catch {}
        return;
      }

      const userId = user.id;
      ws.userId = userId;

      if (!this.userClients.has(userId)) {
        this.userClients.set(userId, new Set());
      }
      this.userClients.get(userId).add(ws);

      // Send initial state immediately
      const session = sessionRepo.getSession(userId);
      this.sendTo(ws, {
        type: 'INIT',
        data: {
          user: {
            id: user.id,
            login: user.login,
            displayName: user.display_name,
            badgeText: user.badge_text,
            badgeColor: user.badge_color,
            badgeBgColor: user.badge_bg_color || 'rgba(245, 158, 11, 0.22)',
            fontFamily: user.font_family || 'Kanit',
            fontSizeScale: Number(user.font_size_scale) || 1.0,
            viewerColor: user.viewer_color || '#ffffff',
            atColor: user.at_color || user.badge_color || '#fbbf24',
            hashColor: user.hash_color || user.card_border_color || '#c4b5fd',
            rewardColor: user.reward_color || '#ffffff',
            textBorderEnabled: user.text_border_enabled !== null && user.text_border_enabled !== undefined ? Boolean(user.text_border_enabled) : false,
            textBorderColor: user.text_border_color || '#000000',
            textBorderWidth: user.text_border_width || '2px',
            borderEnabled: user.border_enabled !== null && user.border_enabled !== undefined ? Boolean(user.border_enabled) : true,
            bloomEnabled: user.bloom_enabled !== null && user.bloom_enabled !== undefined ? Boolean(user.bloom_enabled) : true,
            shadowEnabled: user.shadow_enabled !== null && user.shadow_enabled !== undefined ? Boolean(user.shadow_enabled) : true,
            cardShadowColor: user.card_shadow_color || '#000000',
            rewardPrefix: user.reward_prefix !== undefined && user.reward_prefix !== null ? user.reward_prefix : '#',
            rewardTextMode: user.reward_text_mode || 'twitch',
            customRewardText: user.custom_reward_text || user.badge_text || '👑 1ST REDEEMER',
            cardTheme: user.card_theme || 'purple',
            cardBgColor: user.card_bg_color || '#1c1030',
            cardBgOpacity: user.card_bg_opacity !== null && user.card_bg_opacity !== undefined ? Number(user.card_bg_opacity) : 0.94,
            cardBorderColor: user.card_border_color || '#c4b5fd',
            cardGlowColor: user.card_glow_color || '#a855f7',
            cardRadius: user.card_radius || '16px',
            soundEnabled: Boolean(user.sound_enabled),
            whitelistWords: JSON.parse(user.whitelist_words || '[]'),
          },
          session,
        },
      });

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (message) => {
        try {
          const parsed = JSON.parse(message);
          if (parsed.type === 'PING') {
            this.sendTo(ws, { type: 'PONG' });
          }
        } catch {}
      });

      ws.on('close', () => {
        const clientSet = this.userClients.get(userId);
        if (clientSet) {
          clientSet.delete(ws);
          if (clientSet.size === 0) {
            this.userClients.delete(userId);
          }
        }
      });

      ws.on('error', (err) => {
        console.error(`[WebSocket] Client error for user ${userId}:`, err.message);
      });
    });

    // Heartbeat check every 25 seconds
    this.pingInterval = setInterval(() => {
      for (const [userId, clientSet] of this.userClients.entries()) {
        for (const ws of clientSet) {
          if (ws.isAlive === false) {
            ws.terminate();
            clientSet.delete(ws);
            continue;
          }
          ws.isAlive = false;
          try {
            ws.ping();
          } catch {
            ws.terminate();
            clientSet.delete(ws);
          }
        }
        if (clientSet.size === 0) {
          this.userClients.delete(userId);
        }
      }
    }, 25000);

    if (this.pingInterval.unref) {
      this.pingInterval.unref();
    }

    console.log('[WebSocket] Multi-user broadcaster initialized on /ws');
  }

  sendTo(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(payload));
      } catch (err) {
        console.error('[WebSocket] Send error:', err.message);
      }
    }
  }

  broadcastToUser(userId, type, data = {}) {
    const clientSet = this.userClients.get(userId);
    if (!clientSet || clientSet.size === 0) return;

    const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
    for (const ws of clientSet) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(message);
        } catch (err) {
          console.error('[WebSocket] Broadcast error:', err.message);
        }
      }
    }
  }

  broadcastRedemption(userId, redemption) {
    this.broadcastToUser(userId, 'REDEMPTION', redemption);
  }

  broadcastClear(userId, reason = 'cleared') {
    this.broadcastToUser(userId, 'CLEAR', { reason });
  }

  broadcastSessionState(userId, session) {
    this.broadcastToUser(userId, 'SESSION_STATE', session);
  }

  broadcastSettingsUpdate(userId, settings) {
    this.broadcastToUser(userId, 'SETTINGS_UPDATED', settings);
  }

  destroy() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.wss) {
      for (const [userId, clientSet] of this.userClients) {
        for (const client of clientSet) {
          try { client.terminate(); } catch {}
        }
      }
      this.userClients.clear();
      this.wss.close();
    }
  }
}

export const broadcaster = new MultiUserBroadcaster();
