import http from 'http';
import path from 'path';
import express from 'express';
import { config } from './config.js';
import { userRepo, sessionRepo, authRepo } from './db/db.js';
import { twitchOAuth } from './twitch/oauth.js';
import { twitchManager } from './twitch/twitch.js';
import { twitchEventSub } from './twitch/eventsub.js';
import { broadcaster } from './websocket/broadcaster.js';

const app = express();
const server = http.createServer(app);

// Trust proxy for Google Cloud / Reverse Proxies (enables secure cookies and correct client IP)
app.set('trust proxy', 1);

// Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Allow /overlay and /overlay.html to be embedded in OBS Studio / browser sources
  if (req.path.startsWith('/overlay')) {
    res.setHeader('Content-Security-Policy', "frame-ancestors *;");
  } else {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }
  next();
});

// Simple lightweight cookie parser
app.use((req, res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    cookieHeader.split(';').forEach((cookie) => {
      const parts = cookie.split('=');
      if (parts.length === 2) {
        req.cookies[parts[0].trim()] = decodeURIComponent(parts[1].trim());
      }
    });
  }
  next();
});

// Middleware (capture raw body for Twitch Webhook HMAC signature verification)
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

// Auth middleware
const requireAuth = (req, res, next) => {
  const token = req.cookies.session_token;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Please log in with Twitch' });
  }

  const user = authRepo.getUserBySessionToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Session expired. Please log in again' });
  }

  req.user = user;
  next();
};

const optionalAuth = (req, res, next) => {
  const token = req.cookies.session_token;
  if (token) {
    req.user = authRepo.getUserBySessionToken(token);
  }
  next();
};

// Static files
const publicDir = path.join(config.paths.rootDir, 'public');
app.use(express.static(publicDir));

// WebSocket Broadcaster
broadcaster.init(server);

// --- Routes ---

// Main page
app.get('/', optionalAuth, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Health check endpoint for UptimeRobot / Keep-alive monitors
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Diagnostic endpoint to debug EventSub, active users, and recent redemptions
app.get('/api/debug-status', optionalAuth, (req, res) => {
  const isLoopback = req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::1' || req.socket.remoteAddress === '::ffff:127.0.0.1';
  if (!isLoopback && !req.user && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized: Debug status requires authentication in production' });
  }

  const users = userRepo.getAllUsers().map(u => {
    const conn = twitchEventSub.userConnections?.get(u.id);
    return {
      id: u.id,
      login: u.login,
      displayName: u.display_name,
      overlayTokenPrefix: u.overlay_token ? u.overlay_token.substring(0, 10) + '...' : null,
      tokenExpiresInSec: Math.round((u.token_expires_at - Date.now()) / 1000),
      whitelistWords: JSON.parse(u.whitelist_words || '[]'),
      subscriptions: twitchEventSub.userSubscriptions?.get(u.id) || 'not_attempted_yet',
      eventSubConnected: Boolean(conn?.ws && conn.ws.readyState === 1),
      sessionId: conn?.sessionId || null,
    };
  });

  res.json({
    status: 'ok',
    serverTime: new Date().toISOString(),
    eventSub: {
      mode: config.twitch.webhookCallbackUrl ? 'webhook' : 'websocket',
      webhookCallbackUrl: config.twitch.webhookCallbackUrl || null,
      activeConnections: twitchEventSub.userConnections ? twitchEventSub.userConnections.size : 0,
      connectedUsers: Array.from(twitchEventSub.userConnections?.keys() || []),
    },
    userCount: users.length,
    users,
    recentLogs: twitchManager.recentLogs || [],
  });
});

// Twitch EventSub Webhook Callback (Twitch triggers this when rewards are redeemed)
app.post('/api/eventsub/callback', (req, res) => {
  twitchEventSub.handleWebhook(req, res);
});

// Overlay page
app.get('/overlay', (req, res) => {
  res.sendFile(path.join(publicDir, 'overlay.html'));
});

// 1. Twitch OAuth Login Initiation
app.get('/auth/twitch/login', (req, res) => {
  try {
    const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
    const host = req.get('host') || 'localhost:3000';
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');

    // Automatically determine redirect URI based on the actual domain being visited
    let redirectUri;
    if (config.twitch.redirectUri && !config.twitch.redirectUri.includes('onrender.com') && !config.twitch.redirectUri.includes('localhost')) {
      redirectUri = config.twitch.redirectUri;
    } else {
      redirectUri = `${isLocal ? 'http' : proto}://${host}/auth/twitch/callback`;
    }

    console.log(`[Twitch OAuth Login] User host: "${host}", sending redirect_uri: "${redirectUri}"`);

    const { url } = twitchOAuth.getAuthorizationUrl(redirectUri);
    res.redirect(url);
  } catch (err) {
    res.status(500).send(`<h3>Twitch Login Error</h3><p>${err.message}</p>`);
  }
});

// Local Dev Mock Login (Quick test without Twitch credentials - disabled in production)
app.get('/auth/dev-login', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).send('Dev login is disabled in production');
  }

  const remoteIp = req.socket.remoteAddress;
  const isLoopback = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
  if (!isLoopback) {
    return res.status(403).send('Dev login only allowed from localhost loopback interface');
  }

  const devUser = userRepo.upsertUser({
    id: 'local_dev_user',
    login: 'streamer_dev',
    displayName: 'สตรีมเมอร์ (Dev Test)',
    profileImageUrl: 'https://static-cdn.jtvnw.net/user-default-pictures-uv/75305d54-c7cc-40d1-bbbb-6a3f15440b54-profile_image-70x70.png',
    accessToken: 'mock_token',
    refreshToken: 'mock_refresh',
    tokenExpiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
  });

  const isSecure = req.secure || req.get('x-forwarded-proto') === 'https' || process.env.NODE_ENV === 'production';
  const secureFlag = isSecure ? '; Secure' : '';
  const sessionToken = authRepo.createSession(devUser.id);
  res.setHeader(
    'Set-Cookie',
    `session_token=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${secureFlag}`
  );

  res.redirect('/?auth=success');
});

// 2. Twitch OAuth Callback (supports both /auth/twitch/callback and /api/auth/callback/twitch)
const handleTwitchCallback = async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error(`[Twitch OAuth Error] ${error}: ${error_description}`);
    return res.redirect(`/?error=${encodeURIComponent(error_description || error)}`);
  }

  if (!code || !state) {
    return res.redirect('/?error=Missing+code+or+state');
  }

  try {
    const { sessionToken } = await twitchManager.handleOAuthCallback(code, state);

    const isSecure = req.secure || req.get('x-forwarded-proto') === 'https' || process.env.NODE_ENV === 'production';
    const secureFlag = isSecure ? '; Secure' : '';

    // Set secure HTTP-only cookie
    res.setHeader(
      'Set-Cookie',
      `session_token=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${secureFlag}`
    );

    res.redirect('/?auth=success');
  } catch (err) {
    console.error('[OAuth Callback Error]:', err.message);
    res.redirect(`/?error=${encodeURIComponent(err.message)}`);
  }
};

app.get('/auth/twitch/callback', handleTwitchCallback);
app.get('/api/auth/callback/twitch', handleTwitchCallback);

// 3. Logout
app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies.session_token;
  if (token) authRepo.deleteSession(token);

  const isSecure = req.secure || req.get('x-forwarded-proto') === 'https' || process.env.NODE_ENV === 'production';
  const secureFlag = isSecure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`);
  res.json({ success: true });
});

// 4. Get Current User & Status
app.get('/api/me', requireAuth, (req, res) => {
  const user = userRepo.findUserById(req.user.id);
  const session = sessionRepo.getSession(req.user.id);

  let whitelistWords = [];
  try {
    whitelistWords = JSON.parse(user.whitelist_words || '[]');
  } catch {}

  res.json({
    user: {
      id: user.id,
      login: user.login,
      displayName: user.display_name,
      profileImageUrl: user.profile_image_url,
      overlayToken: user.overlay_token,
      badgeText: user.badge_text,
      badgeColor: user.badge_color,
      badgeBgColor: user.badge_bg_color || 'rgba(245, 158, 11, 0.22)',
      fontFamily: user.font_family || 'Kanit',
      fontSizeScale: Number(user.font_size_scale) || 1.0,
      viewerColor: user.viewer_color || '#ffffff',
      atColor: user.at_color || user.badge_color || '#fbbf24',
      hashColor: user.hash_color || user.card_border_color || '#c4b5fd',
      rewardColor: user.reward_color || '#ffffff',
      borderEnabled: user.border_enabled !== null && user.border_enabled !== undefined ? Boolean(user.border_enabled) : true,
      bloomEnabled: user.bloom_enabled !== null && user.bloom_enabled !== undefined ? Boolean(user.bloom_enabled) : true,
      shadowEnabled: user.shadow_enabled !== null && user.shadow_enabled !== undefined ? Boolean(user.shadow_enabled) : true,
      cardShadowColor: user.card_shadow_color || '#000000',
      cardTheme: user.card_theme || 'purple',
      cardBgColor: user.card_bg_color || '#1c1030',
      cardBgOpacity: user.card_bg_opacity !== null && user.card_bg_opacity !== undefined ? Number(user.card_bg_opacity) : 0.94,
      cardBorderColor: user.card_border_color || '#c4b5fd',
      cardGlowColor: user.card_glow_color || '#a855f7',
      cardRadius: user.card_radius || '16px',
      whitelistWords,
      soundEnabled: Boolean(user.sound_enabled),
    },
    session,
  });
});

// 5. Update User Settings (Badge Text, Colors, Fonts, Sizes, Whitelist, Theme, Custom Cards)
app.post('/api/settings', requireAuth, (req, res) => {
  const {
    badgeText,
    badgeColor,
    badgeBgColor,
    fontFamily,
    fontSizeScale,
    viewerColor,
    atColor,
    hashColor,
    rewardColor,
    borderEnabled,
    bloomEnabled,
    shadowEnabled,
    cardShadowColor,
    cardTheme,
    cardBgColor,
    cardBgOpacity,
    cardBorderColor,
    cardGlowColor,
    cardRadius,
    whitelistWords,
    soundEnabled,
  } = req.body;

  const updated = userRepo.updateUserSettings(req.user.id, {
    badgeText,
    badgeColor,
    badgeBgColor,
    fontFamily,
    fontSizeScale,
    viewerColor,
    atColor,
    hashColor,
    rewardColor,
    borderEnabled,
    bloomEnabled,
    shadowEnabled,
    cardShadowColor,
    cardTheme,
    cardBgColor,
    cardBgOpacity,
    cardBorderColor,
    cardGlowColor,
    cardRadius,
    whitelistWords,
    soundEnabled,
  });

  // Broadcast settings update to live overlays
  broadcaster.broadcastSettingsUpdate(req.user.id, {
    badgeText: updated.badge_text,
    badgeColor: updated.badge_color,
    badgeBgColor: updated.badge_bg_color,
    fontFamily: updated.font_family,
    fontSizeScale: Number(updated.font_size_scale) || 1.0,
    viewerColor: updated.viewer_color,
    atColor: updated.at_color || updated.badge_color || '#fbbf24',
    hashColor: updated.hash_color || updated.card_border_color || '#c4b5fd',
    rewardColor: updated.reward_color || '#ffffff',
    borderEnabled: Boolean(updated.border_enabled ?? 1),
    bloomEnabled: Boolean(updated.bloom_enabled ?? 1),
    shadowEnabled: Boolean(updated.shadow_enabled ?? 1),
    cardShadowColor: updated.card_shadow_color || '#000000',
    cardTheme: updated.card_theme,
    cardBgColor: updated.card_bg_color,
    cardBgOpacity: Number(updated.card_bg_opacity) || 0.94,
    cardBorderColor: updated.card_border_color,
    cardGlowColor: updated.card_glow_color,
    cardRadius: updated.card_radius,
    soundEnabled: Boolean(updated.sound_enabled),
  });

  res.json({ success: true, user: updated });
});

// 6. Regenerate Overlay Token
app.post('/api/regenerate-token', requireAuth, (req, res) => {
  const newToken = userRepo.regenerateOverlayToken(req.user.id);
  res.json({ success: true, overlayToken: newToken });
});

// 6.1 Fetch Streamer Custom Rewards from Twitch Helix API
app.get('/api/twitch/custom-rewards', requireAuth, async (req, res) => {
  try {
    const user = userRepo.findUserById(req.user.id);
    if (!user || !user.access_token) {
      return res.status(401).json({ error: 'User token not available' });
    }

    // Refresh token if expired or about to expire (< 120s)
    let accessToken = user.access_token;
    try {
      const validation = await twitchOAuth.validateToken(accessToken);
      if (!validation.valid || validation.expiresIn < 120) {
        const refreshed = await twitchOAuth.refreshAccessToken(user.refresh_token);
        accessToken = refreshed.access_token;
        user.access_token = refreshed.access_token;
        user.refresh_token = refreshed.refresh_token || user.refresh_token;
        user.token_expires_at = Date.now() + (refreshed.expires_in || 3600) * 1000;
        userRepo.upsertUser(user);
      }
    } catch (tokenErr) {
      console.warn(`[Twitch Helix] Token validation warning for @${user.login}:`, tokenErr.message);
    }

    const twitchRes = await fetch(
      `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(user.id)}`,
      {
        headers: {
          'Client-Id': config.twitch.clientId,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (twitchRes.status === 403 || twitchRes.status === 404) {
      // Non-affiliate / non-partner account or channel points disabled
      return res.json({
        success: true,
        isAffiliate: false,
        rewards: [],
        message: 'ช่องนี้อาจยังไม่ได้เป็น Twitch Affiliate/Partner หรือยังไม่ได้เปิดระบบ Channel Points',
      });
    }

    if (!twitchRes.ok) {
      const errText = await twitchRes.text();
      return res.status(twitchRes.status).json({ error: `Twitch API error: ${errText}` });
    }

    const data = await twitchRes.json();
    const rewards = (data.data || []).map((r) => ({
      id: r.id,
      title: r.title,
      cost: r.cost,
      isEnabled: r.is_enabled,
      backgroundColor: r.background_color,
      defaultImage: r.default_image?.url_1x || null,
      customImage: r.image?.url_1x || null,
    }));

    res.json({
      success: true,
      isAffiliate: true,
      rewards,
    });
  } catch (err) {
    console.error('[API Custom Rewards Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 7. Trigger Test Redemption
app.post('/api/test-redemption', requireAuth, (req, res) => {
  const { userName, displayName, rewardTitle } = req.body;
  const user = userRepo.findUserById(req.user.id);

  let whitelist = [];
  try {
    whitelist = JSON.parse(user.whitelist_words || '[]');
  } catch {}

  const finalTitle = rewardTitle || (whitelist.length > 0 ? whitelist[0] : 'รักแรกมันแยกยาก');

  const testData = {
    id: `test_${Date.now()}`,
    rewardId: `test_reward_${Date.now()}`,
    rewardTitle: finalTitle,
    userId: '999999999',
    userName: userName || 'Viewer99',
    displayName: displayName || userName || 'Viewer99',
    userInput: '',
    redeemedAt: new Date().toISOString(),
    isTest: true,
  };

  const formatted = sessionRepo.setLatestRedemption(req.user.id, testData);
  broadcaster.broadcastRedemption(req.user.id, formatted);

  res.json({ success: true, redemption: formatted });
});

// 8. Reset Overlay Display
app.post('/api/reset-overlay', requireAuth, (req, res) => {
  sessionRepo.resetOverlay(req.user.id);
  broadcaster.broadcastClear(req.user.id, 'manual_reset');
  res.json({ success: true });
});

// 9. Public endpoint to verify overlay token & get initial data
app.get('/api/overlay-data', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const user = userRepo.findUserByOverlayToken(token);
  if (!user) return res.status(404).json({ error: 'Invalid overlay token' });

  const session = sessionRepo.getSession(user.id);
  res.json({
    user: {
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
      borderEnabled: user.border_enabled !== null && user.border_enabled !== undefined ? Boolean(user.border_enabled) : true,
      bloomEnabled: user.bloom_enabled !== null && user.bloom_enabled !== undefined ? Boolean(user.bloom_enabled) : true,
      shadowEnabled: user.shadow_enabled !== null && user.shadow_enabled !== undefined ? Boolean(user.shadow_enabled) : true,
      cardShadowColor: user.card_shadow_color || '#000000',
      cardTheme: user.card_theme || 'purple',
      cardBgColor: user.card_bg_color || '#1c1030',
      cardBgOpacity: user.card_bg_opacity !== null && user.card_bg_opacity !== undefined ? Number(user.card_bg_opacity) : 0.94,
      cardBorderColor: user.card_border_color || '#c4b5fd',
      cardGlowColor: user.card_glow_color || '#a855f7',
      cardRadius: user.card_radius || '16px',
      soundEnabled: Boolean(user.sound_enabled),
    },
    session,
  });
});

// Start Server
server.listen(config.port, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`  REMEMBER Multi-User Twitch Overlay Server Running!`);
  console.log(`  Listening on: http://localhost:${config.port}`);
  console.log(`====================================================`);

  twitchManager.init().catch((err) => {
    console.error('[Startup] Twitch Manager init error:', err.message);
  });
});

export { app, server };
