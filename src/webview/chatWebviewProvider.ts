/**
 * acp-vscode — Chat Webview Provider
 *
 * Manages the WebviewPanel that renders the ACP chat UI.
 * Acts as the bridge between the VS Code extension host (SessionManager,
 * AgentManager) and the webview HTML/JS frontend.
 *
 * Responsibilities:
 *   - Creating and showing the WebviewPanel with a CSP-safe HTML shell.
 *   - Forwarding SessionManager events into the webview as postMessage calls.
 *   - Receiving commands from the webview and routing them to the correct
 *     AgentManager / SessionManager methods.
 *   - Pushing full state on webview re-attach (panel re-reveal).
 *
 * Security: The webview uses a strict Content-Security-Policy. No external
 * scripts or network requests are allowed from within the webview.
 *
 * @module webview/chatWebviewProvider
 */

import * as vscode from 'vscode';
import { AgentManager } from '../acp/agentManager';
import { SessionManager } from '../acp/sessionManager';
import { Logger } from '../utils/logger';
import { ExtensionMessage, WebviewState } from '../types';

// ---------------------------------------------------------------------------
// ChatWebviewProvider
// ---------------------------------------------------------------------------

/**
 * Manages a single persistent WebviewPanel for the ACP chat interface.
 * The panel is created on first open and re-revealed on subsequent calls.
 */
export class ChatWebviewProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly log: Logger;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly agentManager: AgentManager,
    private readonly sessionManager: SessionManager
  ) {
    this.log = Logger.getInstance();
    this.subscribeToSessionEvents();
  }

  // -------------------------------------------------------------------------
  // Panel lifecycle
  // -------------------------------------------------------------------------

  /**
   * Opens (or reveals) the chat panel.
   * @param agentName - If provided, focuses this agent's session.
   * @param sessionId - If provided, switches to this specific session.
   */
  public show(agentName?: string, sessionId?: string): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, false);
      if (agentName) {
        this.agentManager.setActiveAgent(agentName);
      }
      if (sessionId) {
        this.sessionManager.setActiveSession(sessionId);
      }
      this.sendFullState();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'acpChat',
      'ACP Chat',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        ],
      }
    );

    this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'acp-icon.svg');
    this.panel.webview.html = this.buildHtml(this.panel.webview);

    // Handle messages from the webview.
    this.panel.webview.onDidReceiveMessage(
      (msg: ExtensionMessage) => this.handleWebviewMessage(msg),
      undefined,
      this.disposables
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    }, null, this.disposables);

    // Send initial state once the webview signals it is ready.
    // The 'ready' message is sent by the webview script on DOMContentLoaded.
  }

  // -------------------------------------------------------------------------
  // Webview → Extension host message handler
  // -------------------------------------------------------------------------

  private async handleWebviewMessage(msg: ExtensionMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        this.sendFullState();
        break;

      case 'newSession': {
        const { agentName } = msg;
        try {
          // Connect if not already connected.
          if (this.agentManager.getState(agentName) !== 
              (await import('../types')).AgentConnectionState.Connected) {
            await this.agentManager.connect(agentName);
          }
          await this.sessionManager.createSession(agentName);
        } catch (err) {
          this.postError(`Failed to create session: ${(err as Error).message}`);
        }
        break;
      }

      case 'sendPrompt': {
        const { text, sessionId } = msg;
        try {
          this.sessionManager.appendUserMessage(sessionId, text);
          await this.agentManager.sendPrompt({ sessionId, prompt: text });
        } catch (err) {
          this.postError(`Failed to send prompt: ${(err as Error).message}`);
        }
        break;
      }

      case 'cancelTurn': {
        const { sessionId } = msg;
        try {
          await this.agentManager.cancelTurn(sessionId);
        } catch (err) {
          this.log.warn('cancelTurn failed', { error: (err as Error).message });
        }
        break;
      }

      case 'permissionResponse': {
        const { requestId, approved, sessionId } = msg;
        const session = this.sessionManager.getSession(sessionId);
        if (session) {
          try {
            await this.agentManager.respondToPermission(session.agentName, {
              sessionId,
              requestId,
              approved,
            });
          } catch (err) {
            this.log.warn('permissionResponse failed', { error: (err as Error).message });
          }
        }
        break;
      }

      default:
        this.log.warn('Unknown webview message type', { msg });
    }
  }

  // -------------------------------------------------------------------------
  // Extension host → Webview event relay
  // -------------------------------------------------------------------------

  private subscribeToSessionEvents(): void {
    this.disposables.push(
      this.sessionManager.onSessionCreated((session) => {
        this.post({ type: 'sessionCreated', session });
      }),
      this.sessionManager.onTextAppended(({ sessionId, text }) => {
        this.post({ type: 'appendText', text, sessionId });
      }),
      this.sessionManager.onThinkingAppended(({ sessionId, thinking }) => {
        this.post({ type: 'appendThinking', thinking, sessionId });
      }),
      this.sessionManager.onToolCall(({ sessionId, record }) => {
        this.post({ type: 'toolCall', record, sessionId });
      }),
      this.sessionManager.onToolResult(({ sessionId, id, result, isError }) => {
        this.post({ type: 'toolResult', id, result, isError, sessionId });
      }),
      this.sessionManager.onTurnEnd(({ sessionId }) => {
        this.post({ type: 'turnEnd', sessionId });
      }),
      this.sessionManager.onPermissionRequest((event) => {
        this.post({
          type: 'permissionRequest',
          requestId: event.requestId,
          kind: event.kind,
          description: event.description,
          sessionId: event.sessionId,
        });
      })
    );
  }

  // -------------------------------------------------------------------------
  // State sync
  // -------------------------------------------------------------------------

  /** Sends the full current state to the webview. */
  private sendFullState(): void {
    const state: WebviewState = {
      agents: this.agentManager.getAgents(),
      connectedAgents: this.agentManager.getConnectedAgentNames(),
      sessions: this.sessionManager.getAllSessions(),
      activeSessionId: this.sessionManager.getActiveSessionId(),
    };
    this.post({ type: 'setState', state });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private post(message: object): void {
    this.panel?.webview.postMessage(message);
  }

  private postError(message: string): void {
    this.post({ type: 'error', message });
    vscode.window.showErrorMessage(`ACP: ${message}`);
  }

  // -------------------------------------------------------------------------
  // HTML shell
  // -------------------------------------------------------------------------

  /**
   * Builds the static HTML shell for the webview.
   * All styling is inline; no external resources are referenced.
   * The Content-Security-Policy restricts scripts to the nonce-tagged inline
   * script only.
   */
  private buildHtml(webview: vscode.Webview): string {
    // Generate a cryptographically random nonce for the CSP.
    const nonce = this.generateNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src 'unsafe-inline';
             script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ACP Chat</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --sidebar-bg: var(--vscode-sideBar-background);
      --user-bubble: var(--vscode-textBlockQuote-background);
      --tool-bg: var(--vscode-textPreformat-background, #1e1e1e);
      --font: var(--vscode-font-family);
      --font-size: var(--vscode-font-size, 13px);
      --code-font: var(--vscode-editor-font-family, monospace);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: var(--font);
      font-size: var(--font-size);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    /* ---- Header ---- */
    #header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    #agent-select {
      flex: 1;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--border);
      padding: 4px 8px;
      border-radius: 3px;
      font-size: var(--font-size);
    }
    .btn {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      padding: 4px 10px;
      border-radius: 3px;
      cursor: pointer;
      font-size: var(--font-size);
    }
    .btn:hover { background: var(--btn-hover); }
    .btn:disabled { opacity: 0.5; cursor: default; }
    /* ---- Messages ---- */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .msg { display: flex; flex-direction: column; gap: 4px; }
    .msg-user .bubble {
      background: var(--user-bubble);
      padding: 8px 12px;
      border-radius: 8px 8px 0 8px;
      align-self: flex-end;
      max-width: 85%;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .msg-assistant .bubble {
      padding: 8px 0;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .msg-label {
      font-size: 11px;
      opacity: 0.6;
      margin-bottom: 2px;
    }
    .msg-user .msg-label { text-align: right; }
    /* ---- Thinking block ---- */
    .thinking-block {
      font-style: italic;
      opacity: 0.65;
      font-size: 12px;
      padding: 4px 8px;
      border-left: 2px solid var(--border);
      margin-bottom: 6px;
    }
    /* ---- Tool call ---- */
    .tool-block {
      background: var(--tool-bg);
      border-radius: 4px;
      overflow: hidden;
      margin: 4px 0;
      font-family: var(--code-font);
      font-size: 12px;
    }
    .tool-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      cursor: pointer;
      background: rgba(255,255,255,0.05);
      user-select: none;
    }
    .tool-name { font-weight: 600; }
    .tool-status { margin-left: auto; font-size: 11px; opacity: 0.7; }
    .tool-body { padding: 8px 10px; display: none; }
    .tool-body.open { display: block; }
    pre { white-space: pre-wrap; word-break: break-all; }
    /* ---- Permission request ---- */
    .permission-block {
      border: 1px solid var(--btn-bg);
      border-radius: 6px;
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .permission-desc { font-size: 12px; }
    .permission-actions { display: flex; gap: 8px; }
    /* ---- Composer ---- */
    #composer {
      border-top: 1px solid var(--border);
      padding: 8px 12px;
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }
    #prompt-input {
      flex: 1;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--border);
      padding: 6px 10px;
      border-radius: 4px;
      font-family: var(--font);
      font-size: var(--font-size);
      resize: none;
      min-height: 38px;
      max-height: 160px;
    }
    #prompt-input:focus { outline: 1px solid var(--btn-bg); }
    /* ---- Status bar ---- */
    #status { font-size: 11px; opacity: 0.6; padding: 2px 12px 4px; flex-shrink: 0; }
    /* ---- Empty state ---- */
    #empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      opacity: 0.6;
    }
    #empty-state h2 { font-size: 16px; }
    #empty-state p { font-size: 12px; text-align: center; max-width: 260px; }
  </style>
</head>
<body>

<!-- Header: agent selector + action buttons -->
<div id="header">
  <select id="agent-select" title="Select Agent">
    <option value="">— select agent —</option>
  </select>
  <button class="btn" id="btn-new-session" title="New Session">＋ New</button>
  <button class="btn" id="btn-cancel" title="Cancel Turn" disabled>⏹ Cancel</button>
</div>

<!-- Message list -->
<div id="messages">
  <div id="empty-state">
    <h2>ACP Chat</h2>
    <p>Select an agent above and click <strong>＋ New</strong> to start a conversation.</p>
  </div>
</div>

<!-- Status line -->
<div id="status" id="status-bar"></div>

<!-- Composer -->
<div id="composer">
  <textarea id="prompt-input" rows="1"
    placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
    disabled></textarea>
  <button class="btn" id="btn-send" title="Send" disabled>Send</button>
</div>

<script nonce="${nonce}">
(function() {
  'use strict';
  const vscode = acquireVsCodeApi();

  // ── State ──────────────────────────────────────────────────────────────────
  let state = {
    agents: [],
    connectedAgents: [],
    sessions: [],
    activeSessionId: null,
    turnInProgress: false,
    // Map from sessionId to rendered assistant bubble element reference key
    activeBubbles: {}
  };

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const agentSelect   = document.getElementById('agent-select');
  const btnNewSession = document.getElementById('btn-new-session');
  const btnCancel     = document.getElementById('btn-cancel');
  const messagesEl    = document.getElementById('messages');
  const emptyState    = document.getElementById('empty-state');
  const promptInput   = document.getElementById('prompt-input');
  const btnSend       = document.getElementById('btn-send');
  const statusBar     = document.getElementById('status');

  // ── Helpers ────────────────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function setStatus(text) {
    statusBar.textContent = text;
  }

  function setTurnInProgress(active) {
    state.turnInProgress = active;
    promptInput.disabled = active || !state.activeSessionId;
    btnSend.disabled     = active || !state.activeSessionId;
    btnCancel.disabled   = !active;
    setStatus(active ? 'Agent is working…' : '');
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── Agent selector ─────────────────────────────────────────────────────────
  function rebuildAgentSelect() {
    const prev = agentSelect.value;
    while (agentSelect.options.length > 1) agentSelect.remove(1);
    state.agents.forEach(agent => {
      const opt = document.createElement('option');
      opt.value = agent.name;
      opt.textContent = agent.name + (state.connectedAgents.includes(agent.name) ? ' ●' : '');
      agentSelect.appendChild(opt);
    });
    if (prev) agentSelect.value = prev;
  }

  // ── Message rendering ──────────────────────────────────────────────────────
  function renderMessages(sessions) {
    const session = sessions.find(s => s.sessionId === state.activeSessionId);
    messagesEl.innerHTML = '';

    if (!session || session.messages.length === 0) {
      messagesEl.appendChild(emptyState);
      return;
    }

    session.messages.forEach(msg => {
      const el = buildMessageEl(msg);
      messagesEl.appendChild(el);
    });
    scrollToBottom();
  }

  function buildMessageEl(msg) {
    const wrap = document.createElement('div');
    wrap.classList.add('msg', msg.role === 'user' ? 'msg-user' : 'msg-assistant');
    wrap.dataset.msgId = msg.id;

    const label = document.createElement('div');
    label.className = 'msg-label';
    label.textContent = msg.role === 'user' ? 'You' : 'Agent';
    wrap.appendChild(label);

    if (msg.thinking) {
      const thinkEl = document.createElement('div');
      thinkEl.className = 'thinking-block';
      thinkEl.textContent = '💭 ' + msg.thinking;
      wrap.appendChild(thinkEl);
    }

    if (msg.toolCalls) {
      msg.toolCalls.forEach(tc => {
        wrap.appendChild(buildToolCallEl(tc));
      });
    }

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = msg.content;
    if (msg.role === 'assistant') {
      bubble.dataset.sessionId = state.activeSessionId;
    }
    wrap.appendChild(bubble);
    return wrap;
  }

  function buildToolCallEl(tc) {
    const block = document.createElement('div');
    block.className = 'tool-block';
    block.dataset.toolId = tc.id;

    const header = document.createElement('div');
    header.className = 'tool-header';
    header.innerHTML =
      '<span>⚙</span><span class="tool-name">' + escapeHtml(tc.name) + '</span>' +
      '<span class="tool-status">' + (tc.result !== undefined ? (tc.isError ? '✗' : '✓') : '…') + '</span>';

    const body = document.createElement('div');
    body.className = 'tool-body';
    const inputPre = document.createElement('pre');
    inputPre.textContent = JSON.stringify(tc.input, null, 2);
    body.appendChild(inputPre);
    if (tc.result !== undefined) {
      const resultPre = document.createElement('pre');
      resultPre.style.borderTop = '1px solid rgba(255,255,255,0.1)';
      resultPre.style.marginTop = '6px';
      resultPre.style.paddingTop = '6px';
      resultPre.textContent = JSON.stringify(tc.result, null, 2);
      body.appendChild(resultPre);
    }

    header.addEventListener('click', () => body.classList.toggle('open'));
    block.appendChild(header);
    block.appendChild(body);
    return block;
  }

  // ── Streaming helpers ──────────────────────────────────────────────────────
  function getOrCreateAssistantBubble(sessionId) {
    // Check for the current streaming bubble.
    const existing = messagesEl.querySelector(
      '.msg-assistant:last-child .bubble[data-session-id="' + sessionId + '"]'
    );
    if (existing) return existing;

    // Create a new assistant message row.
    const wrap = document.createElement('div');
    wrap.classList.add('msg', 'msg-assistant');
    const label = document.createElement('div');
    label.className = 'msg-label';
    label.textContent = 'Agent';
    wrap.appendChild(label);

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.dataset.sessionId = sessionId;
    wrap.appendChild(bubble);

    // Remove empty state if present.
    emptyState.remove();
    messagesEl.appendChild(wrap);
    return bubble;
  }

  // ── Permission request ─────────────────────────────────────────────────────
  function appendPermissionRequest(event) {
    const block = document.createElement('div');
    block.className = 'permission-block';
    block.dataset.requestId = event.requestId;

    const desc = document.createElement('div');
    desc.className = 'permission-desc';
    desc.textContent = '🔒 Permission request (' + escapeHtml(event.kind) + '): ' + escapeHtml(event.description);
    block.appendChild(desc);

    const actions = document.createElement('div');
    actions.className = 'permission-actions';

    const approveBtn = document.createElement('button');
    approveBtn.className = 'btn';
    approveBtn.textContent = 'Approve';
    approveBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'permissionResponse', requestId: event.requestId, approved: true, sessionId: event.sessionId });
      block.remove();
    });

    const denyBtn = document.createElement('button');
    denyBtn.className = 'btn';
    denyBtn.style.background = 'var(--vscode-inputValidation-errorBackground, #5a1d1d)';
    denyBtn.textContent = 'Deny';
    denyBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'permissionResponse', requestId: event.requestId, approved: false, sessionId: event.sessionId });
      block.remove();
    });

    actions.appendChild(approveBtn);
    actions.appendChild(denyBtn);
    block.appendChild(actions);

    emptyState.remove();
    messagesEl.appendChild(block);
    scrollToBottom();
  }

  // ── Message bus from extension host ───────────────────────────────────────
  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {

      case 'setState':
        state.agents         = msg.state.agents || [];
        state.connectedAgents = msg.state.connectedAgents || [];
        state.sessions       = msg.state.sessions || [];
        state.activeSessionId = msg.state.activeSessionId || null;
        rebuildAgentSelect();
        renderMessages(state.sessions);
        setTurnInProgress(false);
        if (state.activeSessionId) {
          promptInput.disabled = false;
          btnSend.disabled = false;
        }
        break;

      case 'sessionCreated': {
        const sess = msg.session;
        state.sessions.push(sess);
        state.activeSessionId = sess.sessionId;
        agentSelect.value = sess.agentName;
        messagesEl.innerHTML = '';
        messagesEl.appendChild(emptyState);
        promptInput.disabled = false;
        btnSend.disabled = false;
        setStatus('Session ready.');
        break;
      }

      case 'appendText': {
        if (msg.sessionId === state.activeSessionId) {
          const bubble = getOrCreateAssistantBubble(msg.sessionId);
          bubble.textContent += msg.text;
          scrollToBottom();
        }
        setTurnInProgress(true);
        break;
      }

      case 'appendThinking': {
        if (msg.sessionId === state.activeSessionId) {
          // Append to or create a thinking block just before the bubble.
          let thinking = messagesEl.querySelector('.msg-assistant:last-child .thinking-block');
          if (!thinking) {
            const wrap = messagesEl.querySelector('.msg-assistant:last-child') || (() => {
              const w = document.createElement('div');
              w.classList.add('msg', 'msg-assistant');
              const l = document.createElement('div');
              l.className = 'msg-label';
              l.textContent = 'Agent';
              w.appendChild(l);
              emptyState.remove();
              messagesEl.appendChild(w);
              return w;
            })();
            thinking = document.createElement('div');
            thinking.className = 'thinking-block';
            wrap.insertBefore(thinking, wrap.querySelector('.bubble') || null);
          }
          thinking.textContent = '💭 ' + (thinking.textContent.replace(/^💭 /, '') + msg.thinking);
          scrollToBottom();
        }
        break;
      }

      case 'toolCall': {
        if (msg.sessionId === state.activeSessionId) {
          // Append tool call block to last assistant message.
          let lastAssistant = messagesEl.querySelector('.msg-assistant:last-child');
          if (!lastAssistant) {
            lastAssistant = document.createElement('div');
            lastAssistant.classList.add('msg', 'msg-assistant');
            const label = document.createElement('div');
            label.className = 'msg-label';
            label.textContent = 'Agent';
            lastAssistant.appendChild(label);
            emptyState.remove();
            messagesEl.appendChild(lastAssistant);
          }
          const toolEl = buildToolCallEl(msg.record);
          // Insert before the bubble if it exists.
          const bubble = lastAssistant.querySelector('.bubble');
          lastAssistant.insertBefore(toolEl, bubble || null);
          scrollToBottom();
        }
        break;
      }

      case 'toolResult': {
        if (msg.sessionId === state.activeSessionId) {
          const block = messagesEl.querySelector('[data-tool-id="' + msg.id + '"]');
          if (block) {
            const statusEl = block.querySelector('.tool-status');
            if (statusEl) statusEl.textContent = msg.isError ? '✗' : '✓';
          }
        }
        break;
      }

      case 'turnEnd':
        setTurnInProgress(false);
        scrollToBottom();
        break;

      case 'error':
        setStatus('⚠ ' + msg.message);
        setTurnInProgress(false);
        break;

      case 'permissionRequest':
        appendPermissionRequest(msg);
        break;
    }
  });

  // ── UI event handlers ──────────────────────────────────────────────────────
  btnNewSession.addEventListener('click', () => {
    const agentName = agentSelect.value;
    if (!agentName) {
      setStatus('Please select an agent first.');
      return;
    }
    vscode.postMessage({ type: 'newSession', agentName });
  });

  btnCancel.addEventListener('click', () => {
    if (state.activeSessionId) {
      vscode.postMessage({ type: 'cancelTurn', sessionId: state.activeSessionId });
    }
  });

  function sendPrompt() {
    const text = promptInput.value.trim();
    if (!text || !state.activeSessionId || state.turnInProgress) return;
    promptInput.value = '';
    promptInput.style.height = 'auto';

    // Append user bubble immediately.
    const userWrap = document.createElement('div');
    userWrap.classList.add('msg', 'msg-user');
    const userLabel = document.createElement('div');
    userLabel.className = 'msg-label';
    userLabel.textContent = 'You';
    const userBubble = document.createElement('div');
    userBubble.className = 'bubble';
    userBubble.textContent = text;
    emptyState.remove();
    userWrap.appendChild(userLabel);
    userWrap.appendChild(userBubble);
    messagesEl.appendChild(userWrap);
    scrollToBottom();

    setTurnInProgress(true);
    vscode.postMessage({ type: 'sendPrompt', text, sessionId: state.activeSessionId });
  }

  btnSend.addEventListener('click', sendPrompt);

  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  });

  // Auto-resize textarea.
  promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = Math.min(promptInput.scrollHeight, 160) + 'px';
  });

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  vscode.postMessage({ type: 'ready' });

})();
</script>
</body>
</html>`;
  }

  /** Generates a random nonce string for the Content-Security-Policy. */
  private generateNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }

  public dispose(): void {
    this.panel?.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
