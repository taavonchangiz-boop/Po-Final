// Postyar Passenger entry — CommonJS shim that boots the ESM Fastify server.
// Passenger provides PORT; the Fastify server binds 0.0.0.0:PORT.
// Layout (§55): this file lives at postelrobbal/api/app.js and requires
// postelrobbal/app/dist/server.js relative to itself.
const path = require('path');
require(path.join(__dirname, '..', 'app', 'dist', 'server.js'));
