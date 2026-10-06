# Architecture — ACP for VSCode

This document describes the complete technical architecture of the ACP for VSCode extension.

---

## High-Level Component Map

```mermaid
flowchart TD
    subgraph VS_CODE["VS Code Extension Host (Node.js)"]
        EXT["extension.ts\nActivation + wiring"]
        CFG["ConfigManager\nsrc/config/agentConfig.ts"]
        AM["AgentManager\nsrc/acp/agentManager.ts"]
        CLIENT["AcpClient\nsrc/acp/acpClient.ts"]
        SM["SessionManager\nsrc/acp/sessionManager.ts"]
        TREE["AgentsTreeProvider\nsrc/providers/agentsTreeProvider.ts"]
        WV["ChatWebviewProvider\nsrc/webview/chatWebviewProvider.ts"]
        CMD["Command Handlers\nsrc/handlers/commands.ts"]
        LOG["Logger\nsrc/utils/logger.ts"]
    end

    subgraph WEBVIEW["Webview Sandbox (isolated renderer)"]
        HTML["HTML+CSS+JS\nChat UI"]
    end

    subgraph AGENTS["ACP Agent Processes (child processes)"]
        A1["Claude Code ACP\n(stdin/stdout)"]
        A2["Gemini CLI\n(stdin/stdout)"]
        AN["… other agents\n(stdin/stdout)"]
    end

    EXT --> CFG & AM & SM & TREE & WV & CMD & LOG
    CFG --> AM
    AM -->|"owns N"| CLIENT
    CLIENT -->|"spawn + JSON-RPC"| A1 & A2 & AN
    AM -->|"session/update events"| SM
    SM -->|"typed events"| WV
    WV -->|"postMessage"| HTML
    HTML -->|"postMessage"| WV
    TREE -->|"tree data"| EXT
```

---

## Transport Layer: JSON-RPC 2.0 over stdio

The ACP protocol uses **newline-delimited JSON** (NDJSON) over the agent process's stdin/stdout pipes.

```
Extension Host stdin  ──► Agent process stdout
Extension Host stdout ◄── Agent process stdin
```

Each JSON object is followed by a single `\n` character. The `AcpClient` class maintains a rolling string buffer and splits on newlines to extract complete frames.

### Message Flow

```mermaid
sequenceDiagram
    participant EXT as AcpClient (host)
    participant PROC as Agent Process

    Note over EXT,PROC: Connection setup
    EXT->>PROC: {"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}\n
    PROC-->>EXT: {"jsonrpc":"2.0","id":1,"result":{...}}\n
    EXT->>PROC: {"jsonrpc":"2.0","method":"initialized","params":{}}\n

    Note over EXT,PROC: Session lifecycle
    EXT->>PROC: {"jsonrpc":"2.0","id":2,"method":"session/new","params":{"workingDirectory":"..."}}\n
    PROC-->>EXT: {"jsonrpc":"2.0","id":2,"result":{"sessionId":"abc-123"}}\n

    Note over EXT,PROC: Prompt + streaming
    EXT->>PROC: {"jsonrpc":"2.0","id":3,"method":"prompt/send","params":{"sessionId":"abc-123","prompt":"Hello"}}\n
    PROC-->>EXT: {"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"abc-123","event":{"type":"text","text":"Hi"}}}\n
    PROC-->>EXT: {"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"abc-123","event":{"type":"turn_end"}}}\n

    Note over EXT,PROC: Shutdown
    EXT->>PROC: {"jsonrpc":"2.0","method":"shutdown","params":{}}\n
```

---

## Module Responsibilities

### `src/extension.ts`
- Extension entry point called by VS Code on activation.
- Instantiates all singletons in dependency order.
- Registers all context subscriptions for automatic disposal.

### `src/config/agentConfig.ts` — `ConfigManager`
- Reads `acp.*` settings from `vscode.workspace.getConfiguration`.
- Merges built-in agent presets with user-defined agents.
- Resolves `${env:VAR_NAME}` placeholders at spawn time (never at storage time).

### `src/acp/acpClient.ts` — `AcpClient`
- Manages **one** agent subprocess.
- Sends JSON-RPC requests and tracks pending Promises by id.
- Parses NDJSON from stdout; dispatches responses/notifications.
- Fires typed VS Code events: `onSessionUpdate`, `onStateChange`, `onExit`.

### `src/acp/agentManager.ts` — `AgentManager`
- Owns a `Map<name, AcpClient>`.
- Coordinates connect/disconnect/restart across multiple agents.
- Routes `session/update` notifications to `SessionManager`.
- Exposes session operations (`newSession`, `sendPrompt`, `cancelTurn`).

### `src/acp/sessionManager.ts` — `SessionManager`
- Maintains in-memory `AgentSession` objects (messages, tool calls, thinking).
- Applies incremental `session/update` events to session state.
- Handles permission requests: auto-approve or show VS Code modal.
- Fires typed events that `ChatWebviewProvider` relays to the webview.

### `src/providers/agentsTreeProvider.ts` — `AgentsTreeProvider`
- Implements `vscode.TreeDataProvider` for the Agents sidebar.
- Renders agent nodes (with connection state icons) and their session children.
- Refreshes on connection state changes and session creation events.

### `src/webview/chatWebviewProvider.ts` — `ChatWebviewProvider`
- Manages a single `vscode.WebviewPanel`.
- Contains the full self-contained HTML/CSS/JS chat UI (no external assets).
- Bridges extension host ↔ webview via `postMessage` / `onDidReceiveMessage`.
- Enforces a strict CSP with a per-render nonce.

### `src/handlers/commands.ts`
- Registers all 11 `acp.*` VS Code commands.
- Thin adapter: reads intent (from args or QuickPick), delegates to managers.

### `src/utils/logger.ts` — `Logger`
- Singleton with two output channels: `ACP Client` and `ACP Traffic`.
- Supports level filtering (`DEBUG/INFO/WARN/ERROR`).
- Traffic logging toggle controlled by `acp.logTraffic` setting.

---

## Security Model

```mermaid
flowchart LR
    ENV["Host Shell Environment\n$IBM_BOB_API_KEY\n$ANTHROPIC_API_KEY\n$GEMINI_API_KEY\n... others"]
    SETTINGS["VS Code Settings\nacp.agents.env:\n  IBM_BOB_API_KEY: ${env:IBM_BOB_API_KEY}\n  ANTHROPIC_API_KEY: ${env:ANTHROPIC_API_KEY}\n  ...\nacp.ibmBobApiKey (secret storage)"]
    RESOLVE["ConfigManager\nresolveEnvPlaceholders\nat spawn time"]
    SPAWN["AcpClient.spawn\nenv passed to child process"]
    AGENT["Agent Process"]

    ENV -->|read only at spawn| RESOLVE
    SETTINGS -->|placeholder strings| RESOLVE
    RESOLVE -->|resolved env map| SPAWN
    SPAWN -->|process.env| AGENT

    style ENV fill:#2d4a2d,color:#fff
    style SETTINGS fill:#2d2d4a,color:#fff
```

**Key guarantees:**
- No secrets stored in VS Code settings — only `${env:VAR_NAME}` placeholder strings.
- IBM Bob API keys additionally supported via VS Code secret storage (`acp.ibmBobApiKey`), which uses the OS keychain — not `settings.json`.
- No secrets logged — `Logger` never writes env values.
- No external network requests from the webview CSP.
- Agent processes are isolated child processes; they cannot access VS Code APIs.

---

## Data Flow: User Sends a Message

```mermaid
flowchart TD
    U[User types in webview] -->|postMessage sendPrompt| WV[ChatWebviewProvider]
    WV -->|appendUserMessage| SM[SessionManager]
    WV -->|sendPrompt| AM[AgentManager]
    AM -->|sendRequest prompt/send| CLIENT[AcpClient]
    CLIENT -->|write frame to stdin| AGENT[Agent Process]
    AGENT -->|session/update text| CLIENT
    CLIENT -->|onSessionUpdate event| AM
    AM -->|relay| SM
    SM -->|onTextAppended event| WV
    WV -->|postMessage appendText| WEBVIEW[Webview HTML]
    WEBVIEW -->|DOM update| U
```
