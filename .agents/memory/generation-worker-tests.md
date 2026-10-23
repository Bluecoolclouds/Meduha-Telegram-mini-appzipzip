---
name: Generation worker tests
description: Avoiding contention between API integration tests and the live generation worker.
---

The API workflow runs a background generation worker against the shared database. Queue-worker integration tests that insert `queued` fixture jobs can race with that live worker.

**Why:** Both production-like workers and test workers claim from the same queue, so a test worker may find no fixture job even though the test inserted it successfully.

**How to apply:** Stop the API workflow before running queue-worker integration tests, then restart it after the test completes.
