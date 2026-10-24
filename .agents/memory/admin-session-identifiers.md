---
name: Administrator session identifiers
description: Privacy boundary for listing or revoking administrative sessions
---

Use a separate random public identifier for administrator sessions. Never expose the authentication token, its hash, or the temporary-login configuration fingerprint through session listings, mutation URLs, or audit records.

**Why:** the stored token hash is still a credential fingerprint, and the temporary configuration fingerprint reveals whether secret configuration changed. Neither is needed to identify a session to an administrator.

**How to apply:** return only the random session ID, authentication method, timestamps, and whether it is the current session. Keep revocation and auditing keyed by that public ID while authentication continues to validate the private token hash.
