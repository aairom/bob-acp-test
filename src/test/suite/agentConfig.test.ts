/**
 * acp-vscode — AgentConfig Unit Tests
 *
 * Tests ConfigManager.parseUserAgents, resolveEnvPlaceholders,
 * and the built-in agent merging logic — all without VS Code APIs.
 *
 * @module test/suite/agentConfig.test
 */

import * as assert from 'assert';
import * as sinon from 'sinon';

suite('AgentConfig — resolveEnvPlaceholders', () => {
  let sandbox: sinon.SinonSandbox;

  setup(() => { sandbox = sinon.createSandbox(); });
  teardown(() => { sandbox.restore(); });

  test('replaces ${env:VAR} with host env value', () => {
    process.env['TEST_ACP_KEY'] = 'secret123';
    // We test the exported pure function directly.
    const { resolveEnvPlaceholders } =
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../../config/agentConfig') as typeof import('../../config/agentConfig');
    const result = resolveEnvPlaceholders({ API_KEY: '${env:TEST_ACP_KEY}' });
    assert.strictEqual(result['API_KEY'], 'secret123');
    delete process.env['TEST_ACP_KEY'];
  });

  test('replaces missing env var with empty string', () => {
    const { resolveEnvPlaceholders } =
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../../config/agentConfig') as typeof import('../../config/agentConfig');
    const result = resolveEnvPlaceholders({ KEY: '${env:__NONEXISTENT_VAR__}' });
    assert.strictEqual(result['KEY'], '');
  });

  test('leaves non-placeholder values unchanged', () => {
    const { resolveEnvPlaceholders } =
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../../config/agentConfig') as typeof import('../../config/agentConfig');
    const result = resolveEnvPlaceholders({ PLAIN: 'just-a-value' });
    assert.strictEqual(result['PLAIN'], 'just-a-value');
  });

  test('handles multiple placeholders in one value', () => {
    process.env['HOST_A'] = 'alpha';
    process.env['HOST_B'] = 'beta';
    const { resolveEnvPlaceholders } =
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../../config/agentConfig') as typeof import('../../config/agentConfig');
    const result = resolveEnvPlaceholders({ COMBINED: '${env:HOST_A}-${env:HOST_B}' });
    assert.strictEqual(result['COMBINED'], 'alpha-beta');
    delete process.env['HOST_A'];
    delete process.env['HOST_B'];
  });
});

suite('AgentConfig — parseUserAgents (via ConfigManager)', () => {
  // Stub vscode workspace config to return controlled values.
  const makeVscodeStub = (agents: Record<string, unknown>, extra = {}) => ({
    window: { createOutputChannel: sinon.stub().returns({ appendLine: () => {}, show: () => {}, dispose: () => {} }) },
    workspace: {
      getConfiguration: sinon.stub().returns({
        get: (key: string, def: unknown) => {
          if (key === 'agents') { return agents; }
          if (key === 'includeBuiltInAgents') { return false; } // only user agents
          return def;
        },
      }),
    },
    ConfigurationTarget: { Global: 1 },
    ...extra,
  });

  test('parses valid agent entry', () => {
    const stub = makeVscodeStub({
      'My Agent': { command: 'my-agent-cli', args: ['--acp'], env: {} },
    });
    require.cache[require.resolve('vscode')] = { id: 'vscode', filename: 'vscode', loaded: true, exports: stub, parent: null, children: [], paths: [] } as never;
    delete require.cache[require.resolve('../../config/agentConfig')];

    const { ConfigManager } =
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../../config/agentConfig') as typeof import('../../config/agentConfig');

    const mgr = new ConfigManager();
    const agents = mgr.getAgents();
    assert.ok(agents.length >= 1, 'Should have at least 1 agent');
    const myAgent = agents.find(a => a.name === 'My Agent');
    assert.ok(myAgent, 'Should find "My Agent"');
    assert.strictEqual(myAgent?.command, 'my-agent-cli');
    assert.deepStrictEqual(myAgent?.args, ['--acp']);

    delete require.cache[require.resolve('vscode')];
    delete require.cache[require.resolve('../../config/agentConfig')];
  });

  test('skips entries without a command', () => {
    const stub = makeVscodeStub({
      'Bad Agent': { args: ['--acp'] }, // missing command
    });
    require.cache[require.resolve('vscode')] = { id: 'vscode', filename: 'vscode', loaded: true, exports: stub, parent: null, children: [], paths: [] } as never;
    delete require.cache[require.resolve('../../config/agentConfig')];

    const { ConfigManager } =
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../../config/agentConfig') as typeof import('../../config/agentConfig');

    const mgr = new ConfigManager();
    const agents = mgr.getAgents();
    const badAgent = agents.find(a => a.name === 'Bad Agent');
    assert.strictEqual(badAgent, undefined, 'Entry without command should be skipped');

    delete require.cache[require.resolve('vscode')];
    delete require.cache[require.resolve('../../config/agentConfig')];
  });
});
