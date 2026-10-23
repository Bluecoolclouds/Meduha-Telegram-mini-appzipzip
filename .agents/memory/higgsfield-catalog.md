---
name: Higgsfield model catalog
description: How the official Higgsfield API catalog and model schemas are documented.
---

Higgsfield's official API documentation directs developers to the API Console to discover models and their API Reference pages for endpoint schemas. It describes the public OpenAPI document as supplementary, not as the authoritative model catalog; no read-only discovery API is documented there. Some catalog workflows may not expose a verified generation endpoint ID and must not be guessed or imported as models.

Catalog completeness also depends on checking the family and workflow totals published on category pages. If a listing omits those totals, totals disagree with its links, or the schema contains unsupported fields, report the result as partial or unavailable rather than silently dropping entries or constraints.

**Why:** Higgsfield's official `llms.txt` sets this source priority, category totals catch silently omitted model links, and unsupported schema fields can change generation inputs.

**How to apply:** Read official catalog and model-reference pages server-side for refreshes. Distinguish documented workflows from account-specific availability, compare category totals with links, exclude entries without an exact endpoint ID from model import, and never submit a paid generation to discover models.

For photo scenarios, the user designated the `open.higgsfield.ai` Playground pages as the reference. A workflow's catalogue slug is not necessarily its submission endpoint: Product shots, Graphic ads and Marketplace design use Marketing Studio with different official preset IDs.

**Why:** the official Playground embeds both the input schema and the SDK example, and those workflows share a model endpoint while applying conditional preset/enhancement requirements.

**How to apply:** verify the SDK submission endpoint as well as the input schema; preserve the official workflow preset and conditional reference limits instead of submitting the catalogue slug or silently reducing a workflow to a bare model request.
