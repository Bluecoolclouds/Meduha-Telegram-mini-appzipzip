---
name: Wallet refresh stale data
description: How to preserve and label cached wallet values during React Query refetch failures.
---

When a cached wallet refetch fails, keep the last successful values visible and mark them stale as soon as the first retryable failure occurs. In TanStack Query, `isError` may stay false while automatic retries are pending; `failureCount > 0` exposes that interim failure. A successful retry resets the failure state and removes the warning.

**Why:** Waiting for the terminal error hides the warning during retry delays, even though the displayed data is already known to be old.

**How to apply:** For wallet refresh UI, derive freshness from both `isError` and `failureCount`, preserve query data, and test a transient failure followed by a successful retry.
