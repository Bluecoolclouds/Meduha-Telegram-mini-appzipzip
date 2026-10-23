---
name: Playwright on Replit
description: Replit Nix runtime details for launching Chromium from Playwright.
---
Playwright's downloaded Chromium binary does not automatically resolve system libraries from Replit's Nix environment in shell-launched tests. Use Replit's Nix-aware Chromium executable and pass the Replit runtime loader through `LD_AUDIT`; keep its browser system libraries available.

**Why:** Installing Chromium's Linux dependencies and restarting the web workflow did not make the downloaded browser start from the shell; the app's bundled Chromium worked when launched with Replit's runtime loader.

**How to apply:** When maintaining Playwright on Replit, preserve the environment-specific executable and loader setup in the Playwright configuration. Use Playwright's downloaded browser in other environments.

Do not infer missing H.264 support solely from a failed generated MP4 fixture; the encoding profile, pixel format and container also matter.

**Why:** generated MP4 fixtures failed metadata loading, but real provider H.264/yuv420p examples subsequently decoded and played in the same testing runtime. A successful `ffprobe` inspection alone does not establish browser compatibility.

**How to apply:** inspect the actual encoding and test the real media before blaming the browser runtime. WebM remains a useful fixture alternative; keep production MP4 support and explicitly report any unverified formats.
