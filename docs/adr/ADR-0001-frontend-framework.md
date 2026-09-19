# ADR-0001: Frontend = Vite + React 18 + TypeScript SPA
Status: accepted | Owner: Principal Architect
## Why
Contract §50 forbids Next.js/SSR. Deployment model gives the frontend 0 Node processes; a static SPA served from public_html satisfies this and fits cPanel/Passenger hosting.
## Alternatives rejected
- Next.js (forbidden by contract; requires Node server or heavy prerender).
- Server-rendered templates (loses app-like UX, couples UI to API process).
- Vue/Svelte (team standardization on React; larger ecosystem for RTL/Query).
## Consequences
- Auth state via HttpOnly cookie; no SSR secrets; bundle must avoid server-only packages.
- Code splitting required to keep initial bundle small.
