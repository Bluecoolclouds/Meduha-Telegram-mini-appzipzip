---
name: Workflow port ownership
description: Distinguish a failed managed launch from an older process still serving its artifact.
---

A failed workflow status does not necessarily mean its application is down. For an address-in-use error, verify the existing listener and its process ancestry before changing ports or starting another server.

**Why:** workflow reconciliation left an older Meduha Vite process serving requests while a newer managed launch failed because that process still owned the port.

**How to apply:** inspect workflow output, the artifact's exact process command and its parent chain, and a request through the preview proxy. If an orphan is confirmed, terminate only that identified process and restart the existing managed workflow. Preserve the separate Canvas server and API; do not create replacement workflows or select a different port to hide the conflict.
