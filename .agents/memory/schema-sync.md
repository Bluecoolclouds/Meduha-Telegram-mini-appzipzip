---
name: Schema synchronization safety
description: Drizzle single-column primary-key introspection and misleading successful command exits.
---

Use column-level declarations for single-column primary keys rather than a one-column table-level composite-key declaration.

**Why:** PostgreSQL introspection and Drizzle disagreed on the latter representation, causing repeated primary-key replacement warnings even when the constraint name and columns already matched. A noninteractive push printed an interactive-prompt error but still exited successfully, so a chained command did not prove that the schema had been applied.

**How to apply:** inspect schema-push output, not only the exit status. Stop on a destructive warning; never add force to silence it. Compare actual constraints and intended declarations before proceeding, and confirm that newly required columns exist before treating API failures as application bugs.
