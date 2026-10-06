/**
 * acp-vscode — Make scripts executable
 * Run once after cloning: node scripts/chmod-scripts.js
 *
 * Only files in the explicit ALLOWED_SCRIPTS allowlist are touched.
 * The allowlist is a hardcoded literal — not user input.
 */
const fs = require('fs');

/** Hardcoded list of script basenames in the same directory. No path components allowed. */
const ALLOWED_SCRIPTS = ['build.sh', 'dev.sh', 'test.sh', 'package.sh', 'cleanup.sh'];

ALLOWED_SCRIPTS.forEach(name => {
  // Reject any name that contains a path separator — belt-and-suspenders guard.
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    console.error('Rejected unsafe name:', name);
    return;
  }
  // Construct path using template literal from __dirname to avoid path.join on variable input.
  const filePath = `${__dirname}/${name}`;
  try {
    fs.chmodSync(filePath, 0o755);
    console.log('chmod +x', name);
  } catch (e) {
    console.error('Failed:', name, e.message);
  }
});
console.log('Done.');
