/**
 * acp-vscode — Command Handlers
 *
 * Registers all VS Code commands contributed by the extension.
 * Each command is a thin adapter: it reads user intent (from args or quick-
 * pick prompts), delegates work to AgentManager / SessionManager / ConfigManager,
 * and surfaces feedback via VS Code notifications.
 *
 * All commands are registered in `registerCommands()` which returns a
 * Disposable array that the extension activation function adds to its
 * context.subscriptions.
 *
 * @module handlers/commands
 */

import * as vscode from 'vscode';
import { AgentManager } from '../acp/agentManager';
import { SessionManager } from '../acp/sessionManager';
import { ConfigManager } from '../config/agentConfig';
import { ChatWebviewProvider } from '../webview/chatWebviewProvider';
import { Logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Registers all commands contributed in package.json and returns their
 * disposables for cleanup on extension deactivation.
 *
 * @param agentManager - The singleton AgentManager instance.
 * @param sessionManager - The singleton SessionManager instance.
 * @param configManager - The singleton ConfigManager instance.
 * @param chatProvider - The ChatWebviewProvider for opening the chat panel.
 * @returns Array of vscode.Disposable instances.
 */
export function registerCommands(
  agentManager: AgentManager,
  sessionManager: SessionManager,
  configManager: ConfigManager,
  chatProvider: ChatWebviewProvider
): vscode.Disposable[] {
  const log = Logger.getInstance();

  return [

    // ── acp.connectAgent ────────────────────────────────────────────────────
    vscode.commands.registerCommand('acp.connectAgent', async (agentName?: string) => {
      const name = agentName ?? await pickAgent(agentManager, 'Select agent to connect');
      if (!name) { return; }

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `ACP: Connecting to ${name}…`, cancellable: false },
        async () => {
          try {
            await agentManager.connect(name);
            vscode.window.showInformationMessage(`ACP: Connected to ${name}.`);
          } catch (err) {
            vscode.window.showErrorMessage(`ACP: Failed to connect to ${name}: ${(err as Error).message}`);
            log.error(`Connect failed: ${name}`, err as Error);
          }
        }
      );
    }),

    // ── acp.disconnectAgent ─────────────────────────────────────────────────
    vscode.commands.registerCommand('acp.disconnectAgent', async (agentName?: string) => {
      const name = agentName ?? await pickConnectedAgent(agentManager, 'Select agent to disconnect');
      if (!name) { return; }
      try {
        await agentManager.disconnect(name);
        vscode.window.showInformationMessage(`ACP: Disconnected from ${name}.`);
      } catch (err) {
        vscode.window.showErrorMessage(`ACP: Failed to disconnect: ${(err as Error).message}`);
      }
    }),

    // ── acp.restartAgent ────────────────────────────────────────────────────
    vscode.commands.registerCommand('acp.restartAgent', async (agentName?: string) => {
      const name = agentName ?? await pickConnectedAgent(agentManager, 'Select agent to restart');
      if (!name) { return; }

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `ACP: Restarting ${name}…`, cancellable: false },
        async () => {
          try {
            await agentManager.restart(name);
            vscode.window.showInformationMessage(`ACP: ${name} restarted.`);
          } catch (err) {
            vscode.window.showErrorMessage(`ACP: Failed to restart ${name}: ${(err as Error).message}`);
          }
        }
      );
    }),

    // ── acp.newConversation ─────────────────────────────────────────────────
    vscode.commands.registerCommand('acp.newConversation', async (agentName?: string) => {
      const name = agentName ?? await pickConnectedAgent(agentManager, 'Select agent for new conversation');
      if (!name) { return; }
      try {
        await sessionManager.createSession(name);
        chatProvider.show(name);
      } catch (err) {
        // If not connected yet, connect first then create session.
        if ((err as Error).message.includes('not connected')) {
          try {
            await agentManager.connect(name);
            await sessionManager.createSession(name);
            chatProvider.show(name);
          } catch (innerErr) {
            vscode.window.showErrorMessage(`ACP: ${(innerErr as Error).message}`);
          }
        } else {
          vscode.window.showErrorMessage(`ACP: ${(err as Error).message}`);
        }
      }
    }),

    // ── acp.openChatPanel ───────────────────────────────────────────────────
    vscode.commands.registerCommand('acp.openChatPanel', (agentName?: string, sessionId?: string) => {
      chatProvider.show(agentName, sessionId);
    }),

    // ── acp.cancelTurn ──────────────────────────────────────────────────────
    vscode.commands.registerCommand('acp.cancelTurn', async () => {
      const sessionId = sessionManager.getActiveSessionId();
      if (!sessionId) {
        vscode.window.showInformationMessage('ACP: No active session to cancel.');
        return;
      }
      try {
        await agentManager.cancelTurn(sessionId);
      } catch (err) {
        vscode.window.showErrorMessage(`ACP: Cancel failed: ${(err as Error).message}`);
      }
    }),

    // ── acp.addAgentConfig ──────────────────────────────────────────────────
    vscode.commands.registerCommand('acp.addAgentConfig', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Agent display name (e.g., My Custom Agent)',
        placeHolder: 'Agent Name',
        validateInput: (v) => v.trim() ? null : 'Name cannot be empty.',
      });
      if (!name) { return; }

      const command = await vscode.window.showInputBox({
        prompt: 'Agent command (e.g., npx my-agent-cli@latest)',
        placeHolder: 'npx <package> or /path/to/agent',
        validateInput: (v) => v.trim() ? null : 'Command cannot be empty.',
      });
      if (!command) { return; }

      const argsStr = await vscode.window.showInputBox({
        prompt: 'Additional arguments (space-separated, leave empty for none)',
        placeHolder: '--acp --flag value',
      });

      const args = argsStr ? argsStr.trim().split(/\s+/) : [];

      await configManager.saveAgent({ name: name.trim(), command: command.trim(), args, env: {} });
      vscode.window.showInformationMessage(
        `ACP: Agent '${name}' saved. Add API keys via Settings if needed.`
      );
    }),

    // ── acp.removeAgent ─────────────────────────────────────────────────────
    vscode.commands.registerCommand('acp.removeAgent', async (agentName?: string) => {
      const name = agentName ?? await pickAgent(agentManager, 'Select agent to remove');
      if (!name) { return; }

      const confirm = await vscode.window.showWarningMessage(
        `Remove agent '${name}' from settings?`,
        { modal: true },
        'Remove'
      );
      if (confirm !== 'Remove') { return; }

      // Disconnect if running.
      if (agentManager.getConnectedAgentNames().includes(name)) {
        await agentManager.disconnect(name);
      }
      await configManager.removeAgent(name);
      vscode.window.showInformationMessage(`ACP: Agent '${name}' removed.`);
    }),

    // ── acp.showLog ─────────────────────────────────────────────────────────
    vscode.commands.registerCommand('acp.showLog', () => {
      Logger.getInstance().show();
    }),

    // ── acp.showTrafficLog ──────────────────────────────────────────────────
    vscode.commands.registerCommand('acp.showTrafficLog', () => {
      Logger.getInstance().showTraffic();
    }),

    // ── acp.refreshSessions ─────────────────────────────────────────────────
    vscode.commands.registerCommand('acp.refreshSessions', async (agentName?: string) => {
      const name = agentName ?? await pickConnectedAgent(agentManager, 'Select agent');
      if (!name) { return; }
      try {
        const result = await agentManager.listSessions(name);
        log.info(`Refreshed sessions for ${name}`, { count: result.sessions.length });
        vscode.window.showInformationMessage(`ACP: Found ${result.sessions.length} session(s) for ${name}.`);
      } catch (err) {
        vscode.window.showErrorMessage(`ACP: Failed to refresh sessions: ${(err as Error).message}`);
      }
    }),
  ];
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Shows a QuickPick with all configured agents.
 * @returns Selected agent name, or undefined if cancelled.
 */
async function pickAgent(agentManager: AgentManager, placeholder: string): Promise<string | undefined> {
  const agents = agentManager.getAgents();
  if (agents.length === 0) {
    vscode.window.showInformationMessage('ACP: No agents configured. Use "ACP: Add Agent Configuration".');
    return undefined;
  }

  const items = agents.map(a => ({
    label: a.name,
    description: a.command,
  }));

  const pick = await vscode.window.showQuickPick(items, { placeHolder: placeholder });
  return pick?.label;
}

/**
 * Shows a QuickPick with only currently connected agents.
 * @returns Selected agent name, or undefined if cancelled.
 */
async function pickConnectedAgent(agentManager: AgentManager, placeholder: string): Promise<string | undefined> {
  const connected = agentManager.getConnectedAgentNames();
  if (connected.length === 0) {
    vscode.window.showInformationMessage('ACP: No agents are currently connected.');
    return undefined;
  }
  if (connected.length === 1) {
    return connected[0];
  }

  const pick = await vscode.window.showQuickPick(
    connected.map(n => ({ label: n })),
    { placeHolder: placeholder }
  );
  return pick?.label;
}
