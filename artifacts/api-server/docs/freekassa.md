# FreeKassa in Meduha

## Implemented flow

Hosted SCI checkout based on the supplied code and https://docs.freekassa.net/.
The browser selects a Meduha plan, not a price. Server snapshots the RUB amount
and monthly credits, then signs a link to `https://pay.fk.money/`.
The customer chooses among methods actually enabled for their merchant.
No direct card/SBP API method IDs, fake payer email, recurring charge or API-key
nonce handling are used. `FREEKASSA_API_KEY` is not needed for this hosted flow.

The notification is authenticated with Secret Word 2 using constant-time signature
comparison. Local provider/order/amount/currency are checked before transactional
settlement. Repeated notifications share the existing exactly-once credit ledger.
The unsigned `intid` is validated but is not used as an authorization token or as
the local payment identity: SCI uses the signed merchant order UUID.
Success/failure browser returns never grant credits.

## Credentials (Replit Secrets, never Meduha admin or frontend)

Development uses a dedicated test merchant, with **test mode enabled in FreeKassa**:

- `FREEKASSA_TEST_MERCHANT_ID`
- `FREEKASSA_TEST_SECRET_WORD_1`
- `FREEKASSA_TEST_SECRET_WORD_2`

Production uses a separate live merchant/configuration:

- `FREEKASSA_LIVE_MERCHANT_ID`
- `FREEKASSA_LIVE_SECRET_WORD_1`
- `FREEKASSA_LIVE_SECRET_WORD_2`

Non-secret selection: `MEDUHA_PAYMENT_PROVIDER=freekassa`.
Keys alone do not enable checkout. `MEDUHA_PAYMENTS_ENABLED` stays unset/false
until the relevant test is explicitly authorized. Production additionally requires
approved actual legal/payment terms (`MEDUHA_PAYMENT_TERMS_FINALIZED=true`) and
`MEDUHA_PUBLIC_URL` pointing to the verified published origin. Do not mark terms
finalized simply to bypass the guard. Never put live credentials in TEST variables.

## FreeKassa merchant settings

Use the real environment's origin in place of `<PUBLIC_ORIGIN>`. Obtain the
published URL from Publishing; a preview URL is not the production URL.

- Notification URL: `<PUBLIC_ORIGIN>/api/meduha/payments/freekassa/notify`
- Notification method: **POST** (URL-encoded fields).
- Success URL: `<PUBLIC_ORIGIN>/api/meduha/payments/freekassa/return`
- Failure URL: the same `/freekassa/return` URL.
- Return method: GET.
- Enable notification acknowledgement/retries: handler returns literal `YES`
  only after committed settlement.
- Confirm commission settings and available methods in that merchant's account.
- Keep test merchant in test mode; verify live merchant is not in test mode
  before enabling production.

Return correlation uses a short-lived HttpOnly cookie containing only the local
order UUID. Wallet status is still protected by authenticated account ownership.
If the customer switches browsers, the wallet remains accessible without this
correlation; no payment or credit is inferred from the return.

## Before live enablement

Run a test-store payment and verify both new orders and repeated notifications,
monthly grants, receipts/refund terms, merchant domain and callback delivery.
Automated signature/route and isolated DB tests are not an actual merchant payment.
Adding this adapter does not enable production or publish the app.
