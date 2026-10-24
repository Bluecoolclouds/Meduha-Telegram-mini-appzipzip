---
name: Storage stream cancellation
description: Early cancellation of a GCS reader can crash the Node process in this runtime.
---

Do not tie HTTP disconnection directly to destroying a GCS read stream before the SDK has initialized its response.

**Why:** the installed Google Cloud Storage SDK can throw an uncaught `ERR_STREAM_UNABLE_TO_PIPE` from its internal response callback when that early-destroyed stream later receives a response. A stream error listener does not catch this synchronous internal throw.

**How to apply:** for size-capped small derivatives, finish a bounded download and only send it if the client remains connected. If larger media needs cancellation, verify cancellation during SDK startup as well as during active transfer; do not assume a successful full download tests this behavior.
