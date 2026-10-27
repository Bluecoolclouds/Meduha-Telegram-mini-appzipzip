---
name: Broadcast consent and delivery safety
description: Consent and ambiguous Telegram send handling for Meduha administrator broadcasts.
---

Registering a Meduha account or opening its Mini App does not opt someone into
news. A private-chat `/start` establishes contact; `/subscribe` is the explicit
opt-in. `/stop`, profile notification preferences and account blocks override it.
Do not retroactively subscribe existing accounts.

**Why:** a Mini App session does not prove the bot can message that user, and
marketing must not be inferred from account access.

**How to apply:** preserve consent checks at audience selection and immediately
before delivery. Both webhook and polling entry points must record commands.

Do not claim exactly-once Telegram delivery or automatically retry an uncertain
send. Persist it as unknown; only explicit Telegram rate-limit rejections are
automatically retried within a bound.

**Why:** Telegram send methods do not accept idempotency keys. A timeout or crash
after Telegram accepts a message can otherwise send duplicates on restart.

**How to apply:** retain durable queue state and cross-process serialization.
Require a successful test of the immutable post before mass sending. Temporary
admin tests use an explicit chat recipient, never a fabricated owner identity.
