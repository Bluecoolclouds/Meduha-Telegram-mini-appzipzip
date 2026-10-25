---
name: API contracts after merges
description: Generated shared declarations may lag behind merged API source changes.
---

After merging API-contract changes, verify that compiled shared declarations match the current contract before diagnosing missing UI fields. Do not remove valid new UI behavior to satisfy stale declarations.

**Why:** repeated merges in this project left compiled API-client declarations behind otherwise valid merged sources, producing misleading missing-field and missing-hook errors during frontend checks.

**How to apply:** regenerate contracts and rebuild shared libraries before validating affected applications. This is separate from database migrations or changing pricing and generation settings.
