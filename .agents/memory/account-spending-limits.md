---
name: Account spending limit semantics
description: Safety defaults and UTC accounting policy for per-account daily credit caps.
---

The shared per-account cap defaults to zero, meaning no new holds until an administrator configures capacity. Active holds from previous days still consume capacity; net settlements count on their UTC settlement day. Releases and refunds restore capacity, with refunds credited to the original settlement day. Lowering the account cap blocks new holds, not completion of already-authorized holds.

**Why:** A pilot budget must fail closed without an invented allowance, and midnight or a settings change must not abandon authorized provider work or allow outstanding holds to escape accounting.

**How to apply:** Preserve these semantics when extending quotas, displaying usage, or changing settlement/refund behavior. All finance transitions and cap updates must remain serialized in the same database transaction-lock domain.
