---
name: Payment provider adapters
description: The intended extension model for payment providers in Meduha.
---

Meduha may use multiple payment providers over time. The user explicitly wants FreeKassa added alongside the prepared YooKassa integration. FreeKassa and YooKassa are different providers; do not substitute one for the other.

**Why:** the user said different payment providers may be used in the future, then repeated that they had supplied FreeKassa code and wanted that provider connected.

**How to apply:** keep plan pricing, order fulfillment, and wallet ledger rules provider-neutral. Add future providers through separate adapters while preserving server-side verification and idempotent monthly credit grants.

Prefer the documented hosted SCI checkout for the initial FreeKassa flow. Do not silently promise direct card/SBP API flows or invent customer emails/method availability.

**Why:** hosted SCI matches the supplied code without requiring real payer IP/email, method-specific onboarding or cross-process monotonically increasing API nonces.

**How to apply:** accept only authenticated merchant notifications for fulfillment. Merchant success redirects are navigation, never evidence of payment. Direct API methods need a separate explicit implementation.
