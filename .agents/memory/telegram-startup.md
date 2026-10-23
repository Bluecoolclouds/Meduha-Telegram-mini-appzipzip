---
name: Telegram startup
description: Scope of the user-confirmed automatic Telegram login flow and the distinction from Canvas prototypes.
---

The user confirmed implementing automatic Telegram login followed by loading their meduha account data. A separate external sign-in experience is not the intended default for the Telegram launch.

**Why:** The user asked how Mini Apps authorize users and load personal data, then accepted the offer to implement that flow. They explicitly pointed to the classic light/dark studio as the target after a Canvas agent changed the separate «Глубина» prototype. A Canvas mockup alone does not satisfy this request.

**How to apply:** Keep the classic studio's real account implementation separate from «Глубина» design demonstrations. Prototype states must remain visibly labelled as demonstrations; do not present a successful mock screen as verified Telegram authentication.

Do not offer manual sign-out in the Mini App profile.

**Why:** The user said: «кнопка выйти в профиле не нужна совсем. такое нам не нужна фукнкция в миниаппе».

**How to apply:** Preserve automatic Telegram login and security-related session expiry/revocation, but do not reintroduce a user-facing logout action.

The product is a Telegram bot as well as a Mini App; users expect `/start` in the bot chat to answer, independently of whether the studio has been published.

**Why:** The user explicitly corrected the incomplete bot experience: «на /start не отвечает этож бот».

**How to apply:** Treat bot-message reception and command replies as part of the Telegram entry experience, not as something the Mini App authentication SDK supplies automatically.
