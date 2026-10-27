---
name: Payment provider adapters
description: The intended extension model for payment providers in Meduha.
---

Meduha may use multiple payment providers over time. YooKassa is the first provider for web and Telegram payments; provider-specific authentication and payment verification must remain isolated behind an adapter, and each order records its provider.

**Why:** the user said different payment providers may be used in the future.

**How to apply:** keep plan pricing, order fulfillment, and wallet ledger rules provider-neutral. Add future providers through separate adapters while preserving server-side verification and idempotent monthly credit grants.
