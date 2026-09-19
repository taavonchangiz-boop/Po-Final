# ADR-0003: Database = MySQL/MariaDB + Drizzle ORM
Status: accepted | Owner: Principal Architect
## Why
Contract §52 mandates MySQL/MariaDB, Drizzle preferred. Drizzle emits plain SQL migrations (reviewable, versioned in database/migrations), has no runtime query-engine binary, and fits shared-hosting budgets.
## Alternatives rejected
- Prisma (forbidden by default; requires engine binaries, heavier on constrained CPU/RAM).
- Kysely (acceptable but no first-class migration authoring; documented rejection).
- Raw SQL everywhere (loses typed query safety).
## Consequences
- mysql2 pool capped conservatively (default 5) per §109.
- Migrations are generated, reviewed, committed; deployment never invents migrations (§66).
