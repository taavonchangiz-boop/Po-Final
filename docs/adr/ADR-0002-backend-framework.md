# ADR-0002: Backend = Fastify 5 + TypeScript on Node >=22
Status: accepted | Owner: Principal Architect
## Why
Contract §51 mandates Node 22 LTS + Fastify + TypeScript. Fastify gives schema-first validation hooks, structured logging (pino), low overhead, plugin encapsulation.
## Alternatives rejected
- Express (weaker schema/typing story), NestJS (DI heaviness for a 1-process shared host), Koa (smaller ecosystem).
## Consequences
- zod used for request/response validation; errors normalized in one error handler.
