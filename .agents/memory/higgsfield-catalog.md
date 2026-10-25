---
name: Higgsfield model catalog
description: How the official Higgsfield API catalog and model schemas are documented.
---

Higgsfield's official API documentation directs developers to the API Console to discover models and their API Reference pages for endpoint schemas. It describes the public OpenAPI document as supplementary, not as the authoritative model catalog; no read-only discovery API is documented there. Some catalog workflows may not expose a verified generation endpoint ID and must not be guessed or imported as models.

Catalog completeness also depends on checking the family and workflow totals published on category pages. If a listing omits those totals, totals disagree with its links, or the schema contains unsupported fields, report the result as partial or unavailable rather than silently dropping entries or constraints.

**Why:** Higgsfield's official `llms.txt` sets this source priority, category totals catch silently omitted model links, and unsupported schema fields can change generation inputs.

**How to apply:** Read official catalog and model-reference pages server-side for refreshes. Distinguish documented workflows from account-specific availability, compare category totals with links, exclude entries without an exact endpoint ID from model import, and never submit a paid generation to discover models.

For photo and video scenarios, use the `open.higgsfield.ai` Explore catalogue, model API Reference pages and Playground modes as the reference. The user's Grok Imagine and AI Influencer links are examples, not a restriction to those two models: discover the other photo models through Explore too. For video coverage, compare the Explore Video catalogue as well as the modes within each model's Playground; a model card alone does not establish support for all its modes. A workflow's catalogue slug is not necessarily its submission endpoint: Product shots, Graphic ads and Marketplace design use Marketing Studio with different official preset IDs.

**Why:** the user explicitly wants coverage beyond the two example links. The official Playground embeds both the input schema and the SDK example, and those workflows share a model endpoint while applying conditional preset/enhancement requirements.

**How to apply:** verify the SDK submission endpoint as well as the input schema; preserve the official workflow preset and conditional reference limits instead of submitting the catalogue slug or silently reducing a workflow to a bare model request. The user's Seedance and Kling video links are examples too, not a restriction of video coverage.

Do not present a single-model alternative as a complete composite workflow. In particular, a generic video-edit endpoint is not Katana, and a text-to-video request is not batch content production or automatic publication.

**Why:** model availability does not implement Meduha's multi-step orchestration. When only separate steps are connected, calling the whole workflow connected would promise behavior that does not exist.

**How to apply:** label individual generation stages and alternatives explicitly; keep the full workflow's limitations visible until its orchestration is actually implemented.

Documentation links can switch between relative paths and same-origin absolute URLs without any change in model availability. Empty discovery after a documentation layout change is not evidence that models disappeared.

**Why:** Official listings switched to absolute URLs while a relative-only reader still fetched the pages successfully but found no endpoints.

**How to apply:** Normalize both link forms, retain strict official-origin checks, and report specific missing-schema or endpoint source pages instead of replacing the catalog with a smaller guessed list.
