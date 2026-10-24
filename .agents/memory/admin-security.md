---
name: Explicit administrator designation
description: Owner designation and safe admin testing without claiming or replacing real privileges.
---

Never recover a missing or orphaned administrator by promoting the first, oldest or currently signed-in account. Telegram administrator rights require the owner's explicit designation and a verified Telegram identity.

**Why:** automatic first-account recovery is unsafe for an openly accessible app. An orphaned designation does not prove which of the remaining accounts belongs to the owner.

**How to apply:** fail closed until explicit owner configuration is provided. Browser admin access may be paired from the designated account, but a pairing code must not confer rights to any other identity. Test administrative flows using isolated synthetic identities and injected test authorization, never by replacing the real administrator's designation or borrowing a real user's session.

Restore global test configuration together with its original actor and update timestamp, not just its values.

**Why:** a test cleanup actor can make another fixture's conditional restoration mistake test-owned settings for an unrelated administrator's change and leave spending enabled after cleanup.

**How to apply:** isolate financial test runs from active browser fixtures, preserve configuration provenance, and verify that cleanup removed synthetic accounts and restored the spending switch. Never overwrite a real administrator's intervening configuration.

The owner requested temporary login/password access independent of Telegram designation. This is a separate administrative identity, not a replacement Telegram owner or a user account.

**Why:** the owner needs to enter the existing console before a Telegram administrator is designated, without promoting a real visitor or creating a fake Telegram account.

**How to apply:** retain this explicit server-configured exception when working on admin authorization; never extend it to user APIs or Telegram pairing-code issuance. Use random injected credentials for tests, not the owner's secret.
