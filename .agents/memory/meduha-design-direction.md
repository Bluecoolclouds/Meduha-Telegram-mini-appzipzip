---
name: Meduha design direction
description: Approved visual direction and scope rules for the meduha Telegram mini app mockups.
---
Rule: keep meduha's orange accent, user's white jellyfish mascot and Russian copy. There are two concepts: classic studio in light/dark themes, and «Глубина» with full-screen media, swipe navigation and conversational creation. «Глубина» is not the card-based studio feed. The app keeps the classic studio shell and both themes, but opening a community media item must use the original full-screen «Глубина» layout. Preserve the actual Canvas reference unchanged.

**Why:** the user rejected an invented bottom-card reinterpretation, supplied the original source archive, then explicitly requested copying that original viewing experience into the mini app when opening somebody's media. They want the reference preserved and other agents' functional changes retained.

**How to apply:** opening a publication should show full-bleed media, creator avatar/name, tags and prompt, glass side controls, the orange remix action and swipe navigation—not a small image inside a bottom sheet. The title and next-work card stay hidden; video taps pause/resume rather than relying on a right-side playback button. Use real media and author data; do not copy demo identities, likes, subscriptions or credit charges. Never edit the reference to match the implementation. Design-only changes must not roll back unrelated application tasks. Retain the floating translucent capsule navigation and existing mascot assets. The user prefers autonomy ("делай что надо") — build, don't ask unnecessarily.

The viewer must not show media-type/example chips, a sample-count badge, or a «Детали» control. Use the top-right search icon for the existing Community search and a three-dot menu for supported downloads and publication sharing.

**Why:** the user explicitly requested a less cluttered viewer with these actions in place of the type chips, counter, and details button.

**How to apply:** keep the creator identity, template information and prompt; show template information as plain text, search within the existing Community feed, and share only real community publications. Keep this lower content block and the right-side circular controls close to the unchanged bottom navigation, without reserving empty space for removed cards.

The bottom menu must remain the same as in the main app, including when media is open. Do not replace it with a separate «Глубина» navigation variant. The «Понравившиеся» tab belongs in Community.

**Why:** the user explicitly said the existing bottom menu cannot be changed and requested liked publications inside Community.

**How to apply:** reuse the actual main navigation, preserving its items, appearance and destinations. The fullscreen media composition does not override this rule.

Autoplay must stay conservative: only visible previews, no gallery playback behind an opened publication, and no playing media in a hidden/minimized app. Honor reduced-motion and data-saving preferences.

**Why:** the user asked to avoid overloading users' phones with the video mosaic.

**How to apply:** preserve this constraint when adding richer feeds or media effects; a static poster is preferable to uncontrolled simultaneous playback.

Video creation starts with choosing a user scenario, not choosing a raw model.

**Why:** the user requested a page after «Создать видео» with smart search above blocks such as «ИИ блогер», «Катана», «Контент-завод» and «Джиуджитсу».

**How to apply:** keep the scenario-first entry and let model/provider details support the selected task. Distinguish a documented API, a composite workflow and an MCP-only tool; don't present all tools from the provider's website as interchangeable live REST endpoints.

Selecting a scenario should open its own page with the inputs that scenario actually requires and its generation flow, rather than sending every card to the same generic text editor.

**Why:** the user requested scenario-specific pages, using Genjutsu as the example.

**How to apply:** derive fields from the documented API for each scenario. Preserve the distinction between working integrations and unsupported workflows; a text prompt cannot replace required source media or a style preset.

Genjutsu should follow Higgsfield's playground, with an in-page choice between motion transfer, object swap and restyle. Prefer restrained neutral surfaces here, not orange throughout the form.

**Why:** the user explicitly supplied all three live playground URLs, noted the missing mode switch, and said “поменьше оранжевого … просто без цветов иногда как у них в хигсфилд”.

**How to apply:** use compact source inputs and a result area, charcoal/gray in dark mode and neutral light surfaces in light mode. Keep existing Meduha navigation and real generation behavior; this is not a global removal of the orange brand accent.

Keep a small rounded example block above the Genjutsu form and a Russian-language entry to other people's work/the motion library.

**Why:** the user specifically requested a compact top «result» example and «Работы других», referencing “Start by copying motion from library” but in Russian.

**How to apply:** distinguish provider examples from actual user results. The library entry should lead to real shared videos, not fabricated publications.

The top «Пример результата» must play a video inline, not merely show a thumbnail that opens Higgsfield.

**Why:** the user pointed out that the example did not load video after a poster-only implementation.

**How to apply:** provide an actual playable source, a visible play action, native controls and a useful loading-error fallback. Keep it labelled as a provider demo, load on demand, and pause offscreen or in the background.

Katana and Genjutsu are visual references for the other video scenario pages. Adapt the other scenarios to those references, not the references to a new shared design.

**Why:** the user requested this direction and corrected a result that changed Katana itself instead.

**How to apply:** retain each scenario's own inputs and honest generation status, reuse only verified provider demos (and don't present another model's result as this one), and never route an unsupported scenario through a different paid generation model.

«Работы других» in a scenario opens Community filtered by that scenario's tag, not merely the video media type.

**Why:** the user explicitly clarified that the destination must be “комьюнити с тегом данного сценария”.

**How to apply:** keep the scenario tag visible and removable. Apply exact tag filtering before pagination; do not include unrelated demos or other scenario modes.

The video scenario catalogue should closely follow https://open.higgsfield.ai/explore: new-item carousel first, promotional banner second, then search/filters and a two-column media-card grid.

**Why:** the user explicitly requested this ordering and “стиль 1 в 1”, rather than a new independent visual direction.

The user rejected a loose visual approximation and approved the live-reference treatment: hero fading into the page, larger bottom-aligned headline, active image-capsule thumbnail, thin segmented progress and landscape cards. Keep two mobile columns despite the live site's single-column mobile layout; preserve the compact promo strip and existing app navigation.

The user subsequently requested rounded hero corners and smaller banner typography because the text overlapped the block. Preserve those refinements rather than restoring the original oversized headline.

In the video scenario catalogue, “filter by provider” means filtering by the actual provider namespace in a model's upstream ID (for example, `bytedance/...` or `higgsfield/...`), not by integration type. Scenarios without a model endpoint must not be assigned to a provider filter.
**Why:** the user explicitly corrected the filter semantics.
**How to apply:** derive provider options from model IDs and keep workflow/MCP classification separate from provider identity.

**How to apply:** retain Meduha branding, existing themes and the unchanged bottom navigation. Match the reference's compact dark catalogue treatment without inventing live discounts, unsupported model access or working generations.

Keep the catalogue hero compact and without arrow controls; swipe and thumbnail selection remain. Do not restore the shared guest-mode ribbon.

**Why:** the user explicitly requested a smaller banner, removal of arrows and removal of the guest-mode block.

**How to apply:** keep the promotional block concise, without arrow decoration. Removing the guest ribbon is a presentation change, not permission to remove guest access or weaken authentication.

The promotional strip uses white text on a deeper orange gradient; keep its light CTA pill with dark text for contrast.

**Why:** the user explicitly asked to try white text on the banner.

**How to apply:** when adjusting the strip, maintain readable contrast across every animated gradient stop and keep the CTA separately legible.

Catalogue price labels represent Meduha's configured retail credit prices, not Higgsfield's provider costs. Do not invent amounts or quote one component's price as a composite workflow total.

**Why:** the user requested “от … цена” in place of API badges; provider prices and Meduha charges are different concepts, and many scenarios combine multiple operations.

**How to apply:** use honest unavailable/unconfigured states when no matching tariff exists. The user's supplied Higgsfield CSS is a catalogue styling reference, not a request to replace the global Meduha brand or its orange accent.

Photo creation should start with a catalogue following the existing video-scenario design, including its carousel, compact promo strip, search/filters and two-column media cards. Photo scenario pages should use the same restrained workspace styling as video.

**Why:** the user selected the photo catalogue, then rejected its separate visual design and explicitly said to make photo scenarios look like the video scenarios.

**How to apply:** reuse the actual video components and styles rather than creating another visual direction. Keep the real photo-model settings and generation behavior intact. Legacy photo ideas still open the existing editor with their prompts; never present illustrative catalogue art as model outputs or user results.

Photo modes and variants of the same model belong inside one scenario, not in separate catalogue cards.

**Why:** the user explicitly rejected three separate SOUL cards and requested switching with buttons inside the scenario.

**How to apply:** show one family card, then expose its documented modes/versions within the scenario page. Keep exact mode-specific schemas, required uploads, prices and saved settings. Workflows with distinct purposes remain separate scenarios even when they share an upstream endpoint.

The package/tariff chooser should use three cards that swipe horizontally, styled like the user's Higgsfield pricing reference: dark cards with distinct colour accents, prominent prices and inset detail sections.

**Why:** the user explicitly requested three left/right-swipeable blocks and supplied that pricing screenshot as the design reference.

**How to apply:** keep the existing package amounts, prices and payment status; this visual request does not change one-off packs into recurring subscriptions or authorize new advertised benefits.

Keep the upstream provider's identity out of all customer-facing Meduha screens, including model labels, pricing copy, source links and error messages. Preserve the internal adapter and its identifiers so generation continues to work.

**Why:** the user explicitly said customers should not know which upstream provider powers the service.

**How to apply:** use neutral Meduha/model wording in public screens and keep provider names only in internal configuration and technical implementation where required.

Keep the homepage «Вдохновляйся» artist showcase hidden until there are real artists to feature.

**Why:** the user said «у нас их пока нет» and requested hiding that block.

**How to apply:** do not substitute invented artist accounts; keep the separate community/example feed available.
