---
name: Genjutsu pricing
description: Pricing rules and compatibility decisions for Genjutsu scenarios.
---

An empty Genjutsu tariff schedule uses the model's existing admin-set fixed price for supported scenario, resolution, and duration choices. A configured schedule prices only exact scenario/resolution/paid-duration matches; never invent a price for a missing cell. Adding tariffs does not enable a model, channel, or spending.

**Why:** The user required existing configured prices to remain valid without fabricated values and required tariff changes to be explicitly managed.

**How to apply:** Preserve the fixed-price fallback for models without a schedule. Keep scheduled pricing opt-in and keep old job prices immutable.
