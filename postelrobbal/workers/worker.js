// Postyar worker entry shim — started by cron (@reboot, flock-guarded, §68).
// Never auto-spawned by the API. Resolves postelrobbal/app relative to itself.
const path = require('path');
const appRoot = path.join(__dirname, '..', 'app');
process.chdir(appRoot);
require(path.join(appRoot, 'dist', 'worker.js'));
