# Higgsfield / Seedance 2.5

Run from this package: `pnpm run example:higgsfield`.
This submits **one billable generation** and polls until it reaches a terminal state.
Only a completed response with an HTTPS video URL is printed as success.
Failures, moderation, cancellation and missing output exit unsuccessfully.
Do not rerun blindly after a lost response: the provider may already have accepted a paid request.

Server-only configuration: save the complete copied API key in `HF_API_KEY` or `HF_CREDENTIALS` in Replit Secrets,
or enter it locally in the Git-ignored `.env.local` in the package's working directory.
The existing Replit Secrets `higgs` and `higgs_api` are supported as fallbacks without copying their values.
The credential is passed unchanged in the server-side `Authorization: Key ...` header.
Do not split the copied key or ask users to assemble a key/secret pair.
Never use a `VITE_` variable or put credentials in channel metadata.

Official references:
- https://docs.higgsfield.ai/docs/how-to/sdk
- https://console.higgsfield.ai/models/bytedance/seedance-2.5/text-to-video/api-reference

The admin page can refresh the documented catalog from Higgsfield's public API Reference pages.
Higgsfield does not document a read-only model-discovery API; catalog entries represent documented
workflows, not account-specific access. The refresh reads documentation only and never submits a
generation. Imported entries start disabled with zero price and empty limits; existing settings are
not overwritten. Adding/enabling a channel does not launch generation or establish user pricing.

## Restore development configuration without generation

Run `pnpm --filter @workspace/api-server run setup:higgsfield` from the workspace root.
It restores the Higgsfield channel and every entry in the checked-in public documentation
snapshot, disabled and unpriced. Existing configuration is preserved on repeat runs.
It does not assign an administrator, create users, grant credits, change spending or call
the generation API. Post-merge setup runs this command so the task's development data
is restored after merging. This is not a production migration or server startup hook.

To deliberately refresh the documentation snapshot, run the same command with `--refresh`.
This only reads public documentation; it does not verify account access or prices.
`catalog.json` records the source URLs, refresh time and partial-discovery warnings.
The studio implements photo modes, Seedance 2.5 and three Genjutsu scenarios;
retaining other documented entries is not a claim that every UI/adapter exists.
Provider prices vary by parameters; the official non-generation estimate endpoint is
documented at https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md.
No provider USD/credit conversion into studio credits is implied by this bootstrap.
