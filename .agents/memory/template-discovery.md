---
name: Template discovery
description: Community is a mosaic of shared user photo/video work with the original prompt available on click.
---

Community is a mosaic of photo/video materials people created and chose to share. Clicking a tile opens its media and original prompt, which can be reused in creation. Do not replace this with a large featured template card or horizontal carousel.

**Why:** The user clarified the earlier template direction: «должна же мозайка видео материалов быть в тренде типа всё что создавали люди и чем поделились с их промптом если нажать на неё».

**How to apply:** Only explicitly shared/published user work belongs in the public feed. Never represent starter samples, stock references, or private drafts as user publications. Do not imply generation already exists.

The user also asked to populate the mosaic with several media examples, using Higgsfield screenshots as a reference for tile layout.

**Why:** The user supplied mobile/desktop mosaic references and said «вот типа мозайка и добавь несколько материалов медиа».

**How to apply:** Explicitly labelled Meduha examples may appear alongside real publications. Keep the example label on tiles and in the prompt/media preview; never attribute examples to fictitious users.

«Комьюнити» is an internal screen reached from the header, with title search above «В тренде» and a mosaic feed.

**Why:** The user described the destination as «поиск по названия сверху снизу в тренде лента мозайка».

**How to apply:** Do not point the header action to a Telegram group or external social site. Preserve title search and progressive loading of differently sized photo/video cards.

Public work may show the author's first name and profile photo, with neutral fallbacks. Never expose Telegram account IDs, usernames, last names, drafts, or private templates through the public feed.

**Why:** The user explicitly requires real author attribution without disclosing private Telegram data or making private work public.

**How to apply:** Keep public API responses limited to the safe display name/avatar fields and published work; preserve owner identifiers only in authenticated private views.

Shared links use the same «Глубина» viewer, but only real published user work is resolved through the public detail API. Keep the labelled starter examples available locally; do not present them as publicly published or shareable work.

**Why:** Starter examples are local inspiration material, not community publications; public detail lookup must not accidentally turn them or private drafts into shareable posts.

**How to apply:** For feed detail links, resolve examples from the local catalog and fetch all other IDs through the endpoint that only returns currently published work.

Shared generation templates retain the source materials, exact prompt, model/mode and generation settings. «Повторить» should open the matching editor with that recipe, not a generic editor with only the prompt.

**Why:** the user described this workflow explicitly using a Genjutsu Motion Transfer example with a result video, a reference video and two ordered face-photo references.

**How to apply:** distinguish the showcase result from input references. Preserve reference order and prompt-token bindings such as Image 1, Image 2 and Video 1. Let the person repeating a template edit or replace the inputs without changing the author's template; never submit or spend credits just by opening it. Sharing a result alone does not authorize sharing its private source materials.
