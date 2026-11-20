# 03: Protect Early Stream Redemptions from Delayed Stream Online Wipe

**What to build:**
Twitch's `stream.online` webhook event typically arrives with a 1 to 3 minute delay after the streamer clicks "Start Streaming" in OBS. When viewers redeem the "1st" reward during this initial window, the arrival of `stream.online` should not wipe out the active redemption if it occurred within a recent grace period (e.g., within the last 5 minutes).

**Blocked by:** 01: Fix Reset Overlay Redemption Count & 1st Redeemer Detection

**Status:** ready-for-agent

- [ ] When `twitchEventSub` emits `stream_online`, inspect `latest_redemption` age.
- [ ] If a valid redemption occurred within the last 5 minutes, retain `latest_redemption` and keep the current session rather than wiping it clean with `broadcastClear`.
- [ ] If no recent redemption exists, proceed with normal session reset.
- [ ] Test coverage verifies that an immediate pre-stream redemption is not wiped when `stream_online` fires 1 minute later.
