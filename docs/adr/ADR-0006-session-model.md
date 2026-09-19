# ADR-0006: Sessions = opaque server-side tokens in HttpOnly cookies
Status: accepted | Owner: Security Architect
## Why
Contract §39-40. Reference systems stored bearer tokens in localStorage (theft-prone) and sessions lacked revocation/rotation.
## Alternatives rejected
- JWT (hard revocation, size, accidental secret exposure), localStorage tokens (XSS theft surface).
## Consequences
- 32-byte random token, SHA-256 stored, HttpOnly+Secure+SameSite=Lax, rotation on login, server-side revocation; CSRF double-submit on top.
