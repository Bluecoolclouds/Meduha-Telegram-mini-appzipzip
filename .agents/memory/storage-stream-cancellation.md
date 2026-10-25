---
name: Storage stream cancellation
description: Early cancellation of a GCS reader can crash the Node process in this runtime.
---

Do not tie HTTP disconnection directly to destroying a GCS read stream before the SDK has initialized its response.

**Why:** the installed Google Cloud Storage SDK can throw an uncaught `ERR_STREAM_UNABLE_TO_PIPE` from its internal response callback when that early-destroyed stream later receives a response. A stream error listener does not catch this synchronous internal throw.

**How to apply:** never destroy a GCS reader directly from an HTTP close callback. If the client disconnects before the SDK emits `response`, resume and discard the lazy read so its request starts; after `response`, defer cancellation until the SDK's synchronous handler has attached its pipeline. Test startup and active-transfer disconnects in child processes because an uncaught SDK throw terminates the test process too.
