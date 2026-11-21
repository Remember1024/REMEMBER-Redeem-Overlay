import WebSocket from 'ws';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { config } from '../config.js';
import { twitchOAuth } from './oauth.js';

export class UserEventSubConnection {
  constructor(user, parent) {
    this.user = user;
    this.parent = parent;
    this.ws = null;
    this.sessionId = null;
    this.keepaliveTimer = null;
    this.keepaliveTimeoutSec = 10;
    this.reconnectTimeout = null;
    this.reconnectAttempts = 0;
    this.maxReconnectDelayMs = 30000;
    this.isExplicitlyClosed = false;
    this.seenMessageIds = new Set();
    this.maxSeenMessages = 500;
  }

  updateUser(user) {
    this.user = user;
  }

  connect(url = config.twitch.eventsubWsUrl) {
    this.clearKeepaliveTimer();
    console.log(`[Twitch EventSub @${this.user.login}] Connecting to ${url}...`);

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      console.error(`[Twitch EventSub @${this.user.login}] WebSocket init failed:`, err.message);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      console.log(`[Twitch EventSub @${this.user.login}] WebSocket connected. Waiting for session_welcome...`);
      this.reconnectAttempts = 0;
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });

    this.ws.on('close', (code, reason) => {
      console.log(`[Twitch EventSub @${this.user.login}] WebSocket closed: ${code} - ${reason?.toString() || 'none'}`);
      this.clearKeepaliveTimer();
      this.sessionId = null;

      if (!this.isExplicitlyClosed) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (err) => {
      console.error(`[Twitch EventSub @${this.user.login}] WebSocket error:`, err.message);
    });
  }

  handleMessage(data) {
    this.resetKeepalive();

    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }

    const { metadata, payload } = message;
    if (!metadata || !metadata.message_type) return;

    // Deduplication check
    if (metadata.message_id) {
      if (this.seenMessageIds.has(metadata.message_id)) return;
      this.seenMessageIds.add(metadata.message_id);
      if (this.seenMessageIds.size > this.maxSeenMessages) {
        const iter = this.seenMessageIds.values();
        for (let i = 0; i < 50; i++) this.seenMessageIds.delete(iter.next().value);
      }
    }

    switch (metadata.message_type) {
      case 'session_welcome':
        this.sessionId = payload.session.id;
        this.keepaliveTimeoutSec = payload.session.keepalive_timeout_seconds || 10;
        this.resetKeepalive();
        console.log(`[Twitch EventSub @${this.user.login}] Ready! Session ID: ${this.sessionId}`);
        this.registerSubscriptions();
        break;

      case 'session_keepalive':
        break;

      case 'session_reconnect':
        this.handleReconnect(payload.session.reconnect_url);
        break;

      case 'notification':
        this.handleNotification(metadata, payload);
        break;

      case 'revocation':
        console.warn(`[Twitch EventSub @${this.user.login}] Subscription revoked:`, payload.subscription?.type);
        break;
    }
  }

  async registerSubscriptions() {
    if (!this.sessionId || !this.user.access_token) return;

    const subscriptions = [
      {
        type: 'channel.channel_points_custom_reward_redemption.add',
        version: '1',
        condition: { broadcaster_user_id: this.user.id },
      },
      {
        type: 'stream.online',
        version: '1',
        condition: { broadcaster_user_id: this.user.id },
      },
      {
        type: 'stream.offline',
        version: '1',
        condition: { broadcaster_user_id: this.user.id },
      },
    ];

    const results = [];
    for (const sub of subscriptions) {
      try {
        const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
          method: 'POST',
          headers: {
            'Client-Id': config.twitch.clientId,
            Authorization: `Bearer ${this.user.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...sub,
            transport: {
              method: 'websocket',
              session_id: this.sessionId,
            },
          }),
        });

        if (res.status === 202 || res.status === 200) {
          console.log(`[Twitch EventSub @${this.user.login}] Successfully subscribed to ${sub.type}`);
          results.push({ type: sub.type, success: true, status: res.status });
        } else if (res.status === 409) {
          console.log(`[Twitch EventSub @${this.user.login}] Already subscribed to ${sub.type}`);
          results.push({ type: sub.type, success: true, status: 409, note: 'already_subscribed' });
        } else {
          const errBody = await res.text();
          console.warn(`[Twitch EventSub @${this.user.login}] Subscription error ${sub.type} (HTTP ${res.status}):`, errBody);
          results.push({ type: sub.type, success: false, status: res.status, error: errBody });
        }
      } catch (err) {
        console.error(`[Twitch EventSub @${this.user.login}] Failed to subscribe to ${sub.type}:`, err.message);
        results.push({ type: sub.type, success: false, error: err.message });
      }
    }
    this.parent.userSubscriptions.set(this.user.id, results);
  }

  handleNotification(metadata, payload) {
    this.parent.handleNotification(metadata, payload);
  }

  handleReconnect(reconnectUrl) {
    console.log(`[Twitch EventSub @${this.user.login}] Reconnecting via ${reconnectUrl}`);
    const oldWs = this.ws;
    try {
      const newWs = new WebSocket(reconnectUrl);
      newWs.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        if (msg.metadata?.message_type === 'session_welcome') {
          try { oldWs?.close(); } catch {}
          this.ws = newWs;
        }
        this.handleMessage(data);
      });
      newWs.on('close', () => this.scheduleReconnect());
      newWs.on('error', () => this.scheduleReconnect());
    } catch {
      this.scheduleReconnect();
    }
  }

  resetKeepalive() {
    this.clearKeepaliveTimer();
    const timeoutMs = (this.keepaliveTimeoutSec + 4) * 1000;
    this.keepaliveTimer = setTimeout(() => {
      console.warn(`[Twitch EventSub @${this.user.login}] Keepalive timeout. Reconnecting...`);
      try { this.ws?.terminate(); } catch {}
      this.scheduleReconnect();
    }, timeoutMs);
  }

  clearKeepaliveTimer() {
    if (this.keepaliveTimer) {
      clearTimeout(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  scheduleReconnect() {
    if (this.isExplicitlyClosed || this.reconnectTimeout) return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelayMs);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }

  close() {
    this.isExplicitlyClosed = true;
    this.clearKeepaliveTimer();
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    try { this.ws?.close(); } catch {}
  }
}

export class TwitchEventSub extends EventEmitter {
  constructor() {
    super();
    this.userConnections = new Map(); // userId -> UserEventSubConnection
    this.userSubscriptions = new Map(); // userId -> Array of subscription status objects
  }

  handleNotification(metadata, payload) {
    const subType = metadata?.subscription_type || metadata?.type;
    const event = payload?.event;
    if (!event) return;

    const broadcasterId = event.broadcaster_user_id;

    if (subType === 'channel.channel_points_custom_reward_redemption.add') {
      const redemption = {
        id: event.id,
        rewardId: event.reward?.id,
        rewardTitle: event.reward?.title || 'Reward',
        rewardCost: event.reward?.cost || 0,
        userId: event.user_id,
        userName: event.user_login,
        displayName: event.user_name || event.user_login,
        userInput: event.user_input || '',
        redeemedAt: event.redeemed_at || new Date().toISOString(),
      };
      this.emit('redemption', { broadcasterId, redemption });
    } else if (subType === 'stream.online') {
      console.log(`[Twitch EventSub] Stream ONLINE for broadcaster ${broadcasterId}`);
      this.emit('stream_online', { broadcasterId, startedAt: event.started_at });
    } else if (subType === 'stream.offline') {
      console.log(`[Twitch EventSub] Stream OFFLINE for broadcaster ${broadcasterId}`);
      this.emit('stream_offline', { broadcasterId });
    }
  }

  handleWebhook(req, res) {
    const messageId = req.headers['twitch-eventsub-message-id'];
    const messageTimestamp = req.headers['twitch-eventsub-message-timestamp'];
    const messageSignature = req.headers['twitch-eventsub-message-signature'];
    const messageType = req.headers['twitch-eventsub-message-type'];

    if (!messageId || !messageTimestamp || !messageSignature || !messageType) {
      return res.status(400).send('Bad Request: Missing Twitch EventSub headers');
    }

    // Verify timestamp to prevent replay attacks (< 10 minutes)
    const current = Math.floor(Date.now() / 1000);
    const messageTime = Math.floor(new Date(messageTimestamp).getTime() / 1000);
    if (isNaN(messageTime) || Math.abs(current - messageTime) > 600) {
      return res.status(403).send('Forbidden: Message timestamp too old or invalid');
    }

    // Verify HMAC-SHA256 signature
    const secret = config.twitch.webhookSecret;
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
    const message = messageId + messageTimestamp + rawBody;
    const expectedSignature = 'sha256=' + crypto.createHmac('sha256', secret).update(message).digest('hex');

    try {
      const sigBuf = Buffer.from(messageSignature);
      const expBuf = Buffer.from(expectedSignature);
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        console.warn('[Twitch EventSub Webhook] Invalid signature received');
        return res.status(403).send('Forbidden: Invalid signature');
      }
    } catch (err) {
      console.warn('[Twitch EventSub Webhook] Error comparing signatures:', err.message);
      return res.status(403).send('Forbidden: Signature verification error');
    }

    // Process message type
    if (messageType === 'webhook_callback_verification') {
      console.log('[Twitch EventSub Webhook] Callback URL verified successfully by Twitch!');
      return res.status(200).send(req.body.challenge);
    }

    if (messageType === 'notification') {
      this.handleNotification(req.body.subscription, req.body);
      return res.status(204).end();
    }

    if (messageType === 'revocation') {
      console.warn('[Twitch EventSub Webhook] Subscription revoked:', req.body.subscription?.type);
      return res.status(204).end();
    }

    return res.status(200).end();
  }

  async subscribeUserWebhook(user, callbackUrl) {
    if (!user || !user.id || !callbackUrl) return;

    try {
      const appToken = await twitchOAuth.getAppAccessToken();
      const subscriptions = [
        {
          type: 'channel.channel_points_custom_reward_redemption.add',
          version: '1',
          condition: { broadcaster_user_id: user.id },
        },
        {
          type: 'stream.online',
          version: '1',
          condition: { broadcaster_user_id: user.id },
        },
        {
          type: 'stream.offline',
          version: '1',
          condition: { broadcaster_user_id: user.id },
        },
      ];

      const results = [];
      for (const sub of subscriptions) {
        try {
          const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
            method: 'POST',
            headers: {
              'Client-Id': config.twitch.clientId,
              Authorization: `Bearer ${appToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...sub,
              transport: {
                method: 'webhook',
                callback: callbackUrl,
                secret: config.twitch.webhookSecret,
              },
            }),
          });

          if (res.status === 202 || res.status === 200) {
            console.log(`[Twitch Webhook @${user.login}] Subscribed to ${sub.type} (Callback: ${callbackUrl})`);
            results.push({ type: sub.type, success: true, status: res.status, transport: 'webhook' });
          } else if (res.status === 409) {
            console.log(`[Twitch Webhook @${user.login}] Already subscribed to ${sub.type}`);
            results.push({ type: sub.type, success: true, status: 409, note: 'already_subscribed', transport: 'webhook' });
          } else {
            const errBody = await res.text();
            console.warn(`[Twitch Webhook @${user.login}] Subscription error ${sub.type} (HTTP ${res.status}):`, errBody);
            results.push({ type: sub.type, success: false, status: res.status, error: errBody, transport: 'webhook' });
          }
        } catch (err) {
          console.error(`[Twitch Webhook @${user.login}] Fetch failed for ${sub.type}:`, err.message);
          results.push({ type: sub.type, success: false, error: err.message, transport: 'webhook' });
        }
      }
      this.userSubscriptions.set(user.id, results);
    } catch (err) {
      console.error(`[Twitch Webhook @${user.login}] Could not subscribe webhook:`, err.message);
    }
  }

  async subscribeUser(user) {
    if (!user || !user.access_token) return;

    let conn = this.userConnections.get(user.id);
    if (!conn) {
      conn = new UserEventSubConnection(user, this);
      this.userConnections.set(user.id, conn);
      conn.connect();
    } else {
      conn.updateUser(user);
      if (!conn.ws || conn.ws.readyState !== WebSocket.OPEN) {
        conn.connect();
      } else {
        await conn.registerSubscriptions();
      }
    }
  }

  unsubscribeUser(userId) {
    const conn = this.userConnections.get(userId);
    if (conn) {
      conn.close();
      this.userConnections.delete(userId);
      this.userSubscriptions.delete(userId);
    }
  }

  stop() {
    for (const conn of this.userConnections.values()) {
      conn.close();
    }
    this.userConnections.clear();
  }
}

export const twitchEventSub = new TwitchEventSub();
