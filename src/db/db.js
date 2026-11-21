import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { config } from '../config.js';

const dbDir = config.paths.dataDir;
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'app.db');
export const db = new DatabaseSync(dbPath);

// Enable WAL mode (Write-Ahead Logging) and busy timeout for robust performance & concurrency
try {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');
} catch (err) {
  console.warn('[DB] PRAGMA config warning:', err.message);
}

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    login TEXT NOT NULL,
    display_name TEXT NOT NULL,
    profile_image_url TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at INTEGER NOT NULL,
    overlay_token TEXT UNIQUE NOT NULL,
    badge_text TEXT DEFAULT '👑 1ST REDEEMER',
    badge_color TEXT DEFAULT '#fbbf24',
    badge_bg_color TEXT DEFAULT 'rgba(245, 158, 11, 0.22)',
    font_family TEXT DEFAULT 'Kanit',
    font_size_scale REAL DEFAULT 1.0,
    viewer_color TEXT DEFAULT '#ffffff',
    card_theme TEXT DEFAULT 'purple',
    card_bg_color TEXT DEFAULT '#1c1030',
    card_bg_opacity REAL DEFAULT 0.94,
    card_border_color TEXT DEFAULT '#c4b5fd',
    card_glow_color TEXT DEFAULT '#a855f7',
    card_radius TEXT DEFAULT '16px',
    whitelist_words TEXT DEFAULT '[]',
    sound_enabled INTEGER DEFAULT 1,
    at_color TEXT DEFAULT '#fbbf24',
    hash_color TEXT DEFAULT '#c4b5fd',
    reward_color TEXT DEFAULT '#ffffff',
    border_enabled INTEGER DEFAULT 1,
    bloom_enabled INTEGER DEFAULT 1,
    shadow_enabled INTEGER DEFAULT 1,
    card_shadow_color TEXT DEFAULT '#000000',
    reward_prefix TEXT DEFAULT '#',
    reward_text_mode TEXT DEFAULT 'twitch',
    custom_reward_text TEXT DEFAULT '👑 1ST REDEEMER',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_sessions (
    user_id TEXT PRIMARY KEY,
    session_id TEXT,
    is_streaming INTEGER DEFAULT 0,
    stream_started_at TEXT,
    latest_redemption TEXT,
    redemption_count INTEGER DEFAULT 0,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Safe migrations for newly added columns
try { db.exec("ALTER TABLE users ADD COLUMN badge_bg_color TEXT DEFAULT 'rgba(245, 158, 11, 0.22)';"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN font_family TEXT DEFAULT 'Kanit';"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN font_size_scale REAL DEFAULT 1.0;"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN viewer_color TEXT DEFAULT '#ffffff';"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN card_bg_color TEXT DEFAULT '#1c1030';"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN card_bg_opacity REAL DEFAULT 0.94;"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN card_border_color TEXT DEFAULT '#c4b5fd';"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN card_glow_color TEXT DEFAULT '#a855f7';"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN card_radius TEXT DEFAULT '16px';"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN at_color TEXT DEFAULT '#fbbf24';"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN hash_color TEXT DEFAULT '#c4b5fd';"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN reward_color TEXT DEFAULT '#ffffff';"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN border_enabled INTEGER DEFAULT 1;"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN bloom_enabled INTEGER DEFAULT 1;"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN shadow_enabled INTEGER DEFAULT 1;"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN card_shadow_color TEXT DEFAULT '#000000';"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN reward_prefix TEXT DEFAULT '#';"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN reward_text_mode TEXT DEFAULT 'twitch';"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN custom_reward_text TEXT DEFAULT '👑 1ST REDEEMER';"); } catch {}

// Safe migration: Reset untouched legacy default whitelist to empty ([]) so all rewards are allowed by default
try {
  const legacyDefault = JSON.stringify(['รักแรกมันแยกยาก', 'คนแรกเลยล่ะ', 'กระผมมาเป็นคนแรกเลยนะ']);
  db.prepare(`UPDATE users SET whitelist_words = '[]' WHERE whitelist_words = ?`).run(legacyDefault);
} catch (err) {
  console.warn('[DB Migration] Whitelist migration note:', err.message);
}

export const userRepo = {
  findUserById(id) {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(id);
  },

  findUserByOverlayToken(overlayToken) {
    const stmt = db.prepare('SELECT * FROM users WHERE overlay_token = ?');
    return stmt.get(overlayToken);
  },

  getAllUsers() {
    const stmt = db.prepare('SELECT * FROM users');
    return stmt.all();
  },

  upsertUser(userData) {
    const now = new Date().toISOString();
    const existing = this.findUserById(userData.id);

    if (existing) {
      const stmt = db.prepare(`
        UPDATE users SET
          login = ?,
          display_name = ?,
          profile_image_url = COALESCE(?, profile_image_url),
          access_token = ?,
          refresh_token = ?,
          token_expires_at = ?,
          updated_at = ?
        WHERE id = ?
      `);
      stmt.run(
        userData.login,
        userData.displayName || userData.login,
        userData.profileImageUrl || null,
        userData.accessToken,
        userData.refreshToken,
        userData.tokenExpiresAt || (Date.now() + 3600 * 1000),
        now,
        userData.id
      );
      return this.findUserById(userData.id);
    } else {
      const overlayToken = `usr_${crypto.randomBytes(16).toString('hex')}`;
      const defaultWhitelist = '[]';
      const stmt = db.prepare(`
        INSERT INTO users (
          id, login, display_name, profile_image_url, access_token, refresh_token,
          token_expires_at, overlay_token, badge_text, badge_color, card_theme,
          whitelist_words, sound_enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        userData.id,
        userData.login,
        userData.displayName || userData.login,
        userData.profileImageUrl || '',
        userData.accessToken,
        userData.refreshToken,
        userData.tokenExpiresAt || (Date.now() + 3600 * 1000),
        overlayToken,
        '👑 1ST REDEEMER',
        '#fbbf24',
        'purple',
        defaultWhitelist,
        1,
        now,
        now
      );

      // Create initial stream session
      sessionRepo.initSession(userData.id);
      return this.findUserById(userData.id);
    }
  },

  updateUserSettings(userId, {
    badgeText,
    badgeColor,
    badgeBgColor,
    fontFamily,
    fontSizeScale,
    viewerColor,
    cardTheme,
    cardBgColor,
    cardBgOpacity,
    cardBorderColor,
    cardGlowColor,
    cardRadius,
    whitelistWords,
    soundEnabled,
    atColor,
    hashColor,
    rewardColor,
    borderEnabled,
    bloomEnabled,
    shadowEnabled,
    cardShadowColor,
    rewardPrefix,
    rewardTextMode,
    customRewardText,
  }) {
    const now = new Date().toISOString();
    const cleanWords = Array.isArray(whitelistWords) 
      ? JSON.stringify(whitelistWords.map(w => String(w).trim()).filter(Boolean))
      : undefined;

    const current = this.findUserById(userId);
    if (!current) return null;

    const stmt = db.prepare(`
      UPDATE users SET
        badge_text = COALESCE(?, badge_text),
        badge_color = COALESCE(?, badge_color),
        badge_bg_color = COALESCE(?, badge_bg_color),
        font_family = COALESCE(?, font_family),
        font_size_scale = COALESCE(?, font_size_scale),
        viewer_color = COALESCE(?, viewer_color),
        card_theme = COALESCE(?, card_theme),
        card_bg_color = COALESCE(?, card_bg_color),
        card_bg_opacity = COALESCE(?, card_bg_opacity),
        card_border_color = COALESCE(?, card_border_color),
        card_glow_color = COALESCE(?, card_glow_color),
        card_radius = COALESCE(?, card_radius),
        whitelist_words = COALESCE(?, whitelist_words),
        sound_enabled = COALESCE(?, sound_enabled),
        at_color = COALESCE(?, at_color),
        hash_color = COALESCE(?, hash_color),
        reward_color = COALESCE(?, reward_color),
        border_enabled = COALESCE(?, border_enabled),
        bloom_enabled = COALESCE(?, bloom_enabled),
        shadow_enabled = COALESCE(?, shadow_enabled),
        card_shadow_color = COALESCE(?, card_shadow_color),
        reward_prefix = COALESCE(?, reward_prefix),
        reward_text_mode = COALESCE(?, reward_text_mode),
        custom_reward_text = COALESCE(?, custom_reward_text),
        updated_at = ?
      WHERE id = ?
    `);

    const effectiveAtColor = atColor !== undefined ? String(atColor).trim() : (badgeColor !== undefined ? String(badgeColor).trim() : null);
    const effectiveBadgeColor = badgeColor !== undefined ? String(badgeColor).trim() : effectiveAtColor;

    stmt.run(
      badgeText !== undefined ? String(badgeText).trim() : null,
      effectiveBadgeColor,
      badgeBgColor !== undefined ? String(badgeBgColor).trim() : null,
      fontFamily !== undefined ? String(fontFamily).trim() : null,
      fontSizeScale !== undefined ? Number(fontSizeScale) : null,
      viewerColor !== undefined ? String(viewerColor).trim() : null,
      cardTheme !== undefined ? String(cardTheme).trim() : null,
      cardBgColor !== undefined ? String(cardBgColor).trim() : null,
      cardBgOpacity !== undefined ? Number(cardBgOpacity) : null,
      cardBorderColor !== undefined ? String(cardBorderColor).trim() : null,
      cardGlowColor !== undefined ? String(cardGlowColor).trim() : null,
      cardRadius !== undefined ? String(cardRadius).trim() : null,
      cleanWords !== undefined ? cleanWords : null,
      soundEnabled !== undefined ? (soundEnabled ? 1 : 0) : null,
      effectiveAtColor,
      hashColor !== undefined ? String(hashColor).trim() : null,
      rewardColor !== undefined ? String(rewardColor).trim() : null,
      borderEnabled !== undefined ? (borderEnabled ? 1 : 0) : null,
      bloomEnabled !== undefined ? (bloomEnabled ? 1 : 0) : null,
      shadowEnabled !== undefined ? (shadowEnabled ? 1 : 0) : null,
      cardShadowColor !== undefined ? String(cardShadowColor).trim() : null,
      rewardPrefix !== undefined ? String(rewardPrefix) : null,
      rewardTextMode !== undefined ? String(rewardTextMode).trim() : null,
      customRewardText !== undefined ? String(customRewardText).trim() : (badgeText !== undefined ? String(badgeText).trim() : null),
      now,
      userId
    );

    return this.findUserById(userId);
  },

  regenerateOverlayToken(userId) {
    const newToken = `usr_${crypto.randomBytes(16).toString('hex')}`;
    const stmt = db.prepare('UPDATE users SET overlay_token = ?, updated_at = ? WHERE id = ?');
    stmt.run(newToken, new Date().toISOString(), userId);
    return newToken;
  }
};

export const sessionRepo = {
  getSession(userId) {
    const stmt = db.prepare('SELECT * FROM user_sessions WHERE user_id = ?');
    const row = stmt.get(userId);
    if (!row) return this.initSession(userId);

    return {
      userId: row.user_id,
      sessionId: row.session_id,
      isStreaming: Boolean(row.is_streaming),
      streamStartedAt: row.stream_started_at,
      latestRedemption: row.latest_redemption ? JSON.parse(row.latest_redemption) : null,
      redemptionCount: Number(row.redemption_count) || 0,
      updatedAt: row.updated_at,
    };
  },

  initSession(userId) {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO user_sessions (user_id, session_id, is_streaming, stream_started_at, latest_redemption, redemption_count, updated_at)
      VALUES (?, NULL, 0, NULL, NULL, 0, ?)
    `);
    stmt.run(userId, now);
    return {
      userId,
      sessionId: null,
      isStreaming: false,
      streamStartedAt: null,
      latestRedemption: null,
      redemptionCount: 0,
      updatedAt: now,
    };
  },

  startStream(userId) {
    const current = this.getSession(userId);
    const now = new Date().toISOString();
    const newSessionId = `stream_${Date.now()}`;

    // Grace window: If a redemption happened within the last 10 minutes, preserve it as the stream's 1st redemption!
    const recentRedeemAgeMs = current.latestRedemption
      ? Date.now() - new Date(current.latestRedemption.redeemedAt || current.updatedAt).getTime()
      : Infinity;
    const hasRecentRedemption = current.latestRedemption && recentRedeemAgeMs < 10 * 60 * 1000;

    const stmt = db.prepare(`
      INSERT INTO user_sessions (user_id, session_id, is_streaming, stream_started_at, latest_redemption, redemption_count, updated_at)
      VALUES (?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        session_id = excluded.session_id,
        is_streaming = 1,
        stream_started_at = excluded.stream_started_at,
        latest_redemption = excluded.latest_redemption,
        redemption_count = excluded.redemption_count,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      userId,
      newSessionId,
      now,
      hasRecentRedemption ? JSON.stringify(current.latestRedemption) : null,
      hasRecentRedemption ? current.redemptionCount : 0,
      now
    );
    return this.getSession(userId);
  },

  endStream(userId) {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      UPDATE user_sessions SET
        is_streaming = 0,
        latest_redemption = NULL,
        redemption_count = 0,
        updated_at = ?
      WHERE user_id = ?
    `);
    stmt.run(now, userId);
    return this.getSession(userId);
  },

  setLatestRedemption(userId, redemption) {
    const current = this.getSession(userId);
    const newCount = (current.redemptionCount || 0) + 1;
    // Always mark as 1st redeemer (isFirst: true) because Twitch limits this reward to 1 per stream
    const isFirst = redemption.isFirst !== undefined ? Boolean(redemption.isFirst) : true;

    const formatted = {
      ...redemption,
      isFirst,
      order: newCount,
    };

    const now = new Date().toISOString();
    const stmt = db.prepare(`
      UPDATE user_sessions SET
        latest_redemption = ?,
        redemption_count = ?,
        updated_at = ?
      WHERE user_id = ?
    `);
    stmt.run(JSON.stringify(formatted), newCount, now, userId);
    return formatted;
  },

  resetOverlay(userId) {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      UPDATE user_sessions SET
        latest_redemption = NULL,
        redemption_count = 0,
        updated_at = ?
      WHERE user_id = ?
    `);
    stmt.run(now, userId);
    return this.getSession(userId);
  }
};

export const authRepo = {
  createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    // Session valid for 30 days
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const stmt = db.prepare('INSERT INTO auth_sessions (token, user_id, expires_at) VALUES (?, ?, ?)');
    stmt.run(token, userId, expiresAt);
    return token;
  },

  getUserBySessionToken(token) {
    if (!token) return null;
    const stmt = db.prepare(`
      SELECT users.* FROM auth_sessions
      JOIN users ON auth_sessions.user_id = users.id
      WHERE auth_sessions.token = ? AND auth_sessions.expires_at > ?
    `);
    return stmt.get(token, Date.now());
  },

  deleteSession(token) {
    if (!token) return;
    const stmt = db.prepare('DELETE FROM auth_sessions WHERE token = ?');
    stmt.run(token);
  }
};
