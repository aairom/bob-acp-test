/**
 * acp-vscode — Agent Configuration Manager
 *
 * Reads, validates, merges, and persists ACP agent configurations from
 * VS Code workspace/user settings. Combines the user-defined agents with
 * built-in presets (when `acp.includeBuiltInAgents` is true) and resolves
 * ${env:VAR_NAME} placeholders in env values at access time.
 *
 * Security: No API keys or credentials are stored here. Users are directed
 * to their OS keychain / .env files for sensitive values. The ${env:VAR_NAME}
 * pattern allows forwarding host environment variables without persisting them.
 *
 * @module config/agentConfig
 */

import * as vscode from 'vscode';
import { AgentConfig } from '../types';

// ---------------------------------------------------------------------------
// Built-in agent presets
// ---------------------------------------------------------------------------

/**
 * Default ACP agent configurations shipped with the extension.
 * Commands use `npx` to avoid requiring global installations; the agent
 * package is downloaded on first use.
 *
 * IMPORTANT: No API keys or authentication tokens are embedded here.
 * Each agent's auth setup is the user's responsibility (see Quickstart.md).
 */
const BUILT_IN_AGENTS: ReadonlyArray<AgentConfig> = [
  /**
   * IBM watsonx Code Assistant (IBM Bob) — ACP adapter.
   *
   * Authentication: set IBM_BOB_API_KEY in your shell environment (or via the
   * `acp.ibmBobApiKey` VS Code secret setting). Optionally set IBM_BOB_ENDPOINT
   * to target a private watsonx.ai deployment; leave unset to use the default
   * public endpoint.
   *
   * Replace `@ibm/bob-acp@latest` with the exact package name from your IBM
   * entitlement or internal npm registry.
   */
  {
    name: 'IBM Bob',
    command: 'npx',
    args: ['--yes', '@ibm/bob-acp@latest'],
    env: {
      IBM_BOB_API_KEY: '${env:IBM_BOB_API_KEY}',
      IBM_BOB_ENDPOINT: '${env:IBM_BOB_ENDPOINT}',
    },
  },
  {
    name: 'Claude Code',
    command: 'npx',
    args: ['--yes', '@agentclientprotocol/claude-agent-acp@latest'],
    env: {},
  },
  {
    name: 'GitHub Copilot',
    command: 'npx',
    args: ['--yes', '@github/copilot-language-server@latest', '--acp'],
    env: {},
  },
  {
    name: 'Gemini CLI',
    command: 'npx',
    args: ['--yes', '@google/gemini-cli@latest', '--experimental-acp'],
    env: {},
  },
  {
    name: 'Codex CLI',
    command: 'npx',
    args: ['--yes', '@zed-industries/codex-acp@latest'],
    env: {},
  },
  {
    name: 'OpenCode',
    command: 'npx',
    args: ['--yes', 'opencode-ai@latest', 'acp'],
    env: {},
  },
  {
    name: 'Qwen Code',
    command: 'npx',
    args: ['--yes', '@qwen-code/qwen-code@latest', '--acp', '--experimental-skills'],
    env: {},
  },
  {
    name: 'Auggie CLI',
    command: 'npx',
    args: ['--yes', '@augmentcode/auggie@latest', '--acp'],
    env: {},
  },
];

// ---------------------------------------------------------------------------
// ConfigManager
// ---------------------------------------------------------------------------

/**
 * Provides typed, validated access to all ACP-related VS Code settings.
 * Instantiate once and pass around; settings are always read fresh from the
 * VS Code configuration store (no caching), so changes take effect without
 * requiring extension restarts.
 */
export class ConfigManager {

  /** The VS Code configuration section prefix used for all settings. */
  private static readonly SECTION = 'acp';

  // -------------------------------------------------------------------------
  // Agent configuration
  // -------------------------------------------------------------------------

  /**
   * Returns the merged set of agent configurations.
   *
   * Merge strategy:
   *   1. Start with built-in presets (when includeBuiltIn is true).
   *   2. Apply user-defined agents from settings, overriding any preset with
   *      the same name (case-insensitive comparison).
   *
   * @returns Ordered list of AgentConfig objects, built-ins first.
   */
  public getAgents(): AgentConfig[] {
    const cfg = this.section();

    const includeBuiltIn: boolean = cfg.get<boolean>('includeBuiltInAgents', true);
    const userAgentsRaw: Record<string, unknown> = cfg.get<Record<string, unknown>>('agents', {});

    const userAgents = this.parseUserAgents(userAgentsRaw);

    if (!includeBuiltIn) {
      return userAgents;
    }

    // Merge: user agents override built-ins with the same name.
    const merged = new Map<string, AgentConfig>();
    for (const agent of BUILT_IN_AGENTS) {
      merged.set(agent.name.toLowerCase(), { ...agent });
    }
    for (const agent of userAgents) {
      merged.set(agent.name.toLowerCase(), agent);
    }

    return Array.from(merged.values());
  }

  /**
   * Persists a new agent configuration to VS Code user settings.
   * @param agent - The agent config to store. The name becomes the key.
   */
  public async saveAgent(agent: AgentConfig): Promise<void> {
    const cfg = this.section();
    const current = cfg.get<Record<string, unknown>>('agents', {});
    current[agent.name] = {
      command: agent.command,
      args: agent.args,
      env: agent.env,
    };
    await cfg.update('agents', current, vscode.ConfigurationTarget.Global);
  }

  /**
   * Removes an agent configuration from VS Code user settings.
   * Built-in agents that are not in the user settings cannot be removed this
   * way (they would simply reappear from the built-in list on next read).
   * @param name - Exact name of the agent to remove.
   */
  public async removeAgent(name: string): Promise<void> {
    const cfg = this.section();
    const current = cfg.get<Record<string, unknown>>('agents', {});
    delete current[name];
    await cfg.update('agents', current, vscode.ConfigurationTarget.Global);
  }

  // -------------------------------------------------------------------------
  // General settings
  // -------------------------------------------------------------------------

  /** Auto-approve policy: 'ask' (default) or 'allowAll'. */
  public getAutoApprovePermissions(): 'ask' | 'allowAll' {
    return this.section().get<'ask' | 'allowAll'>('autoApprovePermissions', 'ask');
  }

  /** Default working directory for spawned agent processes. */
  public getDefaultWorkingDirectory(): string {
    return this.section().get<string>('defaultWorkingDirectory', '');
  }

  /** Whether to log raw ACP JSON-RPC traffic. */
  public getLogTraffic(): boolean {
    return this.section().get<boolean>('logTraffic', true);
  }

  /** Milliseconds to wait during the ACP initialize handshake. */
  public getConnectTimeoutMs(): number {
    return this.section().get<number>('connectTimeoutMs', 30000);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private section(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(ConfigManager.SECTION);
  }

  /**
   * Parses and validates the raw `acp.agents` object from VS Code settings.
   * Invalid entries are skipped with a warning rather than crashing.
   *
   * @param raw - Raw value from `WorkspaceConfiguration.get('agents')`.
   * @returns Validated list of AgentConfig objects.
   */
  private parseUserAgents(raw: Record<string, unknown>): AgentConfig[] {
    const result: AgentConfig[] = [];

    for (const [name, value] of Object.entries(raw)) {
      if (typeof value !== 'object' || value === null) {
        continue;
      }
      const entry = value as Record<string, unknown>;

      if (typeof entry['command'] !== 'string' || !entry['command']) {
        continue; // skip entries without a valid command
      }

      const args: string[] = Array.isArray(entry['args'])
        ? (entry['args'] as unknown[]).filter((a): a is string => typeof a === 'string')
        : [];

      const rawEnv = (typeof entry['env'] === 'object' && entry['env'] !== null)
        ? entry['env'] as Record<string, unknown>
        : {};
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawEnv)) {
        if (typeof v === 'string') {
          env[k] = v;
        }
      }

      result.push({ name, command: entry['command'], args, env });
    }

    return result;
  }
}

// ---------------------------------------------------------------------------
// Environment variable placeholder resolution
// ---------------------------------------------------------------------------

/**
 * Resolves `${env:VAR_NAME}` placeholders within an env map.
 * Missing host env vars are replaced with an empty string.
 *
 * @param env - Raw env map possibly containing ${env:...} placeholders.
 * @returns New env map with all placeholders resolved.
 */
export function resolveEnvPlaceholders(env: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  const placeholder = /\$\{env:([^}]+)\}/g;

  for (const [key, value] of Object.entries(env)) {
    resolved[key] = value.replace(placeholder, (_, varName: string) => {
      return process.env[varName] ?? '';
    });
  }

  return resolved;
}
