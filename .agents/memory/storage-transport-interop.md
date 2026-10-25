---
name: Storage transport interop
description: Why storage downloads need a targeted transport patch and how to validate its removal.
---

Keep the pinned transport patch until an upstream replacement passes lifecycle checks. Do not silence the issue by raising the global EventEmitter listener limit.

**Why:** a single GCS download reproduced duplicate error/close listener warnings inside the nested teeny-request and GCS pipelines. This was reproducible without concurrent HTTP clients. Monitoring the source once with cleanup and preserving pipe/close/error propagation removed the warnings.

**How to apply:** when upgrading the storage SDK, its transport, or Node, verify full and ranged reads, truncated responses, cancellation after data starts, and a real public App Storage asset read. Retain the patch unless its upstream replacement passes these checks without warnings. The separate early-cancellation hazard documented in [Storage stream cancellation](storage-stream-cancellation.md) is not assumed fixed by this transport change.
