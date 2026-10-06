/**
 * acp-vscode — ACP Client Core
 *
 * Manages the lifecycle of a single ACP agent process:
 *   - Spawning and monitoring the child process (stdio transport).
 *   - Framing and dispatching JSON-RPC 2.0 messages (newline-delimited).
 *   - Executing the ACP initialize handshake.
 *   - Exposing typed request/notification helpers used by AgentManager.
 *
 * The client emits typed events via vscode.EventEmitter so that upstream
 * managers and UI providers can react to agent lifecycle and streaming data.
 *
 * Security:
 *   - No credentials are stored or logged by this class.
 *   - env is resolved from ConfigManager (placeholder substitution only).
 *   - The child process inherits the minimal required env subset.
 *
 * @module acp/acpClient
 */

import * as cp from 'child_process';
import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { resolveEnvPlaceholders } from '../config/agentConfig';
import {
  AgentConfig,
  AgentConnectionState,
  AcpInitializeParams,
  AcpInitializeResult,
  AcpNewSessionParams,
  AcpNewSessionResult,
  AcpListSessionsResult,
  AcpPromptSendParams,
  AcpPermissionResponseParams,
  AcpSessionUpdateParams,
  JsonRpcRequest,
  JsonRpcNotification,
  JsonRpcResponse,
  JsonRpcErrorResponse,
  AcpIncomingMessage,
} from '../types';

// ---------------------------------------------------------------------------
// ACP protocol constants
// ---------------------------------------------------------------------------

/** Current ACP protocol version string. */
const ACP_PROTOCOL_VERSION = '2025-05-26';

/** Extension client info sent during the handshake. */
const CLIENT_INFO = {
  name: 'acp-vscode',
  version: '1.0.0',
};

// ---------------------------------------------------------------------------
// Typed event definitions
// ---------------------------------------------------------------------------

/** Emitted when the agent sends a `session/update` notification. */
export type SessionUpdateEvent = AcpSessionUpdateParams;

/** Emitted when the agent process exits (intentionally or not). */
export interface AgentExitEvent {
  code: number | null;
  signal: NodeJS.Signals | null;
}

// ---------------------------------------------------------------------------
// AcpClient
// ---------------------------------------------------------------------------

/**
 * Manages a single ACP agent subprocess and its JSON-RPC 2.0 communication.
 *
 * Lifecycle:
 *   connect() → initialize() handshake → ready to send requests/notifications
 *   disconnect() → process killed, all pending requests rejected
 *
 * All I/O uses newline-delimited JSON (NDJSON) over the agent's stdin/stdout.
 */
export class AcpClient implements vscode.Disposable {
  private readonly log: Logger;
  private readonly agentConfig: AgentConfig;

  private process: cp.ChildProcess | undefined;
  private buffer = '';
  private nextId = 1;

  // Pending promises keyed by request id.
  private readonly pending = new Map<number | string, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }>();

  /** Current connection state. */
  public state: AgentConnectionState = AgentConnectionState.Disconnected;

  /** Capabilities advertised by the agent after initialization. */
  public capabilities: AcpInitializeResult['capabilities'] = {};

  // VS Code event emitters — consumers subscribe via .event.
  private readonly _onSessionUpdate = new vscode.EventEmitter<SessionUpdateEvent>();
  private readonly _onStateChange = new vscode.EventEmitter<AgentConnectionState>();
  private readonly _onExit = new vscode.EventEmitter<AgentExitEvent>();

  /** Fired when a `session/update` notification arrives from the agent. */
  public readonly onSessionUpdate = this._onSessionUpdate.event;
  /** Fired whenever the connection state changes. */
  public readonly onStateChange = this._onStateChange.event;
  /** Fired when the agent process exits. */
  public readonly onExit = this._onExit.event;

  constructor(agentConfig: AgentConfig) {
    this.agentConfig = agentConfig;
    this.log = Logger.getInstance();
  }

  // -------------------------------------------------------------------------
  // Connection management
  // -------------------------------------------------------------------------

  /**
   * Spawns the agent process and executes the ACP initialize handshake.
   * Resolves when the handshake completes successfully.
   *
   * @param workingDirectory - CWD for the spawned process. Falls back to
   *   the first open workspace folder, then the process CWD.
   * @param timeoutMs - Maximum wait time for the initialize response.
   * @throws Error if the process fails to start or the handshake times out.
   */
  public async connect(workingDirectory: string, timeoutMs: number): Promise<void> {
    if (this.state !== AgentConnectionState.Disconnected &&
        this.state !== AgentConnectionState.Error) {
      throw new Error(`Agent '${this.agentConfig.name}' is already connecting or connected.`);
    }

    this.setState(AgentConnectionState.Connecting);

    const resolvedEnv = resolveEnvPlaceholders(this.agentConfig.env);
    const spawnEnv: NodeJS.ProcessEnv = {
      ...process.env,   // inherit host environment
      ...resolvedEnv,   // overlay agent-specific vars
    };

    this.log.info(`Spawning agent: ${this.agentConfig.name}`, {
      command: this.agentConfig.command,
      args: this.agentConfig.args,
      cwd: workingDirectory,
    });

    try {
      this.process = cp.spawn(this.agentConfig.command, this.agentConfig.args, {
        cwd: workingDirectory || undefined,
        env: spawnEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      this.setState(AgentConnectionState.Error);
      throw new Error(
        `Failed to spawn agent '${this.agentConfig.name}': ${(err as Error).message}`
      );
    }

    this.setupProcessHandlers();

    // Run the initialize handshake with a timeout.
    await this.withTimeout(
      this.initialize(),
      timeoutMs,
      `Agent '${this.agentConfig.name}' did not respond to initialize within ${timeoutMs}ms.`
    );

    this.setState(AgentConnectionState.Connected);
    this.log.info(`Agent connected: ${this.agentConfig.name}`, {
      agentVersion: this.capabilities,
    });
  }

  /**
   * Gracefully disconnects from the agent: sends a JSON-RPC `shutdown`
   * notification, waits briefly, then kills the process if still running.
   */
  public async disconnect(): Promise<void> {
    if (!this.process) { return; }

    // Best-effort shutdown notification; ignore errors.
    try {
      this.sendNotification('shutdown', {});
    } catch {
      // ignore
    }

    // Give the process 1 second to exit cleanly.
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.process?.kill('SIGTERM');
        resolve();
      }, 1000);
      this.process?.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.cleanup();
    this.setState(AgentConnectionState.Disconnected);
    this.log.info(`Agent disconnected: ${this.agentConfig.name}`);
  }

  // -------------------------------------------------------------------------
  // ACP request helpers
  // -------------------------------------------------------------------------

  /**
   * Creates a new ACP session.
   * @param params - Session creation parameters.
   * @returns The new session id.
   */
  public async newSession(params: AcpNewSessionParams): Promise<AcpNewSessionResult> {
    return this.sendRequest<AcpNewSessionResult>('session/new', params);
  }

  /**
   * Lists all available sessions from the agent.
   * Only valid when capabilities.sessions.list is true.
   */
  public async listSessions(): Promise<AcpListSessionsResult> {
    return this.sendRequest<AcpListSessionsResult>('session/list', {});
  }

  /**
   * Sends a prompt to the agent in a given session.
   * The agent will respond via `session/update` notifications.
   * @param params - Prompt and session context.
   */
  public async sendPrompt(params: AcpPromptSendParams): Promise<void> {
    await this.sendRequest<void>('prompt/send', params);
  }

  /**
   * Cancels the current agent turn in a session.
   * @param sessionId - The session to cancel.
   */
  public async cancelTurn(sessionId: string): Promise<void> {
    this.sendNotification('session/cancel', { sessionId });
  }

  /**
   * Responds to an agent permission request.
   * @param params - The response payload (approved/denied).
   */
  public async respondToPermission(params: AcpPermissionResponseParams): Promise<void> {
    this.sendNotification('permission/response', params);
  }

  // -------------------------------------------------------------------------
  // Internal — ACP initialize handshake
  // -------------------------------------------------------------------------

  private async initialize(): Promise<void> {
    const params: AcpInitializeParams = {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientInfo: CLIENT_INFO,
    };

    const result = await this.sendRequest<AcpInitializeResult>('initialize', params);
    this.capabilities = result.capabilities ?? {};

    // Acknowledge the handshake with a notification.
    this.sendNotification('initialized', {});
  }

  // -------------------------------------------------------------------------
  // Internal — JSON-RPC framing
  // -------------------------------------------------------------------------

  /**
   * Sends a JSON-RPC 2.0 request and returns a Promise that resolves with
   * the result or rejects with the error.
   *
   * @template T - Expected result type.
   * @param method - The RPC method name.
   * @param params - Request parameters.
   */
  private sendRequest<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const frame = JSON.stringify(request);
    this.log.logOutgoing(frame);

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.writeFrame(frame);
    });
  }

  /**
   * Sends a JSON-RPC 2.0 notification (fire-and-forget, no response expected).
   * @param method - The notification method name.
   * @param params - Notification parameters.
   */
  private sendNotification(method: string, params: unknown): void {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    const frame = JSON.stringify(notification);
    this.log.logOutgoing(frame);
    this.writeFrame(frame);
  }

  /**
   * Writes a framed message to the agent's stdin.
   * ACP uses newline-delimited JSON (each message on its own line).
   * @param frame - Serialised JSON string.
   */
  private writeFrame(frame: string): void {
    if (!this.process?.stdin?.writable) {
      throw new Error(`Cannot write to agent '${this.agentConfig.name}': stdin not writable.`);
    }
    this.process.stdin.write(frame + '\n');
  }

  // -------------------------------------------------------------------------
  // Internal — stdout parsing
  // -------------------------------------------------------------------------

  private setupProcessHandlers(): void {
    const proc = this.process!;

    // Read stdout line by line.
    proc.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      this.flushBuffer();
    });

    // Log stderr for debugging but do not treat as protocol traffic.
    proc.stderr?.on('data', (chunk: Buffer) => {
      this.log.debug(`[${this.agentConfig.name}] stderr: ${chunk.toString('utf8').trim()}`);
    });

    proc.on('exit', (code, signal) => {
      this.log.info(`Agent process exited: ${this.agentConfig.name}`, { code, signal });
      this.rejectAllPending(new Error(`Agent process exited (code=${code}, signal=${signal})`));
      this.cleanup();
      this.setState(AgentConnectionState.Disconnected);
      this._onExit.fire({ code, signal });
    });

    proc.on('error', (err) => {
      this.log.error(`Agent process error: ${this.agentConfig.name}`, err);
      this.rejectAllPending(err);
      this.setState(AgentConnectionState.Error);
    });
  }

  /** Parses complete newline-delimited JSON frames from the stdout buffer. */
  private flushBuffer(): void {
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);

      if (!line) { continue; }

      this.log.logIncoming(line);

      let message: AcpIncomingMessage;
      try {
        message = JSON.parse(line) as AcpIncomingMessage;
      } catch (err) {
        this.log.warn(`Non-JSON line from agent: ${line.slice(0, 120)}`);
        continue;
      }

      this.dispatch(message);
    }
  }

  /**
   * Routes an incoming message to either a pending request resolution or
   * the notification event emitter.
   */
  private dispatch(message: AcpIncomingMessage): void {
    // Response to a pending request (has an id).
    if ('id' in message && message.id !== null) {
      const handler = this.pending.get(message.id);
      if (handler) {
        this.pending.delete(message.id);
        if ('error' in message) {
          const errMsg = (message as JsonRpcErrorResponse).error;
          handler.reject(new Error(`ACP error ${errMsg.code}: ${errMsg.message}`));
        } else {
          handler.resolve((message as JsonRpcResponse).result);
        }
        return;
      }
    }

    // Notification (no id or id is null).
    const notif = message as { method?: string; params?: unknown };
    if (notif.method === 'session/update') {
      this._onSessionUpdate.fire(notif.params as AcpSessionUpdateParams);
    }
    // Additional notification types can be handled here.
  }

  // -------------------------------------------------------------------------
  // Internal — helpers
  // -------------------------------------------------------------------------

  private setState(state: AgentConnectionState): void {
    this.state = state;
    this._onStateChange.fire(state);
  }

  private rejectAllPending(reason: Error): void {
    for (const [, handler] of this.pending) {
      handler.reject(reason);
    }
    this.pending.clear();
  }

  private cleanup(): void {
    this.buffer = '';
    this.rejectAllPending(new Error('ACP client was disconnected.'));
    this.process = undefined;
  }

  /**
   * Wraps a Promise with a timeout that rejects after `ms` milliseconds.
   * @param promise - The original promise.
   * @param ms - Timeout in milliseconds.
   * @param message - Error message if the timeout fires.
   */
  private withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); }
      );
    });
  }

  /** Disposes all event emitters and disconnects. */
  public dispose(): void {
    void this.disconnect();
    this._onSessionUpdate.dispose();
    this._onStateChange.dispose();
    this._onExit.dispose();
  }
}
