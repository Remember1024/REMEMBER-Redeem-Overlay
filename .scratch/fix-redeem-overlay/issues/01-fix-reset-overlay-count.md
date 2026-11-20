# 01: Fix Reset Overlay Redemption Count & 1st Redeemer Detection

**What to build:**
When a streamer clicks "Reset Overlay" in the dashboard, reset both `latest_redemption = NULL` and `redemption_count = 0` in SQLite (`user_sessions`). This guarantees that whenever an overlay is cleared (or after a pre-stream test redemption), the very next user who redeems on stream is correctly flagged as `isFirst = true` and rendered with the streamer's custom 1st redeemer badge (`👑 1ST REDEEMER`), rather than degrading to `LATEST`.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] `sessionRepo.resetOverlay(userId)` resets `redemption_count = 0` along with `latest_redemption = NULL`.
- [ ] Subsequent redemption after `resetOverlay` has `order = 1` and `isFirst = true`.
- [ ] Automated regression test in test suite verifies `redemption_count` is 0 and next redemption gets 1st redeemer status.
