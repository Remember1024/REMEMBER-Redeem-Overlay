# 02: Add Overlay WebSocket Heartbeat Watchdog & Polling Fallback

**What to build:**
Ensure the OBS browser source overlay receives and renders channel point redemptions in real time without getting stalled by cloud proxy/Cloud Run timeouts. Implement a client-side heartbeat ping (`{ type: "PING" }`) every 15 seconds with a watchdog reconnect timer in `public/overlay.js`. In addition, add an initial data load via `fetch('/api/overlay-data?token=...')` and a resilient fallback background sync (every 6 seconds) so the overlay always displays the latest redemption immediately even if the WebSocket connection was dropped or blocked.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] `public/overlay.js` sends `{ type: 'PING' }` every 15s to keep proxy connections alive.
- [ ] `public/overlay.js` monitors last received message time and automatically reconnects if no message/pong is received within 30s.
- [ ] `public/overlay.js` performs an initial HTTP fetch to `/api/overlay-data?token=...` on page load for immediate display before WebSocket handshakes finish.
- [ ] `public/overlay.js` includes a lightweight periodic fallback check (every 6s) to ensure OBS stays synchronized even if the WebSocket connection is interrupted.
