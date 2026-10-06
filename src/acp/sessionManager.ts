/**
 * acp-vscode — Session Manager
 *
 * Maintains the in-memory state of all ACP sessions across all connected
 * agents. Listens to session/update events from AgentManager and updates
 * session state accordingly.
 *
 * Responsibilities:
 *   - Creating and storing AgentSession objects.
 *   - Appending streaming events (text, thinking, tool calls) to messages.
 *   - Notifying the chat WebviewProvider of state changes.
 *   - Handling permission requests (auto-approve or prompt the user).
 *
 * @module acp/sessionManager
 */

import * as vscode from 'vscode';
import { uuidv4 } from './uuid';
import { AgentManager } from './agentManager';
import { ConfigManager } from '../config/agentConfig';
import { Logger } from '../utils/logger';
import {
  AgentSession,
  ChatMessage,
  ToolCallRecord,
  AcpSessionUpdateParams,
  AcpUpdateEvent,
  AcpPermissionRequestEvent,
} from '../types';

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

/**
 * Central store for all ACP sessions in the current VS Code window.
 *
 * Sessions are keyed by their ACP-assigned sessionId. The manager exposes
 * typed event emitters that the ChatWebviewProvider subscribes to in order
 * to push incremental updates to the webview.
 */
export class SessionManager implements vscode.Disposable {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly log: Logger;
  private readonly agentManager: AgentManager;
  private readonly configManager: ConfigManager;

  /** The sessionId of the session currently visible in the chat panel. */
  private activeSessionId: string | undefined;

  // Downstream event emitters used by the chat webview.
  private readonly _onSessionCreated = new vscode.EventEmitter<AgentSession>();
  private readonly _onTextAppended = new vscode.EventEmitter<{ sessionId: string; text: string }>();
  private readonly _onThinkingAppended = new vscode.EventEmitter<{ sessionId: string; thinking: string }>();
  private readonly _onToolCall = new vscode.EventEmitter<{ sessionId: string; record: ToolCallRecord }>();
  private readonly _onToolResult = new vscode.EventEmitter<{ sessionId: string; id: string; result: unknown; isError: boolean }>();
  private readonly _onTurnEnd = new vscode.EventEmitter<{ sessionId: string }>();
  private readonly _onPermissionRequest = new vscode.EventEmitter<{
    agentName: string;
    sessionId: string;
    requestId: string;
    kind: string;
    description: string;
  }>();

  public readonly onSessionCreated = this._onSessionCreated.event;
  public readonly onTextAppended = this._onTextAppended.event;
  public readonly onThinkingAppended = this._onThinkingAppended.event;
  public readonly onToolCall = this._onToolCall.event;
  public readonly onToolResult = this._onToolResult.event;
  public readonly onTurnEnd = this._onTurnEnd.event;
  public readonly onPermissionRequest = this._onPermissionRequest.event;

  constructor(agentManager: AgentManager, configManager: ConfigManager) {
    this.agentManager = agentManager;
    this.configManager = configManager;
    this.log = Logger.getInstance();

    // Subscribe to session/update events from all agents.
    agentManager.onSessionUpdate(({ agentName, params }) => {
      this.handleSessionUpdate(agentName, params);
    });
  }

  // -------------------------------------------------------------------------
  // Session lifecycle
  // -------------------------------------------------------------------------

  /**
   * Creates a new ACP session on the specified agent and registers it locally.
   * @param agentName - The connected agent to create the session on.
   * @returns The created AgentSession.
   */
  public async createSession(agentName: string): Promise<AgentSession> {
    const sessionId = await this.agentManager.newSession(agentName);
    this.agentManager.registerSession(sessionId, agentName);

    const session: AgentSession = {
      sessionId,
      agentName,
      title: `Session ${new Date().toLocaleTimeString()}`,
      createdAt: new Date(),
      messages: [],
    };

    this.sessions.set(sessionId, session);
    this.activeSessionId = sessionId;

    this._onSessionCreated.fire(session);
    this.log.info('Session created', { sessionId, agentName });

    return session;
  }

  /**
   * Appends a user message to the local session state.
   * This is called before sending the prompt to the agent so that the UI
   * reflects the message immediately.
   *
   * @param sessionId - Target session.
   * @param text - User message text.
   */
  public appendUserMessage(sessionId: string, text: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) { return; }

    session.messages.push({
      id: uuidv4(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    });
  }

  /** Returns a session by its id, or undefined if not found. */
  public getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Returns all sessions for a given agent, sorted by creation time. */
  public getSessionsForAgent(agentName: string): AgentSession[] {
    return [...this.sessions.values()]
      .filter(s => s.agentName === agentName)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  /** Returns all sessions across all agents. */
  public getAllSessions(): AgentSession[] {
    return [...this.sessions.values()];
  }

  /** Returns the id of the currently active (visible) session. */
  public getActiveSessionId(): string | undefined {
    return this.activeSessionId;
  }

  /** Sets the active session. */
  public setActiveSession(sessionId: string): void {
    this.activeSessionId = sessionId;
  }

  // -------------------------------------------------------------------------
  // Session/update event handling
  // -------------------------------------------------------------------------

  /**
   * Routes an incoming `session/update` notification to the appropriate
   * in-memory session and fires the corresponding downstream event.
   */
  private handleSessionUpdate(agentName: string, params: AcpSessionUpdateParams): void {
    const { sessionId, event } = params;
    const session = this.sessions.get(sessionId);

    if (!session) {
      this.log.warn('Received session/update for unknown session', { sessionId, agentName });
      return;
    }

    this.applyEvent(agentName, session, event);
  }

  /**
   * Applies a single update event to the in-memory session state and fires
   * the matching downstream event for the webview.
   */
  private applyEvent(agentName: string, session: AgentSession, event: AcpUpdateEvent): void {
    switch (event.type) {
      case 'text': {
        // Append text to the last assistant message or create a new one.
        let last = session.messages[session.messages.length - 1];
        if (!last || last.role !== 'assistant') {
          last = { id: uuidv4(), role: 'assistant', content: '', timestamp: new Date() };
          session.messages.push(last);
        }
        last.content += event.text;
        this._onTextAppended.fire({ sessionId: session.sessionId, text: event.text });
        break;
      }

      case 'thinking': {
        let last = session.messages[session.messages.length - 1];
        if (!last || last.role !== 'assistant') {
          last = { id: uuidv4(), role: 'assistant', content: '', timestamp: new Date() };
          session.messages.push(last);
        }
        last.thinking = (last.thinking ?? '') + event.thinking;
        this._onThinkingAppended.fire({ sessionId: session.sessionId, thinking: event.thinking });
        break;
      }

      case 'tool_call': {
        const record: ToolCallRecord = {
          id: event.id,
          name: event.name,
          input: event.input,
        };
        // Attach to last assistant message.
        let last = session.messages[session.messages.length - 1];
        if (!last || last.role !== 'assistant') {
          last = { id: uuidv4(), role: 'assistant', content: '', timestamp: new Date() };
          session.messages.push(last);
        }
        last.toolCalls = last.toolCalls ?? [];
        last.toolCalls.push(record);
        this._onToolCall.fire({ sessionId: session.sessionId, record });
        break;
      }

      case 'tool_result': {
        // Locate the matching tool call and attach the result.
        for (let i = session.messages.length - 1; i >= 0; i--) {
          const msg = session.messages[i];
          const tc = msg.toolCalls?.find(t => t.id === event.id);
          if (tc) {
            tc.result = event.result;
            tc.isError = event.isError;
            break;
          }
        }
        this._onToolResult.fire({
          sessionId: session.sessionId,
          id: event.id,
          result: event.result,
          isError: event.isError ?? false,
        });
        break;
      }

      case 'turn_end': {
        this._onTurnEnd.fire({ sessionId: session.sessionId });
        break;
      }

      case 'error': {
        this.log.error(`Agent error in session ${session.sessionId}`, new Error(event.message));
        break;
      }

      case 'permission_request': {
        this.handlePermissionRequest(agentName, session.sessionId, event);
        break;
      }

      default:
        this.log.debug('Unhandled event type', { event });
    }
  }

  // -------------------------------------------------------------------------
  // Permission handling
  // -------------------------------------------------------------------------

  /**
   * Handles incoming permission requests from the agent.
   * If auto-approve is configured, immediately sends approval.
   * Otherwise, shows a VS Code information message with Approve/Deny buttons.
   */
  private async handlePermissionRequest(
    agentName: string,
    sessionId: string,
    event: AcpPermissionRequestEvent
  ): Promise<void> {
    const policy = this.configManager.getAutoApprovePermissions();

    if (policy === 'allowAll') {
      await this.agentManager.respondToPermission(agentName, {
        sessionId,
        requestId: event.requestId,
        approved: true,
      });
      this.log.debug('Auto-approved permission request', { requestId: event.requestId });
      return;
    }

    // Fire event for the webview to show the permission dialog inline.
    this._onPermissionRequest.fire({
      agentName,
      sessionId,
      requestId: event.requestId,
      kind: event.kind,
      description: event.description,
    });

    // Also show a VS Code notification as a fallback.
    const choice = await vscode.window.showInformationMessage(
      `[ACP] Agent '${agentName}' requests permission:\n${event.description}`,
      { modal: false },
      'Approve',
      'Deny'
    );

    const approved = choice === 'Approve';
    await this.agentManager.respondToPermission(agentName, {
      sessionId,
      requestId: event.requestId,
      approved,
    });
  }

  public dispose(): void {
    this.sessions.clear();
    this._onSessionCreated.dispose();
    this._onTextAppended.dispose();
    this._onThinkingAppended.dispose();
    this._onToolCall.dispose();
    this._onToolResult.dispose();
    this._onTurnEnd.dispose();
    this._onPermissionRequest.dispose();
  }
}
