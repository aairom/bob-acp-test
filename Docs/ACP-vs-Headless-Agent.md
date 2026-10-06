# Bob: ACP vs. Headless Agent

A technical comparison of the Agent Client Protocol (ACP) integration pattern
and the IBM Bob Shell headless mode — architecture, protocol, transport, and use cases.

---

## 1. Overview

Both patterns involve interacting with IBM Bob (or another AI agent) programmatically
and without a traditional graphical interface. However, they differ fundamentally in
**who drives the protocol**, **how the conversation is structured**, and
**what the integration target is**.

> **Key distinction:** ACP is an _open, agent-agnostic protocol_ where your application
> is the client and the agent process is the server. Headless Bob Shell is _IBM Bob
> itself_, run as a one-shot or interactive CLI — no external protocol involved.

---

## 2. Architecture

### ACP Pattern (acp-vscode extension)

```
┌──────────────────────┐       JSON-RPC 2.0        ┌─────────────────────┐       internal       ┌───────────────────┐
│  VS Code Extension   │  ──── stdin/stdout ──────► │  Bob ACP Adapter    │ ───────────────────► │   Bob AI Engine   │
│  (ACP Client)        │  ◄── NDJSON frames ──────  │  (@ibm/bob-acp)     │                      │   (watsonx)       │
│  acp-vscode          │                             │  child process      │                      │                   │
└──────────────────────┘                             └─────────────────────┘                      └───────────────────┘
```

### Headless Bob Shell Pattern

```
┌──────────────────────┐    CLI flags               ┌──────────────────────────────────────────┐      stdout        ┌──────────────┐
│  Bash Script         │  ── -p "prompt" ─────────► │  Bob Shell  (bob CLI)                    │ ── plain text ──►  │  Output /    │
│  or CI Pipeline      │                             │  Non-interactive mode                    │                    │  file edits  │
└──────────────────────┘                             │  AI Engine + CLI + Tools — all-in-one    │                    └──────────────┘
                                                     └──────────────────────────────────────────┘
```

---

## 3. Protocol & Transport

### ACP — JSON-RPC 2.0 over stdin/stdout (NDJSON)

Every interaction is a structured, typed message. Sessions are stateful and multi-turn:

| Step | Method | Description |
|---|---|---|
| 1 | `initialize` | Client advertises protocol version; agent replies with capabilities. |
| 2 | `initialized` | Client acknowledges — handshake complete. |
| 3 | `session/new` | Create a conversation session; agent returns a `sessionId`. |
| 4 | `prompt/send` | Send a user message into a session. |
| 5 | `session/update` | Agent streams back typed events: `text`, `thinking`, `tool_call`, `tool_result`, `turn_end`. |
| 6 | `permission/response` | Client approves or denies privileged tool calls. |
| 7 | `session/cancel` | Interrupt an in-progress turn. |
| 8 | `shutdown` | Graceful process exit. |

**Example wire frames:**

```jsonc
// Client → Agent
{"jsonrpc":"2.0","id":3,"method":"prompt/send","params":{"sessionId":"abc-123","prompt":"Explain this function"}}

// Agent → Client (streaming)
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"abc-123","event":{"type":"text","text":"This function..."}}}

// Agent → Client (turn complete)
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"abc-123","event":{"type":"turn_end","reason":"complete"}}}
```

### Headless Bob Shell — CLI flags

Interaction is one-shot or conversational via terminal. No protocol framing:

```bash
# Non-interactive: one prompt, one run, process exits
bob -p "Fix all TODOs in @app.ts" --yolo

# Interactive session in terminal
bob

# CI/CD usage with API key auth
BOB_API_KEY=xxxx bob -p "Generate release notes for v2.1" > release-notes.md
```

---

## 4. Side-by-Side Comparison

| Dimension | ACP (acp-vscode extension) | Headless Bob Shell |
|---|---|---|
| **Agent target** | Any ACP-compliant agent (IBM Bob, Claude, Gemini, etc.) | IBM Bob only |
| **Protocol** | JSON-RPC 2.0 — open standard | Bob Shell CLI — proprietary flags |
| **Transport** | stdin/stdout with framed NDJSON | stdin/stdout as CLI text I/O |
| **Session model** | Stateful multi-turn sessions with `sessionId` | One-shot (`-p`) or interactive REPL |
| **Streaming** | Native — typed `session/update` events | Not structured; raw stdout text |
| **Tool calls / permissions** | Explicit `permission_request` events with approve/deny callback | `--yolo` flag (auto-allow) or interactive approval |
| **Multi-agent** | Yes — N simultaneous agent connections | No — one Bob process per invocation |
| **Interoperability** | Vendor-neutral; swap agents without changing client code | IBM Bob-specific |
| **Authentication** | `IBM_BOB_API_KEY` env var or VS Code secret storage | `BOB_API_KEY` env var or browser SSO |
| **Requires VS Code** | Yes (runs inside extension host) | No (pure CLI) |
| **Primary use case** | Rich editor UI, streaming chat, multi-agent orchestration | Automation, CI/CD, batch processing, scripting |

---

## 5. When to Use Each

### Use the ACP extension when…

- You need a persistent, interactive chat UI inside VS Code.
- You want streaming partial responses rendered in real-time.
- You want to switch between agents (IBM Bob, Claude Code, Gemini CLI, …).
- You need structured tool call visibility and permission approval in the UI.
- You are building a vendor-neutral integration.
- You manage multiple simultaneous conversations.

### Use Bob Shell (headless) when…

- Automating tasks in bash scripts or CI/CD pipelines.
- Batch-processing files without opening VS Code.
- Simple one-shot prompts (`bob -p "…"`).
- Environments without a desktop / GUI (server, container, CI runner).
- You only need IBM Bob, no other agent.
- Quick scripted workflows with minimal boilerplate.

---

## 6. Can They Coexist?

Yes — they are **complementary layers**, not competing alternatives.
The `@ibm/bob-acp` adapter preset built into this extension is an ACP shim
_on top of_ Bob Shell's AI engine. Bob Shell provides the intelligence; the ACP
adapter wraps it in the JSON-RPC protocol that the extension speaks.

```
Mental model:

  Bob Shell        =  the engine
  ACP adapter      =  the protocol interface  (wraps the engine)
  acp-vscode ext.  =  the client              (drives the adapter from VS Code)
```

The three layers can all be present simultaneously: VS Code uses the extension to send
ACP messages to the adapter, which delegates to Bob Shell under the hood.

---

## Related Documents

- `Docs/Architecture.md` — full technical architecture of the acp-vscode extension
- `Docs/Quickstart.md` — per-agent setup including IBM Bob
- `Docs/CommunityExtensions.md` — community ACP extension landscape
- `README.md` — project overview and IBM Bob setup instructions
