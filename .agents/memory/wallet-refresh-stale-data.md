---
name: Wallet refresh stale data
description: How to preserve and label cached wallet values during React Query refetch failures.
---

When a cached wallet refetch fails, keep the last successful values visible and mark them stale as soon as the first retryable failure occurs. In TanStack Query, `isError` may stay false while automatic retries are pending; `failureCount > 0` exposes that interim failure. A successful retry resets the failure state and removes the warning. Do not treat a wallet summary from a separate account-detail response as a successful load of the dedicated wallet query.

**Why:** Waiting for the terminal error hides the warning during retry delays, even though the displayed data is already known to be old. A separate account-detail snapshot may contain daily values, but it does not prove the dedicated wallet request succeeded.

**How to apply:** For wallet refresh UI, derive freshness from both `isError` and `failureCount`, preserve data from that wallet query itself, and test both initial failure without wallet data and a transient cached-data failure followed by success.
