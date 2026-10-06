# Community Extensions Reference — ACP for VSCode

This document surveys the major community ACP VSCode extensions identified during
ecosystem research (October 2026) and explains how this implementation relates to them.

---

## Overview

The Agent Client Protocol (ACP) was created by the Zed Editor team as an open standard
for editor ↔ AI agent communication. Native VSCode support has not yet shipped
(tracked at [microsoft/vscode#265496](https://github.com/microsoft/vscode/issues/265496)),
so the community has built several independent implementations.

---

## Extension Comparison Matrix

| Extension | Publisher | Marketplace ID | Protocol | Built-in agents | Key differentiator |
|---|---|---|---|---|---|
| **ACP Client** | formulahendry | `formulahendry.acp-client` | ACP (JSON-RPC/stdio) | 11 | Reference implementation; most stars |
| **ACP — Agent Client Protocol** | strato-space | `strato-space.acp-plugin` | ACP + Zed `agent_servers` format | 9 | Shared React UI; web UI bridge (`acp-chat`) |
| **ACP UI** | IrishBruse | `IrishBruse.ib-acp-ui` | ACP | — | Dedicated UI panel; session sidebar |
| **VSACP** | foxweimin | `foxweimin.vscode-acp-client` | ACP | 4 | Sub-agent view; model/thought-level switching |
| **VSCode ACP Chat** | pengjiantao | `pengjiantao.vscode-acp-chat` | ACP + MCP passthrough | 14 | MCP server config passthrough; context menus |
| **ACP Pro** | duclvz | `duclvz.acp-pro` | ACP | 9 | Multi-tab sessions; remote sharing; bridge server |

---

## Detailed Notes

### `formulahendry.acp-client` — ACP Client
- **Status:** Actively maintained (last updated May 2026).
- **Architecture:** Modular — `AgentManager`, `ConnectionManager`, `SessionManager`, `AcpClientImpl`, tree provider, webview.
- **Transport:** ACP JSON-RPC 2.0 over stdio.
- **Auth:** Delegates to each agent's own CLI auth; no credentials stored.
- **Compatibility:** VS Code 1.85+, Node.js 18+.
- **Adoption:** Most widely referenced in the VS Code issue thread.
- **Recommendation:** Best baseline reference for protocol conformance.

### `strato-space.acp-plugin` — ACP — Agent Client Protocol
- **Status:** Actively maintained; a fork/extraction of `cosmos-vibe/Nexus-acp`.
- **Architecture:** Monorepo — VS Code extension (`src/`) + shared React UI package (`packages/acp-ui/`) + standalone web server (`acp-chat/`).
- **Unique feature:** Compatible with Zed editor's `agent_servers` config format — teams can share one agent config across Zed and VS Code.
- **Web UI:** `acp-chat` spawns ACP agents over WebSocket for browser access.
- **Recommendation:** Best choice for teams using both Zed and VS Code.

### `IrishBruse.ib-acp-ui` — ACP UI
- **Status:** Early-stage community project.
- **Architecture:** Extension + React/Vite webview. Standalone dev server for UI development without the extension host.
- **Unique feature:** Fixture-based demo mode for UI development and screenshots.

### `foxweimin.vscode-acp-client` — VSACP
- **Status:** Not yet published to VS Code Marketplace (VSIX only).
- **Unique feature:** Sub-agent conversation views; slash command interface (`/model`, `/think`, `/agent`).
- **Note:** 100% of code authored via AI agent programming (OpenCode CLI).

### `pengjiantao.vscode-acp-chat` — VSCode ACP Chat
- **Status:** Active community project; enhanced fork of the reference implementation.
- **Unique feature:** MCP server configuration passthrough — passes `~/.vscode/mcp.json` entries to agents via `newSession`/`loadSession` requests.
- **Auto-detection:** Scans `$PATH` for 15 known agent executables on startup.
- **Session persistence:** Configurable retention (default 30 days, 300 sessions/agent).

### `duclvz.acp-pro` — ACP Pro
- **Status:** Actively developed; freemium model.
- **Unique feature:** Embedded HTTP+WebSocket bridge server for remote session sharing from browser or mobile.
- **Multi-tab:** Up to 8 live sessions simultaneously; session dehydration on idle.
- **Note:** Requires VS Code 1.96+ and Node.js 20+.

---

## How This Implementation Differs

This extension (`acp-vscode`) is purpose-built for:

1. **Production code quality** — strict TypeScript, ESLint, unit tests, inline JSDoc.
2. **Security-first design** — no credentials in settings; CSP-safe webview; explicit env resolution.
3. **Minimal dependency footprint** — zero runtime npm dependencies; Node.js built-ins only.
4. **Governed project conventions** — project structure, scripts, documentation, and naming follow consistent workspace conventions (source under project root, docs in `Docs/`, scripts in `scripts/`, no hardcoded secrets).
5. **Extensible architecture** — the `AcpClient` / `AgentManager` / `SessionManager` separation makes it straightforward to add features (session persistence, MCP passthrough, etc.) without touching the transport layer.

---

## Protocol Reference

The ACP protocol specification is maintained at:
- **Zed ACP docs:** https://zed.dev/acp
- **VS Code issue tracker:** https://github.com/microsoft/vscode/issues/265496

Key protocol facts:
- Transport: **JSON-RPC 2.0 over stdin/stdout** (newline-delimited JSON).
- Initialize handshake: `initialize` request → `initialized` notification.
- Session lifecycle: `session/new` → `prompt/send` → `session/update` notifications → `turn_end`.
- Permission negotiation: `permission_request` event → `permission/response` notification.
- Cancellation: `session/cancel` notification (no response).
