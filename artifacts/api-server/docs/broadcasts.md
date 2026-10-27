# Telegram broadcasts

The administrator console has a **Рассылки** tab. It saves immutable drafts with
plain text, an optional JPEG/PNG (10 MiB) or MP4 (50 MiB), and up to six HTTPS
link / Mini App buttons. Corrections create a new draft.

## Before publishing

Apply `scripts/ensure-broadcasts.sql` to the deployment database using the normal
schema migration process before starting the new server. This additive,
idempotent migration also appears in the Drizzle schema. It has only been applied
to the development database during implementation; publishing is a separate action.

App Storage and the Telegram bot token must be configured for the environment.
Both Telegram webhook and polling receivers persist private-chat contacts.
The existing Telegram receiver configuration is retained, not changed.

## Consent and sending

`/start` registers a reachable private chat but **does not subscribe it**.
`/subscribe` explicitly enables news; `/stop` disables them. Messages also respect
the account's notification preference and block status, both when taking the
audience snapshot and immediately before sending. Account registration or opening
a Mini App alone is not consent or evidence of a writable Telegram chat.
Existing accounts are not retroactively subscribed.

Save a draft, enter your own Telegram chat ID and send a test. The chat must have
contacted the bot. A temporary administrator does not require a designated owner;
the test recipient is explicit rather than inferred from temporary admin identity.
Successful tests unlock an explicit send confirmation. Tests and mass sends invoke
Telegram for real; automated tests substitute a fake sender and isolated schema.

Media stays private in App Storage. It is sent to Telegram as multipart data on
the first test, and the returned Telegram file ID is reused for subsequent chats.
No public object URLs are created.

## Delivery guarantees

The durable PostgreSQL queue serializes sends across processes with a session
advisory lock, processes at most one message per ~1.1 seconds, and resumes pending
work after restart. Telegram 429 responses defer pending work for its retry delay
and have a bounded attempt count. Repeated campaign start requests do not duplicate
audience rows. Cancellation and sends share the same lock; an already active send
may finish before cancellation.

Telegram has no idempotency key for message sends. Timeouts, ambiguous errors and
interrupted `sending` records become **unknown**, never automatically re-sent.
This deliberately favors avoiding duplicates over claiming exactly-once delivery.
Permanent API rejections become failed; a 403 also marks the contact unreachable.
Sent means the API accepted the message, **not that it was read**.

No schedule, segmentation, albums, rich-text editor, automatic campaign retry,
post editing/deletion in Telegram or media-retention cleanup is included.
Avoid leaving unused large uploads; retention tooling is a follow-up.

## Verification

`pnpm --filter @workspace/api-server run test -- --broadcasts`
runs content/keyboard/media validation, opt-in commands, and isolated database/HTTP
checks of authorization, test gate, repeat starts, queue concurrency, consent
recheck, cancellation and interrupted delivery safety. No real Telegram messages
are sent by those tests.
