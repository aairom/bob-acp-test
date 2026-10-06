/**
 * acp-vscode — ACP Type Definitions
 *
 * Defines all TypeScript interfaces and enumerations used across the extension.
 * Aligned with the Agent Client Protocol (JSON-RPC 2.0 over stdio) specification.
 *
 * @module types
 */

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 base types
// ---------------------------------------------------------------------------

/** A JSON-RPC 2.0 request message sent to the agent process. */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

/** A JSON-RPC 2.0 notification (no id, no response expected). */
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

/** A successful JSON-RPC 2.0 response. */
export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  result: T;
}

/** A JSON-RPC 2.0 error response. */
export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** Union of all incoming messages from the agent process. */
export type AcpIncomingMessage =
  | JsonRpcResponse
  | JsonRpcErrorResponse
  | JsonRpcNotification;

// ---------------------------------------------------------------------------
// ACP Protocol — initialize
// ---------------------------------------------------------------------------

/** Parameters for the ACP `initialize` request. */
export interface AcpInitializeParams {
  /** Protocol version, currently "2025-05-26". */
  protocolVersion: string;
  clientInfo: {
    name: string;
    version: string;
  };
}

/** Capabilities advertised by the agent on initialization. */
export interface AcpAgentCapabilities {
  /** If present, the agent supports listing sessions. */
  sessions?: { list: boolean };
  /** If present, the agent supports permission negotiation. */
  permissions?: boolean;
  /** MCP capability metadata. */
  mcpCapabilities?: unknown;
  /** Available session configuration keys (model, mode, reasoning, …). */
  sessionConfig?: AcpSessionConfigSpec[];
}

/** A single session-level configuration parameter advertised by the agent. */
export interface AcpSessionConfigSpec {
  key: string;
  label: string;
  type: 'select' | 'text' | 'boolean';
  options?: string[];
  default?: string | boolean;
}

/** Result returned by the agent for the `initialize` handshake. */
export interface AcpInitializeResult {
  protocolVersion: string;
  agentInfo: {
    name: string;
    version: string;
  };
  capabilities: AcpAgentCapabilities;
}

// ---------------------------------------------------------------------------
// ACP Protocol — sessions
// ---------------------------------------------------------------------------

/** Parameters for the `session/new` request. */
export interface AcpNewSessionParams {
  workingDirectory?: string;
  config?: Record<string, string | boolean>;
}

/** Result for `session/new`. */
export interface AcpNewSessionResult {
  sessionId: string;
}

/** Parameters for the `session/list` request (no params required). */
export type AcpListSessionsParams = Record<string, never>;

/** A single session entry returned by `session/list`. */
export interface AcpSessionEntry {
  sessionId: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Result for `session/list`. */
export interface AcpListSessionsResult {
  sessions: AcpSessionEntry[];
}

// ---------------------------------------------------------------------------
// ACP Protocol — prompts / messages
// ---------------------------------------------------------------------------

/** A single message within an ACP conversation. */
export interface AcpMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | AcpContentBlock[];
}

/** A typed content block within a message. */
export interface AcpContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  content?: string | AcpContentBlock[];
  isError?: boolean;
  thinking?: string;
}

/** Parameters for `prompt/send`. */
export interface AcpPromptSendParams {
  sessionId: string;
  prompt: string;
}

// ---------------------------------------------------------------------------
// ACP Protocol — session/update notifications
// ---------------------------------------------------------------------------

/**
 * `session/update` notification payload streamed from the agent.
 * Each update carries one typed event.
 */
export interface AcpSessionUpdateParams {
  sessionId: string;
  event: AcpUpdateEvent;
}

/** Union of all possible update event types. */
export type AcpUpdateEvent =
  | AcpTextEvent
  | AcpThinkingEvent
  | AcpToolCallEvent
  | AcpToolResultEvent
  | AcpTurnEndEvent
  | AcpErrorEvent
  | AcpPermissionRequestEvent;

export interface AcpTextEvent {
  type: 'text';
  text: string;
  /** Whether this is a streaming delta (true) or a full replacement (false). */
  isDelta?: boolean;
}

export interface AcpThinkingEvent {
  type: 'thinking';
  thinking: string;
  isDelta?: boolean;
}

export interface AcpToolCallEvent {
  type: 'tool_call';
  id: string;
  name: string;
  input: unknown;
}

export interface AcpToolResultEvent {
  type: 'tool_result';
  id: string;
  result: unknown;
  isError?: boolean;
}

export interface AcpTurnEndEvent {
  type: 'turn_end';
  reason?: 'complete' | 'cancelled' | 'error';
}

export interface AcpErrorEvent {
  type: 'error';
  message: string;
  code?: number;
}

/** Emitted when the agent requires user approval for a privileged action. */
export interface AcpPermissionRequestEvent {
  type: 'permission_request';
  requestId: string;
  kind: 'read' | 'edit' | 'delete' | 'execute' | 'fetch' | 'other';
  description: string;
}

// ---------------------------------------------------------------------------
// ACP Protocol — permissions
// ---------------------------------------------------------------------------

/** Parameters for `permission/response`. */
export interface AcpPermissionResponseParams {
  sessionId: string;
  requestId: string;
  approved: boolean;
}

// ---------------------------------------------------------------------------
// Extension-internal types
// ---------------------------------------------------------------------------

/** Connection states for an agent. */
export enum AgentConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Error = 'error',
}

/** Persisted configuration for a single ACP agent. */
export interface AgentConfig {
  /** Display name shown in the UI. */
  name: string;
  /** Executable or npx package command to spawn. */
  command: string;
  /** Extra CLI arguments. */
  args: string[];
  /**
   * Environment variable overrides.
   * Values may contain ${env:VAR_NAME} placeholders that are resolved at
   * spawn time from the host process environment.
   */
  env: Record<string, string>;
}

/** Runtime session maintained in memory. */
export interface AgentSession {
  sessionId: string;
  agentName: string;
  title?: string;
  createdAt: Date;
  messages: ChatMessage[];
}

/** A single user/assistant message stored in the UI. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCallRecord[];
  thinking?: string;
}

/** A recorded tool invocation within an assistant turn. */
export interface ToolCallRecord {
  id: string;
  name: string;
  input: unknown;
  result?: unknown;
  isError?: boolean;
}

/** Messages sent between the extension host and the webview. */
export type WebviewMessage =
  | { type: 'setState'; state: WebviewState }
  | { type: 'appendText'; text: string; sessionId: string }
  | { type: 'appendThinking'; thinking: string; sessionId: string }
  | { type: 'toolCall'; record: ToolCallRecord; sessionId: string }
  | { type: 'toolResult'; id: string; result: unknown; isError: boolean; sessionId: string }
  | { type: 'turnEnd'; sessionId: string }
  | { type: 'error'; message: string }
  | { type: 'permissionRequest'; requestId: string; kind: string; description: string; sessionId: string }
  | { type: 'sessionCreated'; session: AgentSession }
  | { type: 'sessionsLoaded'; sessions: AgentSession[] };

/** Commands from the webview to the extension host. */
export type ExtensionMessage =
  | { type: 'sendPrompt'; text: string; sessionId: string }
  | { type: 'newSession'; agentName: string }
  | { type: 'cancelTurn'; sessionId: string }
  | { type: 'permissionResponse'; requestId: string; approved: boolean; sessionId: string }
  | { type: 'ready' };

/** The full serializable state pushed to the webview on init/reconnect. */
export interface WebviewState {
  agents: AgentConfig[];
  connectedAgents: string[];
  sessions: AgentSession[];
  activeSessionId?: string;
}
