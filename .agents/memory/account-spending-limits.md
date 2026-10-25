---
name: Account spending limit semantics
description: Safety defaults and UTC accounting policy for per-account daily credit caps.
---

The shared per-account cap defaults to zero, meaning no new holds until an administrator configures capacity. Active holds from previous days still consume capacity; net settlements count on their UTC settlement day. Releases and refunds restore capacity, with refunds credited to the original settlement day. Lowering the account cap blocks new holds, not completion of already-authorized holds.

**Why:** A pilot budget must fail closed without an invented allowance, and midnight or a settings change must not abandon authorized provider work or allow outstanding holds to escape accounting.

**How to apply:** Preserve these semantics when extending quotas, displaying usage, or changing settlement/refund behavior. All finance transitions and cap updates must remain serialized in the same database transaction-lock domain.

UTC budget-day labels must stay calendar strings (`YYYY-MM-DD`) across the API boundary; describe them with a string pattern rather than OpenAPI `format: date`.

**Why:** The generated response validator coerces date-formatted fields into JavaScript dates. JSON then emits a midnight timestamp instead of the intended calendar label, even when the finance helper returned a plain string.

**How to apply:** For new budget-day response fields, test the real HTTP JSON as well as the finance helper; keep calendar labels distinct from event timestamps.
