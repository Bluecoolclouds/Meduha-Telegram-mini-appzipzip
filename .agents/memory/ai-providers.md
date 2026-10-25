---
name: AI provider channels
description: APINet is the initial AI gateway; meduha must allow additional gateways later.
---

APINet at https://apinet.cloud is the first AI provider channel for meduha, not the only channel the product may ever use.

**Why:** The user said: «это канал с иишками, их потом больше может быть».

**How to apply:** Keep provider identity separate from model identity and use replaceable server-side adapters. Templates and generation jobs should be able to refer to a provider and its upstream model without coupling the UI to one gateway. Keep credentials server-side and do not treat the presence of a model in a provider catalog as proof its generation endpoint is working.

Administrative channel/model configuration and credit bookkeeping must remain independent of live AI generation.

**Why:** the user explicitly requested the web admin panel and financial-safety stages, but said «попозже рабочие генерации».

**How to apply:** do not launch provider requests, charge payment methods, or imply that saving/enabling a channel verifies connectivity. Credit balances and limits are internal credits, not currency or actual provider spending. Live generation and payment collection require a separate user request.

The requested СБП top-up flow is test-only until the user separately requests real payment integration; package prices are preliminary, not approved commercial pricing.

**Why:** the user asked for «пока чисто тестовая кнопка оплаты через сбп без проверок».

**How to apply:** keep demo completion distinct from confirmed payment. Do not turn a client-side test button into an unverified credit grant or imply a bank payment occurred.

A provider smoke test is separate from enabling paid generation for Mini App users. Disable submission retries when the provider does not offer a verified idempotency contract.

**Why:** the user explicitly authorized one paid Seedance SDK test, not automatic repeat submissions or a finished user-facing tariff. A lost submission response may still represent a paid job.

**How to apply:** preserve disabled catalog defaults until pricing and limits are set deliberately. Never rerun a paid smoke test merely to check an unrelated UI edit. Higgsfield's v2 SDK recognizes completed/failed/nsfw in its polling loop; other terminal statuses can surface as a timeout, which is not proof that no request was charged.

The user approved connecting the three Genjutsu scenarios: motion transfer, object swap and restyle. This supersedes postponing live-generation implementation for these three scenarios, but does not approve invented tariffs, automatic spending enablement or paid smoke tests.

**Why:** the user explicitly selected the three-scenario implementation scope, while no new price or paid-test budget was specified.

**How to apply:** expose only documented fields and real configured availability. Register missing models disabled and unpriced; keep subsequent activation and tariff decisions explicit. Source media uploads are private generation inputs, not permission to publish them in Community.

The user also approved «Каталог, настройки и реальная генерация» for the photo models shown in Higgsfield, using the official SOUL Standard and both SOUL 2 Playground pages as references.

**Why:** the user explicitly chose real photo-generation implementation, not a catalogue-only prototype.

**How to apply:** implement real provider submission for documented photo modes, but do not infer approval for invented credit tariffs, enabling global spending, or billable smoke tests. Keep uploaded references and generated photos private.

The user also approved adding the missing official video models and their modes, with one model card and mode buttons inside, using Higgsfield Explore Video and each model's Playground as the reference.

**Why:** after the catalogue comparison, the user said «добавляй тогда» to that specific proposal.

**How to apply:** implement the documented inputs and real queued submission, not catalogue-only placeholders. Preserve the existing Genjutsu duration-based quotation path; do not bypass it with a fixed-price request. Keep new modes disabled and unpriced until deliberately configured, and do not run billable tests without a separate budget.

Provider-owned character/element IDs are not proof that a Meduha user owns that asset.

**Why:** users share the application's Higgsfield provider account; accepting arbitrary upstream IDs could expose private provider assets across accounts.

**How to apply:** allow owned Meduha uploads as references. Reject nonempty upstream `elements` until a per-user ownership mapping exists; explain this restriction in the form instead of pretending the feature is connected.

Keep every installed model in the catalog while documentation or account-access verification is incomplete. Report unverified support instead of silently filtering models out.

**Why:** The user explicitly required preserving installed models and user choices; incomplete verification does not authorize a smaller catalog.

**How to apply:** Preserve existing catalog entries, picker choices and enablement settings. Catalog visibility does not authorize enabling paid generation. Restrict the model set only when the user explicitly asks.
