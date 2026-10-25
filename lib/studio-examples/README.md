# Shared public examples

`motion-transfer.json` is the canonical example imported by the API and web app.
It is metadata for an approved public example, not private user work.

The web app's `public/templates/motion-transfer.json` remains a compatibility
copy so its existing public URL continues to work. Keep that copy identical
when updating the canonical example. Application code must import this package,
not the copy in `public`.
