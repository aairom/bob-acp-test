/**
 * acp-vscode — Logger Unit Tests
 *
 * Tests the Logger singleton: output channel creation, level filtering,
 * traffic logging toggle, and structured metadata serialisation.
 *
 * @module test/suite/logger.test
 */

import * as assert from 'assert';
import * as sinon from 'sinon';

// We test the Logger in isolation without requiring VS Code APIs by stubbing
// the vscode module before import.

suite('Logger', () => {
  let sandbox: sinon.SinonSandbox;

  // Stub output channels so we never touch real VS Code APIs.
  const fakeChannel = {
    appendLine: sinon.stub(),
    show: sinon.stub(),
    dispose: sinon.stub(),
  };

  setup(() => {
    sandbox = sinon.createSandbox();

    // Stub the vscode module used by Logger.
    const vscodeStub = {
      window: {
        createOutputChannel: sandbox.stub().returns(fakeChannel),
      },
    };
    // Use require cache manipulation to inject the stub.
    require.cache[require.resolve('vscode')] = {
      id: 'vscode',
      filename: 'vscode',
      loaded: true,
      exports: vscodeStub,
      parent: null,
      children: [],
      paths: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    // Reset stub call counts before each test.
    fakeChannel.appendLine.reset();
    fakeChannel.show.reset();
  });

  teardown(() => {
    sandbox.restore();
    // Remove Logger singleton so next test gets a fresh instance.
    delete require.cache[require.resolve('../../utils/logger')];
    delete require.cache[require.resolve('vscode')];
  });

  test('info() writes to main channel', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Logger } = require('../../utils/logger') as typeof import('../../utils/logger');
    const log = Logger.getInstance();
    log.info('hello world');
    assert.ok(
      fakeChannel.appendLine.calledOnce,
      'appendLine should be called once'
    );
    const line: string = fakeChannel.appendLine.firstCall.args[0];
    assert.ok(line.includes('hello world'), `Expected "hello world" in: ${line}`);
    assert.ok(line.includes('[INFO ]'), `Expected level tag in: ${line}`);
    log.dispose();
  });

  test('debug() is suppressed at INFO level', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Logger, LogLevel } = require('../../utils/logger') as typeof import('../../utils/logger');
    const log = Logger.getInstance();
    log.setLevel(LogLevel.INFO);
    log.debug('should not appear');
    assert.strictEqual(
      fakeChannel.appendLine.callCount, 0,
      'debug messages should be filtered at INFO level'
    );
    log.dispose();
  });

  test('error() includes error message in output', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Logger } = require('../../utils/logger') as typeof import('../../utils/logger');
    const log = Logger.getInstance();
    log.error('something broke', new Error('test error'));
    const line: string = fakeChannel.appendLine.firstCall.args[0];
    assert.ok(line.includes('something broke'), `Expected "something broke" in: ${line}`);
    assert.ok(line.includes('test error'), `Expected error message in: ${line}`);
    log.dispose();
  });

  test('logOutgoing() is skipped when traffic logging disabled', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Logger } = require('../../utils/logger') as typeof import('../../utils/logger');
    const log = Logger.getInstance();
    log.setTrafficEnabled(false);
    log.logOutgoing('{"jsonrpc":"2.0"}');
    // Traffic channel appendLine should not be called (only main channel can be).
    // Since both channels use the same stub here, check callCount is 0.
    assert.strictEqual(fakeChannel.appendLine.callCount, 0);
    log.dispose();
  });

  test('logIncoming() writes to traffic channel when enabled', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Logger } = require('../../utils/logger') as typeof import('../../utils/logger');
    const log = Logger.getInstance();
    log.setTrafficEnabled(true);
    log.logIncoming('{"jsonrpc":"2.0","id":1,"result":{}}');
    assert.ok(
      fakeChannel.appendLine.calledOnce,
      'Traffic appendLine should be called once'
    );
    const line: string = fakeChannel.appendLine.firstCall.args[0];
    assert.ok(line.startsWith('<< '), `Expected "<< " prefix in: ${line}`);
    log.dispose();
  });
});
