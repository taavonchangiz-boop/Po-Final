# ADR-0007: First-user SUPER_ADMIN via transactional count guard
Status: accepted | Owner: Backend Architect
## Why
Contract §41 requires the rule to survive concurrent registrations.
## Decision
Registration inserts the user inside a transaction using INSERT ... SELECT WHERE NOT EXISTS(SELECT 1 FROM users) + unique partial semantics (role='SUPER_ADMIN' only grantable when the table was empty at transaction start under REPEATABLE READ with a named advisory/GET_LOCK fallback), then grants role. No client role input is honored.
## Alternatives rejected
- Application-level count-then-insert (race condition — the reference system's exact bug).
- Dedicated install wizard (out of product scope).
