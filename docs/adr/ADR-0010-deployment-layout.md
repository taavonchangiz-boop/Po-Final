# ADR-0010: Deployment = private postelrobbal root + public_html static
Status: accepted | Owner: Deployment Architect
## Why
Contract §55, §132. Public web root must never expose app code, .env, logs, private uploads, DB files.
## Consequences
- Passenger maps /api to the Fastify entry; SPA + brand assets under public_html; deploy.sh only builds/verifies/restarts, never provisions Redis or invents migrations.
