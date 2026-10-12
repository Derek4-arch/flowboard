/* Runs the Playwright browser tests (tests/e2e/*.e2e.js) with node --test.
   Playwright is NOT a dependency of Flowboard; install it once to run these:
     npm install --no-save playwright && npx playwright install chromium
   Or point NODE_PATH at an existing node_modules folder that contains playwright. */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
try { require.resolve('playwright'); } catch (e) {
  console.error('\n  Playwright is not installed. Run:\n    npm install --no-save playwright\n    npx playwright install chromium\n  then: npm run test:e2e\n');
  process.exit(1);
}
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.e2e.js')).map(f => path.join(__dirname, f));
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit', env: process.env });
process.exit(r.status === null ? 1 : r.status);
