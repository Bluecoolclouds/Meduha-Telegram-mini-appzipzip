# Higgsfield / Seedance 2.5

Run from this package: `pnpm run example:higgsfield`.
This submits **one billable generation** and polls until it reaches a terminal state.
Only a completed response with an HTTPS video URL is printed as success.
Failures, moderation, cancellation and missing output exit unsuccessfully.
Do not rerun blindly after a lost response: the provider may already have accepted a paid request.

Server-only configuration: set `HF_CREDENTIALS` to `key-id:key-secret` in Replit Secrets,
or enter it locally in the Git-ignored `.env.local` in the package's working directory.
The existing Replit Secret `higgs` is supported as a fallback without copying its value.
Never use a `VITE_` variable or put credentials in channel metadata.

Official references:
- https://docs.higgsfield.ai/docs/how-to/sdk
- https://console.higgsfield.ai/models/bytedance/seedance-2.5/text-to-video/api-reference

The admin page can refresh the documented catalog from Higgsfield's public API Reference pages.
Higgsfield does not document a read-only model-discovery API; catalog entries represent documented
workflows, not account-specific access. The refresh reads documentation only and never submits a
generation. Imported entries start disabled with zero price and empty limits; existing settings are
not overwritten. Adding/enabling a channel does not launch generation or establish user pricing.
