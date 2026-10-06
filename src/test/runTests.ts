/**
 * acp-vscode — Test Runner
 *
 * Bootstraps the Mocha test runner for the extension test suite.
 * Uses @vscode/test-electron to launch VS Code and execute tests inside it.
 *
 * @module test/runTests
 */

import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
    });
  } catch (err) {
    console.error('Test run failed:', err);
    process.exit(1);
  }
}

main();
