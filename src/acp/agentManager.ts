/**
 * acp-vscode — Agent Manager
 *
 * Orchestrates all AcpClient instances (one per agent name).
 * Responsibilities:
 *   - Owning the map of name → AcpClient.
 *   - Coordinating connect / disconnect / restart workflows.
 *   - Routing session/update notifications to the SessionManager.
 *   - Surfacing connection-state changes to the UI tree provider.
 *
 * Pattern: Mediator — AgentManager coordinates between AcpClient
 * (protocol I/O), SessionManager (state), and UI Providers (view updates).
 *
 * @module acp/agentManager
 */

import * as vscode from 'vscode';
import { AcpClient } from './acpClient';
import { ConfigManager } from '../config/agentConfig';
import { Logger } from '../utils/logger';
import {
  AgentConfig,
  AgentConnectionState,
  AcpNewSessionParams,
  AcpPromptSendParams,
  AcpPermissionResponseParams,
  AcpListSessionsResult,
} from '../types';

// ---------------------------------------------------------------------------
// AgentManager
// ---------------------------------------------------------------------------

/**
 * Manages the lifecycle of multiple ACP agent connections within a single
 * VS Code window.
 *
 * A single instance is created during extension activation and disposed on
 * deactivation. The `activeAgentName` tracks which agent's session is
 * currently shown in the chat panel.
 */
export class AgentManager implements vscode.Disposable {
  private readonly clients = new Map<string, AcpClient>();
  private readonly log: Logger;
  private readonly configManager: ConfigManager;

  private activeAgentName: string | undefined;

  // Downstream event emitters.
  private readonly _onConnectionStateChange = new vscode.EventEmitter<{
    agentName: string;
    state: AgentConnectionState;
  }>();
  private readonly _onSessionUpdate = new vscode.EventEmitter<{
    agentName: string;
    params: import('../types').AcpSessionUpdateParams;
  }>();
  private readonly _onAgentListChange = new vscode.EventEmitter<void>();

  /** Fired when any agent's connection state changes. */
  public readonly onConnectionStateChange = this._onConnectionStateChange.event;
  /** Fired when a `session/update` notification arrives from any agent. */
  public readonly onSessionUpdate = this._onSessionUpdate.event;
  /** Fired when the list of configured agents changes (add/remove). */
  public readonly onAgentListChange = this._onAgentListChange.event;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    this.log = Logger.getInstance();
  }

  // -------------------------------------------------------------------------
  // Agent configuration
  // -------------------------------------------------------------------------

  /** Returns the currently configured agent list. */
  public getAgents(): AgentConfig[] {
    return this.configManager.getAgents();
  }

  /** Returns the connection state for a given agent name. */
  public getState(agentName: string): AgentConnectionState {
    return this.clients.get(agentName)?.state ?? AgentConnectionState.Disconnected;
  }

  /** Returns all currently connected agent names. */
  public getConnectedAgentNames(): string[] {
    return [...this.clients.entries()]
      .filter(([, c]) => c.state === AgentConnectionState.Connected)
      .map(([name]) => name);
  }

  /** Returns the name of the currently active (focused) agent. */
  public getActiveAgentName(): string | undefined {
    return this.activeAgentName;
  }

  /** Sets the active agent (the one shown in the chat panel). */
  public setActiveAgent(agentName: string): void {
    this.activeAgentName = agentName;
  }

  // -------------------------------------------------------------------------
  // Connection management
  // -------------------------------------------------------------------------

  /**
   * Connects to the named agent.
   * Creates a new AcpClient if one doesn't exist; reuses an existing one
   * if it is in Disconnected or Error state.
   *
   * @param agentName - The display name of the agent to connect.
   * @throws Error if the agent name is not found in configuration.
   */
  public async connect(agentName: string): Promise<void> {
    const config = this.findConfig(agentName);

    let client = this.clients.get(agentName);
    if (client && (client.state === AgentConnectionState.Connected ||
                   client.state === AgentConnectionState.Connecting)) {
      this.log.info(`Agent already connected or connecting: ${agentName}`);
      return;
    }

    // Dispose old client if it exists in error/disconnected state.
    if (client) {
      client.dispose();
    }

    client = new AcpClient(config);
    this.clients.set(agentName, client);

    // Relay events.
    client.onStateChange((state) => {
      this._onConnectionStateChange.fire({ agentName, state });
    });
    client.onSessionUpdate((params) => {
      this._onSessionUpdate.fire({ agentName, params });
    });
    client.onExit(({ code, signal }) => {
      this.log.warn(`Agent exited unexpectedly: ${agentName}`, { code, signal });
    });

    const cwd = this.resolveWorkingDirectory();
    const timeout = this.configManager.getConnectTimeoutMs();

    await client.connect(cwd, timeout);
    this.activeAgentName = agentName;

    // Apply traffic logging setting.
    Logger.getInstance().setTrafficEnabled(this.configManager.getLogTraffic());
  }

  /**
   * Disconnects from the named agent.
   * @param agentName - The display name of the agent to disconnect.
   */
  public async disconnect(agentName: string): Promise<void> {
    const client = this.clients.get(agentName);
    if (!client) { return; }

    await client.disconnect();
    this.clients.delete(agentName);

    if (this.activeAgentName === agentName) {
      this.activeAgentName = undefined;
    }
  }

  /**
   * Disconnects then reconnects the named agent.
   * @param agentName - The display name of the agent to restart.
   */
  public async restart(agentName: string): Promise<void> {
    await this.disconnect(agentName);
    await this.connect(agentName);
  }

  // -------------------------------------------------------------------------
  // ACP session operations
  // -------------------------------------------------------------------------

  /**
   * Creates a new session with the specified agent.
   * @param agentName - Agent to create the session on.
   * @param params - Optional session creation parameters.
   * @returns The new session id.
   */
  public async newSession(agentName: string, params?: AcpNewSessionParams): Promise<string> {
    const client = this.requireConnected(agentName);
    const cwd = params?.workingDirectory ?? this.resolveWorkingDirectory();
    const result = await client.newSession({ ...params, workingDirectory: cwd });
    return result.sessionId;
  }

  /**
   * Sends a user prompt within an existing session.
   * @param params - Prompt payload and session id.
   */
  public async sendPrompt(params: AcpPromptSendParams): Promise<void> {
    const agentName = this.findAgentForSession(params.sessionId);
    const client = this.requireConnected(agentName);
    await client.sendPrompt(params);
  }

  /**
   * Cancels the current turn in a session.
   * @param sessionId - The session to cancel.
   */
  public async cancelTurn(sessionId: string): Promise<void> {
    const agentName = this.findAgentForSession(sessionId);
    const client = this.clients.get(agentName);
    if (client) {
      await client.cancelTurn(sessionId);
    }
  }

  /**
   * Lists available sessions for an agent.
   * @param agentName - The agent to query.
   */
  public async listSessions(agentName: string): Promise<AcpListSessionsResult> {
    const client = this.requireConnected(agentName);
    return client.listSessions();
  }

  /**
   * Responds to a permission request from an agent.
   * @param agentName - The agent that issued the request.
   * @param params - Permission response payload.
   */
  public async respondToPermission(
    agentName: string,
    params: AcpPermissionResponseParams
  ): Promise<void> {
    const client = this.requireConnected(agentName);
    await client.respondToPermission(params);
  }

  // -------------------------------------------------------------------------
  // Session → agent mapping (in-memory bookkeeping)
  // -------------------------------------------------------------------------

  /** Map from sessionId to agentName for fast lookups. */
  private readonly sessionAgentMap = new Map<string, string>();

  /** Register a session→agent association. */
  public registerSession(sessionId: string, agentName: string): void {
    this.sessionAgentMap.set(sessionId, agentName);
  }

  /** Deregister a session when it is closed. */
  public deregisterSession(sessionId: string): void {
    this.sessionAgentMap.delete(sessionId);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private findConfig(agentName: string): AgentConfig {
    const config = this.configManager.getAgents().find(a => a.name === agentName);
    if (!config) {
      throw new Error(`No agent configuration found for: "${agentName}"`);
    }
    return config;
  }

  private requireConnected(agentName: string): AcpClient {
    const client = this.clients.get(agentName);
    if (!client || client.state !== AgentConnectionState.Connected) {
      throw new Error(`Agent '${agentName}' is not connected.`);
    }
    return client;
  }

  private findAgentForSession(sessionId: string): string {
    const agentName = this.sessionAgentMap.get(sessionId);
    if (!agentName) {
      // Fallback: try active agent.
      if (this.activeAgentName) {
        return this.activeAgentName;
      }
      throw new Error(`No agent found for session: ${sessionId}`);
    }
    return agentName;
  }

  private resolveWorkingDirectory(): string {
    const configured = this.configManager.getDefaultWorkingDirectory();
    if (configured) { return configured; }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      return workspaceFolders[0].uri.fsPath;
    }

    return process.cwd();
  }

  public dispose(): void {
    for (const client of this.clients.values()) {
      client.dispose();
    }
    this.clients.clear();
    this._onConnectionStateChange.dispose();
    this._onSessionUpdate.dispose();
    this._onAgentListChange.dispose();
  }
}
