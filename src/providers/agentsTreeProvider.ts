/**
 * acp-vscode — Agents Tree Provider
 *
 * Implements vscode.TreeDataProvider<AgentTreeItem> to populate the Agents
 * sidebar view. Each agent appears as a parent node with its sessions as
 * children. Connection state is reflected in the node icon and contextValue,
 * which controls which inline toolbar buttons are shown via package.json menus.
 *
 * @module providers/agentsTreeProvider
 */

import * as vscode from 'vscode';
import { AgentManager } from '../acp/agentManager';
import { SessionManager } from '../acp/sessionManager';
import { AgentConnectionState, AgentConfig, AgentSession } from '../types';

// ---------------------------------------------------------------------------
// Tree item types
// ---------------------------------------------------------------------------

/** A single item in the Agents tree view. */
export class AgentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType: 'agent' | 'session',
    /** Raw data backing this item. */
    public readonly data: AgentConfig | AgentSession,
    /** Connection state (only relevant for agent-type items). */
    public readonly connectionState?: AgentConnectionState
  ) {
    super(label, collapsibleState);
  }
}

// ---------------------------------------------------------------------------
// AgentsTreeProvider
// ---------------------------------------------------------------------------

/**
 * Provides the data model for the ACP Agents sidebar tree view.
 *
 * Tree structure:
 *   [Agent Name] (connected/disconnected icon)
 *     └── [Session Title]
 *         ...
 */
export class AgentsTreeProvider
  implements vscode.TreeDataProvider<AgentTreeItem>, vscode.Disposable {

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined | void>();
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly agentManager: AgentManager,
    private readonly sessionManager: SessionManager
  ) {
    // Refresh when connection states change.
    this.disposables.push(
      agentManager.onConnectionStateChange(() => this.refresh()),
      agentManager.onAgentListChange(() => this.refresh()),
      sessionManager.onSessionCreated(() => this.refresh()),
      sessionManager.onTurnEnd(() => this.refresh())
    );
  }

  /** Triggers a full tree refresh. */
  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  // -------------------------------------------------------------------------
  // vscode.TreeDataProvider implementation
  // -------------------------------------------------------------------------

  getTreeItem(element: AgentTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AgentTreeItem): vscode.ProviderResult<AgentTreeItem[]> {
    if (!element) {
      // Root level: return all configured agents.
      return this.buildAgentNodes();
    }

    if (element.itemType === 'agent') {
      // Children of an agent node: its sessions.
      return this.buildSessionNodes(element.label);
    }

    return [];
  }

  // -------------------------------------------------------------------------
  // Node builders
  // -------------------------------------------------------------------------

  private buildAgentNodes(): AgentTreeItem[] {
    return this.agentManager.getAgents().map((config) => {
      const state = this.agentManager.getState(config.name);
      const isConnected = state === AgentConnectionState.Connected;
      const isConnecting = state === AgentConnectionState.Connecting;

      const sessions = this.sessionManager.getSessionsForAgent(config.name);
      const hasChildren = isConnected && sessions.length > 0;

      const item = new AgentTreeItem(
        config.name,
        hasChildren
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.None,
        'agent',
        config,
        state
      );

      // Context value drives which menus/buttons appear (see package.json).
      if (isConnected) {
        item.contextValue = 'agentConnected';
        item.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
        item.description = 'Connected';
      } else if (isConnecting) {
        item.contextValue = 'agentConnecting';
        item.iconPath = new vscode.ThemeIcon('loading~spin');
        item.description = 'Connecting…';
      } else if (state === AgentConnectionState.Error) {
        item.contextValue = 'agentError';
        item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
        item.description = 'Error';
      } else {
        item.contextValue = 'agentDisconnected';
        item.iconPath = new vscode.ThemeIcon('circle-outline');
        item.description = 'Disconnected';
      }

      item.tooltip = `${config.name} — ${item.description}\nCommand: ${config.command} ${config.args.join(' ')}`;
      item.command = isConnected
        ? { command: 'acp.openChatPanel', title: 'Open Chat', arguments: [config.name] }
        : { command: 'acp.connectAgent', title: 'Connect', arguments: [config.name] };

      return item;
    });
  }

  private buildSessionNodes(agentName: string): AgentTreeItem[] {
    return this.sessionManager.getSessionsForAgent(agentName).map((session) => {
      const item = new AgentTreeItem(
        session.title ?? session.sessionId,
        vscode.TreeItemCollapsibleState.None,
        'session',
        session
      );

      item.contextValue = 'session';
      item.iconPath = new vscode.ThemeIcon('comment-discussion');
      item.description = session.createdAt.toLocaleTimeString();
      item.tooltip = `Session ID: ${session.sessionId}\nCreated: ${session.createdAt.toLocaleString()}`;
      item.command = {
        command: 'acp.openChatPanel',
        title: 'Open Session',
        arguments: [agentName, session.sessionId],
      };

      return item;
    });
  }

  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this._onDidChangeTreeData.dispose();
  }
}
