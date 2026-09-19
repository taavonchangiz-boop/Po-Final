// Postyar scheduler tick entry shim — started by cron (* * * * *, flock-guarded, §68).
// Resolves postelrobbal/app relative to itself.
const path = require('path');
const appRoot = path.join(__dirname, '..', 'app');
process.chdir(appRoot);
require(path.join(appRoot, 'dist', 'scheduler.js'));
