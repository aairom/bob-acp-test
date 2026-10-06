/**
 * acp-vscode — Extension Entry Point
 *
 * This is the first file executed when VS Code activates the extension.
 * It wires together all singleton services, registers the tree view and
 * commands, and attaches everything to context.subscriptions for automatic
 * cleanup on deactivation.
 *
 * Activation trigger: `onStartupFinished` (see package.json).
 * This ensures the extension is always ready without blocking editor startup.
 *
 * Architecture:
 *   ConfigManager  ──► AgentManager  ──► SessionManager
 *                           │                   │
 *                           ▼                   ▼
 *                   AgentsTreeProvider   ChatWebviewProvider
 *
 * @module extension
 */

import * as vscode from 'vscode';
import { Logger } from './utils/logger';
import { ConfigManager } from './config/agentConfig';
import { AgentManager } from './acp/agentManager';
import { SessionManager } from './acp/sessionManager';
import { AgentsTreeProvider } from './providers/agentsTreeProvider';
import { ChatWebviewProvider } from './webview/chatWebviewProvider';
import { registerCommands } from './handlers/commands';

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

/**
 * Called by VS Code when the extension activates.
 * Sets up all services and registers views / commands.
 *
 * @param context - The extension context provided by VS Code.
 */
export function activate(context: vscode.ExtensionContext): void {
  const log = Logger.getInstance();
  log.info('ACP for VSCode activating…', { version: '1.0.0' });

  // ── Services ───────────────────────────────────────────────────────────────
  const configManager = new ConfigManager();
  const agentManager = new AgentManager(configManager);
  const sessionManager = new SessionManager(agentManager, configManager);
  const chatProvider = new ChatWebviewProvider(context, agentManager, sessionManager);

  // Apply traffic logging preference immediately.
  log.setTrafficEnabled(configManager.getLogTraffic());

  // ── Agents sidebar tree view ───────────────────────────────────────────────
  const treeProvider = new AgentsTreeProvider(agentManager, sessionManager);
  const treeView = vscode.window.createTreeView('acp.agentsView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // ── Commands ───────────────────────────────────────────────────────────────
  const commandDisposables = registerCommands(
    agentManager,
    sessionManager,
    configManager,
    chatProvider
  );

  // ── Configuration change listener ──────────────────────────────────────────
  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('acp')) {
      log.setTrafficEnabled(configManager.getLogTraffic());
      treeProvider.refresh();
      log.info('ACP configuration updated.');
    }
  });

  // ── Register all disposables ───────────────────────────────────────────────
  context.subscriptions.push(
    agentManager,
    sessionManager,
    chatProvider,
    treeProvider,
    treeView,
    configListener,
    log,  // disposes both output channels on deactivation
    ...commandDisposables
  );

  log.info('ACP for VSCode activated.');
}

// ---------------------------------------------------------------------------
// Deactivation
// ---------------------------------------------------------------------------

/**
 * Called by VS Code when the extension deactivates (window close, reload,
 * or explicit disable). All cleanup is handled by the subscriptions
 * registered above, so this function only needs to log the event.
 */
export function deactivate(): void {
  // Disposables registered in context.subscriptions are cleaned up automatically.
  // Logger is disposed as part of context.subscriptions, so we cannot log here.
}
