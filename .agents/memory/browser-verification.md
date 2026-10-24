---
name: Direct browser verification
description: Reliable browser checks: CDP targets, Telegram launch context, and playback timing.
---
When inspecting the running app through Chromium CDP, select a target with `type: "page"` rather than the first target returned.

**Why:** Replit's bundled Chromium may list an extension background page first. Inspecting that target looks like an empty, unloaded app even while the actual app is working.

**How to apply:** Use this rule for direct browser checks when a testing subagent is unavailable; do not interpret an extension target's blank DOM as an application failure.

Authorized Mini App UI tests need both a real server-backed fixture session and matching Telegram SDK launch context. A session cookie alone does not make an ordinary browser an authenticated Mini App.

**Why:** the UI deliberately keeps ordinary browsers in guest mode; tests initially misdiagnosed a valid session as broken.

**How to apply:** provide a test-only Telegram launch context matching the seeded account before page startup. Never weaken app authentication, use real users' sessions, or change the administrator to accommodate a browser test.

Playback fixtures must outlast the test, or loop only in the test browser.

**Why:** a short audio clip ended between automated interactions; clicking again restarted it and looked like a pause failure. A timed browser check confirmed the pause handler worked.

**How to apply:** ensure playback is still active immediately before testing pause, and compare paused state and time within one short measurement rather than across slow tool calls.

For fullscreen viewer checks, emulate safe-area insets with the browser protocol and measure the actual control bounds at the target viewport. If the development feed API is unavailable, isolate UI interaction tests from that failure; report backend errors separately rather than treating a mocked response as a healthy API.

**Why:** the community viewer can render its bundled examples even when the development database is missing a table required by the real feed, and Telegram safe-area padding needs a nonzero viewport inset to verify.

**How to apply:** distinguish viewer behavior from feed/API health. Keep the production and development database untouched during a UI-only check unless schema repair is explicitly in scope.

Use the artifact router for full-stack browser tests, not a direct Vite port without an API proxy.

**Why:** direct Vite can serve HTML for an API request; the typed fetch client may accept that response and show a misleading login state instead of an obvious network error. This previously hid an enabled password-login form in a browser test.

**How to apply:** verify the routed API status alongside the UI. For secret-independent authentication tests, run the real API router with random injected credentials and local Chromium in one process, forwarding browser API requests to that fixture and cleaning only its own sessions.
