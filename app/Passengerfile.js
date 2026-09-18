/**
 * Passenger configuration — Postyar API (پُستیار)
 * ---------------------------------------------------------------
 * This file lives at the app root (`postelrobbal/app/Passengerfile.js`
 * in the deployed layout). Passenger reads it automatically when the
 * application root is resolved (cPanel "Setup Node.js App" sets
 * PassengerAppRoot to this directory; the Passengerfile refines it).
 *
 * Startup file: `dist/server.js` — produced by `npm run build`
 * (tsc -p tsconfig.build.json). NEVER point Passenger at src/server.ts.
 *
 * Note on `app.js`: cPanel's Node selector sometimes references an
 * `app.js` alias as the "startup file" in its UI. Passenger's
 * `startup_file` below is authoritative; no separate app.js shim is
 * needed. If your panel insists on a filename, create app/app.js with
 * `import './dist/server.js';` — but prefer fixing the selector value.
 *
 * Process budget (contract): exactly ONE API process.
 *   min_instances 1 / max_processes 1  → Passenger never forks extra
 *   copies; max_requests 1000          → clean in-place restart of the
 *   single worker between request waves (memory hygiene on shared hosting).
 */
module.exports = {
  // Node.js application (NOT rack/wsgi/static)
  passenger_app_type: 'node',

  // Built entry — relative to this file's directory (app/)
  startup_file: 'dist/server.js',

  // Sets NODE_ENV=production in the Passenger process; env.ts then
  // enforces the mandatory production secrets (fail-fast).
  environment: 'production',

  // Single-process budget — see header comment.
  min_instances: 1,
  max_processes: 1,
  max_requests: 1000,

  // Graceful shutdown: SIGTERM is handled in dist/server.js
  // (stop intake → drain → close queues/redis/mysql → exit 0).
};
