---
name: Generation worker tests
description: Avoiding contention between API integration tests and the live generation worker.
---

The API workflow runs a background generation worker against the shared database. Queue-worker integration tests that insert `queued` fixture jobs can race with that live worker.

**Why:** Both production-like workers and test workers claim from the same queue, so a test worker may find no fixture job even though the test inserted it successfully.

**How to apply:** Stop the API workflow before running queue-worker integration tests, then restart it after the test completes.

Restore shared financial safety settings before deleting test fixtures, and keep restoration independent of cleanup success.

**Why:** an unrelated fixture-deletion error can otherwise skip the rest of a `finally` block and leave global spending enabled or limits changed.

**How to apply:** capture the original settings before a finance integration test, restore them first in cleanup with an ownership guard, then remove fixture data. Use only isolated test accounts and models, never real users or administrator privileges.
