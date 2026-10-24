---
name: Feature CSS isolation
description: Prevent styles from unrelated Meduha features colliding across routed pages and sheets.
---
Use feature-specific CSS namespaces or scope selectors beneath the feature's root. Do not reuse a short generic namespace across unrelated screens or rely on stylesheet import order for isolation.

**Why:** the package chooser initially reused gallery-card class names; gallery CSS changed its backgrounds and moved its headings despite passing TypeScript checks.

**How to apply:** before adding shared-looking class names, search the application for existing selectors. Verify the screen inside the full application, not just an isolated component, so other route styles are included.
