---
name: Ads Studio pricing
description: User-selected actual-token billing for Ads Studio and the missing request-level usage contract.
---

The user selected billing “по фактическому” using the provided token formula, not a fixed $0.1071 per generation. Per million tokens: uncached text input $5, cached text input $1.25, text output $10, uncached image input $8, cached image input $2, image output $30. Cached tokens must not also be billed as uncached input.

**Why:** The user explicitly chose actual-usage billing. The official Playground says the initial charge is an estimate reconciled on completion.

**How to apply:** Treat the quote as a preliminary reserve, not a fixed final charge. Verify authenticated per-request token counters or authoritative final billing data before implementing automatic reconciliation. Do not invent usage fields, substitute aggregate analytics, or treat missing usage as zero. A provider-enforced hard cap is a separate budget control, not a mandatory condition for every actual-usage integration. Actual-usage selection does not authorize paid test runs, unlimited debits or bypassing account limits.

The reviewed public status schema and webhook examples do not specify the six token counters or a final charge field. Usage analytics explicitly says it is not a billing record.

**Why:** A price formula alone does not provide the measured quantities needed to settle a particular request correctly.

**How to apply:** Report this specific integration gap rather than repeatedly demanding a provider hard cap or another API key.

The same actual-token billing rule applies to Marketing Studio Flare and Sunburst: an authenticated descriptive estimate confirms the six rates, not the measured quantities or a final amount.

**Why:** Their account-specific estimates state that the initial charge is reconciled on completion, just like Ads Studio. Published per-image ranges cannot substitute for this contract.

**How to apply:** Keep all three blocked until request-level settlement data is verified. For Ads Studio batches, sum actual image charges; do not multiply already aggregated batch usage by batch size. Investigate an existing completed request and its billing record rather than creating a paid probe. See [the cost verification report](../../reports/token-model-cost-verification-2026-10-26.md) for evidence and source links.
