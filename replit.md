# Meduha — Telegram mini app

Meduha is a Russian-language creative Telegram Mini App for photo / video / music ideas. The user selected the classic studio concept and requested light and dark themes with a sun/moon switch. The original mockups and the separate «Глубина» concept remain unchanged as references.

## Current application scope

- Runnable app: `artifacts/meduha`, served at `/`.
- Home, Create, Works and Profile use the approved studio mockup as their visual baseline, with light/dark palettes and a shared floating translucent navigation capsule.
- Guest drafts/settings remain local. Verified Telegram accounts store drafts/settings in PostgreSQL. Local-to-account draft import requires confirmation, preserves local originals and does not overwrite an existing account draft with the same ID. Reference images are previews only and are not retained.
- Automatic Telegram authentication is implemented via server validation of signed `initData`, account creation/restoration, and opaque HttpOnly sessions. The server needs `TELEGRAM_BOT_TOKEN` in Secrets; when absent, login fails explicitly with a configuration notice, never a simulated account. `initDataUnsafe` is not proof of identity.
- Bot commands `/start` and `/help` use the same command handler in development long polling and the production webhook. Development polling runs with the API workflow; it never deletes an existing webhook. Command replies expose a launch button only when the bot has a configured HTTPS Mini App menu.
- Bootstrap loads the verified profile, stored balance, settings, drafts and work metadata. New accounts have zero credits. Photo, Seedance and Genjutsu generation use the configured Higgsfield adapter, durable queue and guarded credit reservations. Live use still requires valid provider credentials, Telegram login, administrator-set prices/limits and enabled spending; account access is not verified. The restored channel and documented catalog start disabled and unpriced, spending is off, and the owner is intentionally not designated yet. Real credit purchasing, Telegram Stars payments, referrals and support are not connected. Do not call drafts/examples generated results or add simulated purchases.

## Run & Operate

- Import setup verified on Node.js 24: dependencies install with the existing lockfile, the development database schema initializes successfully, and all three managed workflows start. Full workspace typechecking and all 33 frontend unit tests pass. The mobile studio renders in guest mode and `/api/healthz` returns HTTP 200. Account-only screens were not verified without Telegram credentials; no imported user records were present in the new development database. The imported motion example's App Storage media is unavailable (`/api/meduha/example-media/motion-poster.jpg` returns 503); other checked public sample media loads. Storage assets must be restored separately, not replaced with simulated user work.
- After importing: run `pnpm install --frozen-lockfile`, then `pnpm --filter @workspace/db run push` to initialize the development database before starting the app. Do not use the schema-push command against production.
- Start the existing managed workflows below; they provide `PORT` and `BASE_PATH`. Do not run a root-level `pnpm dev` or create replacement workflows.
- `pnpm --filter @workspace/api-server run dev` — run through `artifacts/api-server: API Server` (managed port 8080)
- `pnpm --filter @workspace/meduha run dev` — run through `artifacts/meduha: web` (injects PORT and BASE_PATH)
- `pnpm --filter @workspace/api-server run test` — HMAC validation and DB-backed session/account-isolation/draft/settings integration checks; fixture accounts are removed afterward
- `pnpm --filter @workspace/api-server run setup:higgsfield` — idempotently restore the development Higgsfield channel and checked-in public catalog snapshot. New entries are disabled/unpriced; existing prices, limits and enablement are preserved. This also runs after task merge, never at production startup. Add `--refresh` only to deliberately reread public provider documentation.
- Higgsfield shared credentials stay server-side in `higgs_api` (also supported: `HF_API_KEY`, `HF_CREDENTIALS`, `higgs`). Save the complete copied API key as-is; never require the owner to split it or expose it in a client-side field. REST requests send `Authorization: Key <complete key>` without submission retries. Saving a key or importing documentation does not verify account access or approve spending.
- After publishing and obtaining the actual public URL: `node scripts/configure-telegram-bot.mjs --url=https://PUBLISHED-DOMAIN/` configures the Mini App menu and secret-checked `/api/telegram/webhook`; preserves pending updates. Do not use a private preview or development URL.
- `pnpm --filter @workspace/meduha run typecheck` — check the application
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — PostgreSQL connection; `TELEGRAM_BOT_TOKEN` — server-only bot credential for real Telegram login, never VITE-prefixed or in frontend code. The bot must launch this app's HTTPS URL.
- Without `TELEGRAM_BOT_TOKEN`, the web studio runs in explicitly labelled local guest mode; real Telegram login and bot command reception remain unavailable. Add the token through Replit Secrets, never in source code or chat.
- `TELEGRAM_BOT_TRANSPORT`: defaults to `polling` in development and `webhook` in production. Production webhook setup is required for responses after publishing; autoscaling must not depend on a background poller. The bot credential must not be used by a second poller.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM server bundle); tests bundle workspace TypeScript to CJS

## Where things live

- `artifacts/mockup-sandbox/src/components/mockups/meduha/` — the mini app screens (Home, Create, Works, Profile) + `_shared/` chrome and `_group.css` tokens
- `artifacts/mockup-sandbox/public/images/brand/` — user-provided brand assets (mascot, app icon, emotion sheet)
- `artifacts/mockup-sandbox/public/images/meduha/` — generated sample AI outputs for galleries
- `attached_assets/reference-home-dark.png` — the user's own Home-screen reference mock (approved direction)

## Architecture decisions

- Guest drafts must not be silently assigned to a Telegram user: a device can be shared. Keep explicit import confirmation and local originals.
- Balances and account data are server-owned. Errors must not become a false zero balance, a successful save, or a silently authenticated guest.

## Photo studio

- `/create?type=photo` lists verified Higgsfield photo modes; `&photoModel=<catalog-id>` opens model-specific settings. The earlier photo ideas remain at `&ideas=1`.
- Source schemas are saved in `artifacts/api-server/src/lib/photo-catalog.json`. Refresh them with `node scripts/sync-photo-catalog.mjs` (public documentation requests only, no generation). SOUL Standard, SOUL 2 text-to-image and SOUL 2 image-to-image are distinct modes.
- Startup registers missing upstream photo models **disabled and unpriced** in the existing Higgsfield channel, or creates a disabled channel if none exists. It never overwrites administrator prices or switches. Workflows using Marketing Studio share that upstream model's settings and use the official scenario preset.
- Server-only credentials: `HF_API_KEY`, `HF_CREDENTIALS`, `higgs_api`, or the legacy `higgs` secret, containing the complete copied provider credential. Presence/format checks are not proof of successful provider authentication.
- Price is the configured fixed credit price per image multiplied by the requested batch size. The submitted total must match the current price; otherwise generation is rejected for reconfirmation. These are internal credits, not a currency conversion or a promise of provider cost.
- Input images use the existing private upload flow. The server validates ownership and the complete official input schema, including conditional rules, before reserving credits. Source URLs are signed only when the worker submits.
- Photo jobs use the existing durable queue. Ambiguous paid submissions are never automatically retried. Completed files are validated and copied to private App Storage before credits settle. History and download routes require the owner's session; completion never publishes to Community.
- Photo-specific non-billable regression coverage is in `artifacts/api-server/src/routes/meduha-photo.integration.test.ts`. Stop the API workflow before queue integration tests so the live worker cannot claim fixtures.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

- Communicates in Russian, informal; all UI copy in Russian.
- Selected implementation: classic studio with light/dark themes. Keep orange accents and varied jellyfish emotions; do not replace it with «Глубина».
- "Generate images yourself and do whatever is needed" — the user wants autonomy, not questions.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
