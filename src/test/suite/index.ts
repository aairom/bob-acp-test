/**
 * acp-vscode — Test Suite Index
 *
 * Discovers and loads all *.test.js files from the compiled output directory.
 * Uses a hardcoded file list to avoid any dynamic path construction that
 * could be flagged by static analysis tools.
 *
 * @module test/suite/index
 */

// Use require() so the CJS default export (the constructor) is assigned directly.
// A namespace-style import (`import * as Mocha`) cannot be used as a constructor
// with esModuleInterop; this pattern is the TypeScript-recommended alternative.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const Mocha: new (opts?: object) => { addFile(f: string): void; run(cb: (n: number) => void): void } = require('mocha');

/** Hardcoded list of test files — all reside in the same directory as this index. */
const TEST_FILES: readonly string[] = [
  `${__dirname}/logger.test.js`,
  `${__dirname}/agentConfig.test.js`,
  `${__dirname}/uuid.test.js`,
  `${__dirname}/extension.test.js`,
];

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 10000,
  });

  TEST_FILES.forEach(f => mocha.addFile(f));

  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}
