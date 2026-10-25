---
name: Video price basis
description: Decisions about authoritative estimates, administrator conversion rates and approximate video tariffs.
---

Parameter-based video pricing is opt-in. The administrator must explicitly choose the USD-to-credit conversion and the maximum acceptable estimate. Never infer a retail conversion from subscription prices or automatically replace existing fixed prices.

**Why:** The user approved preparing video tariff matrices and calculations without enabling spending or assigning unapproved credit prices.

**How to apply:** Keep pricing preparation separate from activating models, channels or spending. Preserve existing fixed-price behavior unless the administrator explicitly switches pricing modes. See `genjutsu-pricing.md` for the existing empty-matrix fallback rule.

Seedance token-rate tables are references, not exact per-second retail prices. Use the authenticated account's official non-generating estimate for the actual request. Do not assume promotional comparison-table discounts apply to the API account.

**Why:** Resolution labels and output duration alone do not determine billable tokens: actual dimensions and input-video duration matter, and account pricing can differ from advertised comparisons.

**How to apply:** Bind estimates to the account, model, complete parameters, references, idempotency key and pricing configuration. If estimation fails, do not guess a price or submit a generation to discover it.

Do not automatically turn a rate described as “roughly” or “approximately” into an exact credit matrix. Preserve existing manually configured cells when preparing missing tariffs.

**Why:** The full Genjutsu Restyle documentation describes its rate as approximate, unlike the documented motion-transfer and object-swap rates.

**How to apply:** Show approximate rates as references only. Enable automatic matrix preparation only after exact pricing is verified.

For Kling, input limits come from the model's Input Schema, not examples in pricing copy. Keep advertised discounts and unmapped price ranges out of exact billing calculations.

**Why:** The Kling 3.0 Standard pricing pages mention one-second examples and a promotional 50% discount, while both API input schemas require 3–15 seconds. The image-to-video page gives a rate range without verifying how every setting selects a rate.

**How to apply:** Validate the schema's duration limits, show undiscounted rates only as references, and use the complete request's authenticated estimate for exact pricing. Do not invent a sound-to-price mapping.

A successful estimate HTTP response is not necessarily a numerical quote. Some models return a pricing description instead of `usd`; published precision and account quote rounding can also differ.

**Why:** Authenticated price auditing exposed both response forms and small rounded estimates above published photo reference maxima. Treating HTTP 200 as a price or replacing descriptive responses with public table numbers would conceal an unsupported billing contract.

**How to apply:** Check the estimate payload for each endpoint and distinguish numerical quotes from descriptive pricing. Preserve fail-closed behavior, explicitly report reference/rounding mismatches, and do not raise financial limits or invent final token usage while auditing prices.
