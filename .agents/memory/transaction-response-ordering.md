---
name: Transaction response ordering
description: Why mutation success must be sent only after the database transaction commits
---

Send successful mutation responses after awaiting the entire database transaction, not from inside its callback.

**Why:** an audio publication test exposed a race: editing returned “draft” before its transaction committed, and an immediate anonymous media request still observed the old published state.

**How to apply:** return the saved result from transaction callbacks, then send success after the transaction promise resolves. Apply this to publication, withdrawal and edits that affect public access.

For credit operations, a failed HTTP response does not prove that the transaction rolled back. Preserve the operation's idempotency key until success is confirmed and refresh the actual wallet even after an uncertain response.

**Why:** PostgreSQL DATE values reached response validation as JavaScript Date objects rather than calendar strings. A settlement committed correctly but response validation failed afterward; the unchanged cached UI hid the committed balance.

**How to apply:** normalize SQL DATE calendar values without timezone shifts in every service and direct-query response path. Test the full HTTP reserve/settle/replay/refund/release lifecycle and both wallet and global-ledger serialization, not just transaction helpers.
