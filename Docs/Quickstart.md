# Quickstart Guide — ACP for VSCode

This guide gets you from zero to a working ACP chat session in under 5 minutes.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| VS Code | ≥ 1.85 | [code.visualstudio.com](https://code.visualstudio.com) |
| Node.js | ≥ 18 | [nodejs.org](https://nodejs.org) |
| npm | ≥ 9 | Bundled with Node.js |

---

## Step 1 — Install the Extension

### Option A — Install from .vsix (local build)

```bash
# From the project root:
./scripts/package.sh
code --install-extension ./acp-vscode-*.vsix
```

### Option B — Development mode (F5)

```bash
npm install
npm run compile
# Then press F5 in VS Code to open the Extension Development Host
```

---

## Step 2 — Choose and Set Up an Agent

The extension ships with 8 pre-configured agents. Pick one and follow its setup:

### IBM Bob (IBM watsonx Code Assistant)

```bash
# Obtain an IBM Cloud API key at https://cloud.ibm.com/iam/apikeys
# Then export it (add to ~/.zshrc or ~/.bashrc):
export IBM_BOB_API_KEY=your-ibm-cloud-api-key-here

# Optionally, set a private watsonx endpoint (leave unset for the public default):
# export IBM_BOB_ENDPOINT=https://your-private.watsonx.ai/v1
```

The built-in **IBM Bob** preset automatically forwards `IBM_BOB_API_KEY` and
`IBM_BOB_ENDPOINT` from your shell environment via `${env:...}` placeholders.
No `settings.json` changes are needed as long as those variables are exported.

> **Alternative — VS Code secret storage:** If you cannot export env vars (e.g. remote
> or containerised environments), open Settings (`Ctrl+,` / `Cmd+,`), search for
> **ACP IBM Bob API Key**, and paste your key there. VS Code stores it in the OS
> keychain (the field is marked `"secret": true`).

> **Note on the package name:** Replace `@ibm/bob-acp@latest` in `acp.agents` with
> the exact IBM Bob ACP adapter package from your IBM entitlement or internal registry.

---

### Claude Code (recommended for first use)

```bash
# Install the ACP adapter
npx @agentclientprotocol/claude-agent-acp@latest --help

# Authenticate once (stores session in ~/.claude/)
npx @anthropic-ai/claude-code@latest auth login
```

No API key required if you use browser-based auth. For CI/non-interactive use:
```bash
# Set in your shell (or .env file — see .env.example)
export ANTHROPIC_API_KEY=sk-ant-...
```

Then in VS Code `settings.json`:
```json
"acp.agents": {
  "Claude Code": {
    "command": "npx",
    "args": ["--yes", "@agentclientprotocol/claude-agent-acp@latest"],
    "env": {
      "ANTHROPIC_API_KEY": "${env:ANTHROPIC_API_KEY}"
    }
  }
}
```

---

### GitHub Copilot

```bash
# Authenticate via browser (one-time)
npx @github/copilot-language-server@latest login
```

No additional settings.json changes required — the built-in preset works out of the box.

---

### Gemini CLI

```bash
# Authenticate via browser (one-time)
npx @google/gemini-cli@latest auth
```

For API key use:
```bash
export GEMINI_API_KEY=AIza...
```

```json
"acp.agents": {
  "Gemini CLI": {
    "command": "npx",
    "args": ["--yes", "@google/gemini-cli@latest", "--experimental-acp"],
    "env": { "GEMINI_API_KEY": "${env:GEMINI_API_KEY}" }
  }
}
```

---

### Codex CLI

```bash
# Install and configure
npm install -g @zed-industries/codex-acp
export OPENAI_API_KEY=sk-...
```

```json
"acp.agents": {
  "Codex CLI": {
    "command": "npx",
    "args": ["--yes", "@zed-industries/codex-acp@latest"],
    "env": { "OPENAI_API_KEY": "${env:OPENAI_API_KEY}" }
  }
}
```

---

### OpenCode

```bash
npm install -g opencode-ai
# Follow opencode's own auth setup
```

No extra settings.json changes needed for the built-in preset.

---

### Adding a Custom Agent

Open **Settings → Extensions → ACP for VSCode → Edit in settings.json** and add:

```json
"acp.agents": {
  "My Agent": {
    "command": "my-agent-cli",
    "args": ["--acp"],
    "env": {
      "MY_KEY": "${env:MY_KEY}"
    }
  }
}
```

Or use the command: `Ctrl+Shift+P` → **ACP: Add Agent Configuration**.

---

## Step 3 — Start Chatting

1. Click the **ACP icon** in the VS Code Activity Bar (left sidebar).
2. Find your agent in the Agents panel. If it shows *Disconnected*, click the plug icon or select **ACP: Connect to Agent**.
3. Once connected (green dot), click **＋ New** in the Chat panel header — or right-click the agent and choose **ACP: New Conversation**.
4. Type your message and press **Enter**.

---

## Step 4 — Configure Credentials Securely

Copy `.env.example` to `.env` and fill in your API keys:

```bash
cp .env.example .env
# Edit .env with your editor — this file is gitignored
```

Then in your shell profile (`~/.zshrc`, `~/.bashrc`):
```bash
export ANTHROPIC_API_KEY="$(cat ~/.credentials/anthropic_key)"
# — or —
source /path/to/project/.env
```

VS Code will inherit these env vars when launched from the same shell session.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+Shift+A` / `Ctrl+Shift+A` | Open Chat Panel |
| `Escape` (during agent turn) | Cancel Current Turn |

---

## All Commands (Command Palette)

| Command | Description |
|---|---|
| `ACP: Connect to Agent` | Start the agent process + handshake |
| `ACP: Disconnect Agent` | Gracefully stop the agent process |
| `ACP: Restart Agent` | Disconnect then reconnect |
| `ACP: New Conversation` | Create a new session |
| `ACP: Open Chat Panel` | Focus the chat webview |
| `ACP: Cancel Current Turn` | Interrupt the agent mid-response |
| `ACP: Add Agent Configuration` | Guided wizard to add a custom agent |
| `ACP: Remove Agent` | Remove an agent from settings |
| `ACP: Show Log` | Open the ACP Client output channel |
| `ACP: Show Protocol Traffic` | Open the raw JSON-RPC traffic log |
| `ACP: Refresh Sessions` | Re-fetch session list from agent |

---

## Troubleshooting

### Agent fails to start

1. Open **Output → ACP Client** for error details.
2. Verify the agent command runs in your terminal:
   ```bash
   npx @agentclientprotocol/claude-agent-acp@latest --help
   ```
3. Ensure Node.js 18+ is on your `PATH` when VS Code was launched.
4. On macOS: launch VS Code from your terminal (`code .`) so it inherits your shell env.

### "Agent did not respond to initialize" timeout

- Increase `acp.connectTimeoutMs` to `60000` (60 s) in settings.
- Some agents need network access on first run to download packages via `npx`.

### Permission requests keep appearing

- Set `acp.autoApprovePermissions` to `"allowAll"` to auto-approve all tool calls.
- Or approve per-request in the chat panel inline dialog.

### API key not being picked up

- Confirm the env var is exported in your shell: `echo $ANTHROPIC_API_KEY`
- Restart VS Code from the same shell session.
- Check the `${env:VAR_NAME}` placeholder in your `settings.json` matches the env var name exactly.

### Protocol traffic debugging

Enable `acp.logTraffic: true` (default) and open:
**View → Output → ACP Traffic** to see all raw JSON-RPC frames.
