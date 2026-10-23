---
name: Higgsfield model catalog
description: How the official Higgsfield API catalog and model schemas are documented.
---

Higgsfield's official API documentation directs developers to the API Console to discover models and their API Reference pages for endpoint schemas. It describes the public OpenAPI document as supplementary, not as the authoritative model catalog; no read-only discovery API is documented there. Some catalog workflows may not expose a verified generation endpoint ID and must not be guessed or imported as models.

Catalog completeness also depends on checking the family and workflow totals published on category pages. If a listing omits those totals, totals disagree with its links, or the schema contains unsupported fields, report the result as partial or unavailable rather than silently dropping entries or constraints.

**Why:** Higgsfield's official `llms.txt` sets this source priority, category totals catch silently omitted model links, and unsupported schema fields can change generation inputs.

**How to apply:** Read official catalog and model-reference pages server-side for refreshes. Distinguish documented workflows from account-specific availability, compare category totals with links, exclude entries without an exact endpoint ID from model import, and never submit a paid generation to discover models.
