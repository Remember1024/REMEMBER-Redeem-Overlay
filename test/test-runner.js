import assert from 'assert';
import fs from 'fs';
import path from 'path';
import http from 'http';
import WebSocket from 'ws';
import express from 'express';
import { db, userRepo, sessionRepo, authRepo } from '../src/db/db.js';
import { MultiUserBroadcaster } from '../src/websocket/broadcaster.js';

console.log('====================================================');
console.log('  RUNNING MULTI-USER TEST SUITE: REMEMBER Overlay');
console.log('====================================================\n');

let totalTests = 0;
let passedTests = 0;

// Reset test data
db.exec('DELETE FROM auth_sessions; DELETE FROM user_sessions; DELETE FROM users;');

function runTest(description, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ [PASS] ${description}`);
  } catch (err) {
    console.error(`  ✗ [FAIL] ${description}`);
    console.error(`    ${err.message}\n${err.stack}`);
  }
}

async function runAsyncTest(description, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ [PASS] ${description}`);
  } catch (err) {
    console.error(`  ✗ [FAIL] ${description}`);
    console.error(`    ${err.message}\n${err.stack}`);
  }
}

(async () => {
  // Test 1: User creation & isolation
  let user1, user2;
  runTest('Create two independent streamers with unique overlay tokens', () => {
    user1 = userRepo.upsertUser({
      id: 'streamer_101',
      login: 'streamer_one',
      displayName: 'สตรีมเมอร์ 1',
      accessToken: 'token_101',
      refreshToken: 'refresh_101',
    });

    user2 = userRepo.upsertUser({
      id: 'streamer_202',
      login: 'streamer_two',
      displayName: 'StreamerTwo',
      accessToken: 'token_202',
      refreshToken: 'refresh_202',
    });

    assert.ok(user1 && user2);
    assert.notStrictEqual(user1.overlay_token, user2.overlay_token, 'Overlay tokens must be unique');
    assert.strictEqual(user1.badge_text, '👑 1ST REDEEMER');

    const whitelist1 = JSON.parse(user1.whitelist_words);
    assert.deepStrictEqual(whitelist1, []);
  });

  // Test 2: Custom Badge, Colors, Fonts, Sizes, Theme & Custom Card Properties per User
  runTest('Update custom badge text, colors, font family, scale, theme, custom card properties, and whitelist for User 1 without affecting User 2', () => {
    const updatedUser1 = userRepo.updateUserSettings(user1.id, {
      badgeText: '✨ ผู้เปิดพิธี',
      badgeColor: '#c084fc',
      badgeBgColor: 'rgba(192, 132, 252, 0.25)',
      fontFamily: 'Chakra Petch',
      fontSizeScale: 1.2,
      viewerColor: '#fef08a',
      cardTheme: 'midnight',
      cardBgColor: '#022c22',
      cardBgOpacity: 0.85,
      cardBorderColor: '#34d399',
      cardGlowColor: '#10b981',
      cardRadius: '24px',
      whitelistWords: ['รักแรกมันแยกยาก', 'แต้มพิเศษประจำวัน'],
      soundEnabled: false,
    });

    assert.strictEqual(updatedUser1.badge_text, '✨ ผู้เปิดพิธี');
    assert.strictEqual(updatedUser1.badge_color, '#c084fc');
    assert.strictEqual(updatedUser1.badge_bg_color, 'rgba(192, 132, 252, 0.25)');
    assert.strictEqual(updatedUser1.font_family, 'Chakra Petch');
    assert.strictEqual(Number(updatedUser1.font_size_scale), 1.2);
    assert.strictEqual(updatedUser1.viewer_color, '#fef08a');
    assert.strictEqual(updatedUser1.card_theme, 'midnight');
    assert.strictEqual(updatedUser1.card_bg_color, '#022c22');
    assert.strictEqual(Number(updatedUser1.card_bg_opacity), 0.85);
    assert.strictEqual(updatedUser1.card_border_color, '#34d399');
    assert.strictEqual(updatedUser1.card_glow_color, '#10b981');
    assert.strictEqual(updatedUser1.card_radius, '24px');
    assert.strictEqual(updatedUser1.sound_enabled, 0);
    assert.deepStrictEqual(JSON.parse(updatedUser1.whitelist_words), ['รักแรกมันแยกยาก', 'แต้มพิเศษประจำวัน']);

    // Verify User 2 remains untouched
    const freshUser2 = userRepo.findUserById(user2.id);
    assert.strictEqual(freshUser2.badge_text, '👑 1ST REDEEMER');
    assert.strictEqual(freshUser2.font_family, 'Kanit');
    assert.strictEqual(Number(freshUser2.font_size_scale), 1.0);
    assert.strictEqual(freshUser2.card_theme, 'purple');
    assert.strictEqual(freshUser2.card_bg_color, '#1c1030');
    assert.strictEqual(Number(freshUser2.card_bg_opacity), 0.94);
    assert.strictEqual(freshUser2.card_border_color, '#c4b5fd');
    assert.strictEqual(freshUser2.card_glow_color, '#a855f7');
    assert.strictEqual(freshUser2.card_radius, '16px');
  });

  // Test 3: Session Stream Start & 1st Redeemer Order
  runTest('Stream session tracks 1st redeemer and subsequent redeemers correctly', () => {
    sessionRepo.startStream(user1.id);
    const session1 = sessionRepo.getSession(user1.id);
    assert.strictEqual(session1.isStreaming, true);
    assert.strictEqual(session1.redemptionCount, 0);
    assert.strictEqual(session1.latestRedemption, null);

    // 1st redemption
    const redeem1 = sessionRepo.setLatestRedemption(user1.id, {
      id: 'r_01',
      userName: 'viewer1',
      displayName: 'ผู้ชมคนที่หนึ่ง',
      rewardTitle: 'รักแรกมันแยกยาก',
    });
    assert.strictEqual(redeem1.isFirst, true);
    assert.strictEqual(redeem1.order, 1);

    // 2nd redemption replaces 1st, always treated as 1st redeemer badge for the reward
    const redeem2 = sessionRepo.setLatestRedemption(user1.id, {
      id: 'r_02',
      userName: 'viewer2',
      displayName: 'Viewer Two',
      rewardTitle: 'แต้มพิเศษประจำวัน',
    });
    assert.strictEqual(redeem2.isFirst, true);
    assert.strictEqual(redeem2.order, 2);

    const currentSession = sessionRepo.getSession(user1.id);
    assert.strictEqual(currentSession.latestRedemption.id, 'r_02');
  });

  // Test 4: Stream End & Overlay Reset
  runTest('Stopping stream cleans up active session, Reset Overlay clears display without ending stream', () => {
    sessionRepo.resetOverlay(user1.id);
    const afterReset = sessionRepo.getSession(user1.id);
    assert.strictEqual(afterReset.isStreaming, true, 'Stream remains active');
    assert.strictEqual(afterReset.latestRedemption, null, 'Display is cleared');
    assert.strictEqual(afterReset.redemptionCount, 0, 'Redemption count is reset to 0');

    sessionRepo.endStream(user1.id);
    const afterEnd = sessionRepo.getSession(user1.id);
    assert.strictEqual(afterEnd.isStreaming, false, 'Stream is ended');
    assert.strictEqual(afterEnd.latestRedemption, null);
  });

  // Test 5: Regenerating Overlay Token
  runTest('Regenerate overlay token assigns a new unique token', () => {
    const oldToken = userRepo.findUserById(user1.id).overlay_token;
    const newToken = userRepo.regenerateOverlayToken(user1.id);
    assert.notStrictEqual(newToken, oldToken);
    assert.strictEqual(userRepo.findUserByOverlayToken(newToken).id, user1.id);
    assert.strictEqual(userRepo.findUserByOverlayToken(oldToken), undefined);
  });

  // Test 6: Auth Session Token Creation & Retrieval
  runTest('Auth session cookie token creates and retrieves valid user', () => {
    const sessionToken = authRepo.createSession(user1.id);
    assert.ok(sessionToken && sessionToken.length >= 32);

    const userFromSession = authRepo.getUserBySessionToken(sessionToken);
    assert.ok(userFromSession);
    assert.strictEqual(userFromSession.id, user1.id);

    authRepo.deleteSession(sessionToken);
    assert.strictEqual(authRepo.getUserBySessionToken(sessionToken), undefined);
  });

  // Test 7: Multi-User WebSocket Isolation
  await runAsyncTest('WebSocket broadcaster delivers events strictly to the target user overlay', async () => {
    const testApp = express();
    const testServer = http.createServer(testApp);
    const broadcaster = new MultiUserBroadcaster();
    broadcaster.init(testServer);

    await new Promise((r) => testServer.listen(0, '127.0.0.1', r));
    const port = testServer.address().port;

    const freshUser1 = userRepo.findUserById(user1.id);
    const freshUser2 = userRepo.findUserById(user2.id);

    const messagesUser1 = [];
    const messagesUser2 = [];

    // Connect Client 1 with User 1 token
    const client1 = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${freshUser1.overlay_token}`);
    client1.on('message', (d) => messagesUser1.push(JSON.parse(d.toString())));

    // Connect Client 2 with User 2 token
    const client2 = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${freshUser2.overlay_token}`);
    client2.on('message', (d) => messagesUser2.push(JSON.parse(d.toString())));

    await Promise.all([
      new Promise((resolve) => client1.on('open', resolve)),
      new Promise((resolve) => client2.on('open', resolve)),
    ]);

    // Wait for INIT messages
    for (let i = 0; i < 20; i++) {
      if (messagesUser1.length >= 1 && messagesUser2.length >= 1) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.strictEqual(messagesUser1[0].type, 'INIT');
    assert.strictEqual(messagesUser1[0].data.user.id, user1.id);
    assert.strictEqual(messagesUser2[0].type, 'INIT');
    assert.strictEqual(messagesUser2[0].data.user.id, user2.id);

    // Broadcast only to User 1
    broadcaster.broadcastRedemption(user1.id, {
      id: 'target_u1',
      displayName: 'ViewerForU1',
      rewardTitle: 'รักแรกมันแยกยาก',
      isFirst: true,
    });

    for (let i = 0; i < 20; i++) {
      if (messagesUser1.some((m) => m.type === 'REDEMPTION')) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const u1Redeem = messagesUser1.find((m) => m.type === 'REDEMPTION');
    assert.ok(u1Redeem, 'User 1 should receive redemption');
    assert.strictEqual(u1Redeem.data.displayName, 'ViewerForU1');

    // Confirm User 2 did NOT receive User 1's redemption! (Strict Isolation)
    const u2Redeem = messagesUser2.find((m) => m.type === 'REDEMPTION');
    assert.strictEqual(u2Redeem, undefined, 'User 2 must NOT receive User 1 redemptions');

    // Cleanup
    await new Promise((r) => {
      client1.on('close', r);
      client1.terminate();
    });
    await new Promise((r) => {
      client2.on('close', r);
      client2.terminate();
    });
    broadcaster.destroy();
    await new Promise((r) => testServer.close(r));
    await new Promise((r) => setTimeout(r, 100));
  });

  // Test 8: Invalid Token Reject
  await runAsyncTest('WebSocket broadcaster rejects unauthorized connection with invalid token', async () => {
    const testApp = express();
    const testServer = http.createServer(testApp);
    const broadcaster = new MultiUserBroadcaster();
    broadcaster.init(testServer);

    await new Promise((r) => testServer.listen(0, '127.0.0.1', r));
    const port = testServer.address().port;

    const invalidClient = new WebSocket(`ws://127.0.0.1:${port}/ws?token=fake_random_token_999`);
    let closedCode = null;

    invalidClient.on('close', (code) => {
      closedCode = code;
    });

    for (let i = 0; i < 20; i++) {
      if (closedCode !== null) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.strictEqual(closedCode, 4001, 'Invalid token must be rejected with 4001 code');

    broadcaster.destroy();
    await new Promise((r) => testServer.close(r));
    await new Promise((r) => setTimeout(r, 100));
  });

  // Test 9: Preserve 1st redemption when stream.online arrives slightly delayed
  runTest('Preserve 1st redemption when stream starts shortly after viewer redeemed', () => {
    sessionRepo.resetOverlay(user2.id);
    const earlyRedeem = sessionRepo.setLatestRedemption(user2.id, {
      id: 'early_01',
      userName: 'speedy_viewer',
      displayName: 'SpeedyViewer',
      rewardTitle: 'รักแรกมันแยกยาก',
      redeemedAt: new Date().toISOString(),
    });
    assert.strictEqual(earlyRedeem.isFirst, true);

    // Twitch delivers stream.online 1 minute later
    sessionRepo.startStream(user2.id);
    const sessionAfterStart = sessionRepo.getSession(user2.id);
    assert.strictEqual(sessionAfterStart.isStreaming, true);
    assert.ok(sessionAfterStart.latestRedemption, 'Recent redemption should not be wiped');
    assert.strictEqual(sessionAfterStart.latestRedemption.id, 'early_01');
    assert.strictEqual(sessionAfterStart.latestRedemption.isFirst, true);
  });

  console.log('\n====================================================');
  console.log(`  MULTI-USER TEST RESULTS: ${passedTests}/${totalTests} tests passed`);
  console.log('====================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  } else {
    setTimeout(() => process.exit(0), 100);
  }
})();
