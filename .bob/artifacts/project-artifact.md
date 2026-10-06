# ACP for VSCode — Project Artifact

Generated: 2026-10-06

## Summary

Production-ready VS Code extension implementing the Agent Client Protocol (ACP)
over JSON-RPC 2.0/stdio. Connects VS Code to any ACP-compatible AI coding agent.

## File Inventory

### Source Code

| File | Purpose |
|---|---|
| `src/extension.ts` | Extension entry point; wires all singletons |
| `src/types.ts` | All TypeScript interfaces and enumerations |
| `src/acp/acpClient.ts` | One-agent JSON-RPC subprocess manager |
| `src/acp/agentManager.ts` | Multi-agent orchestrator |
| `src/acp/sessionManager.ts` | Session state + streaming event handler |
| `src/acp/uuid.ts` | Zero-dependency UUID v4 generator |
| `src/config/agentConfig.ts` | ConfigManager + env placeholder resolution |
| `src/providers/agentsTreeProvider.ts` | VS Code TreeDataProvider for sidebar |
| `src/webview/chatWebviewProvider.ts` | WebviewPanel with inline chat UI |
| `src/handlers/commands.ts` | All 11 `acp.*` VS Code command registrations |
| `src/utils/logger.ts` | Dual-channel Logger singleton |

### Tests

| File | Coverage |
|---|---|
| `src/test/suite/logger.test.ts` | Logger level filtering, traffic toggle, error metadata |
| `src/test/suite/agentConfig.test.ts` | env placeholder resolution, agent parsing, validation |
| `src/test/suite/uuid.test.ts` | UUID v4 format, uniqueness, version/variant nibbles |
| `src/test/suite/extension.test.ts` | Extension activation, command registration, config defaults |

### Documentation

| File | Content |
|---|---|
| `README.md` | Architecture diagram, workflow, features, quick start |
| `Docs/Quickstart.md` | Step-by-step agent setup for Claude, Copilot, Gemini, Codex |
| `Docs/Architecture.md` | Mermaid diagrams: component map, transport layer, data flow |
| `Docs/CommunityExtensions.md` | Comparison matrix of 6 community ACP extensions |

### Scripts

| Script | Purpose |
|---|---|
| `scripts/build.sh` | Install + compile |
| `scripts/dev.sh` | Watch mode for development |
| `scripts/test.sh` | Full test suite |
| `scripts/package.sh` | Build + create .vsix |
| `scripts/cleanup.sh` | Remove node_modules, out/, .venv, __pycache__ |
| `scripts/chmod-scripts.js` | Make bash scripts executable (run via npm postinstall) |

### Configuration

| File | Purpose |
|---|---|
| `package.json` | Extension manifest + npm scripts |
| `tsconfig.json` | TypeScript compiler config |
| `.eslintrc.json` | ESLint rules |
| `.env.example` | Template for API key env vars |
| `.gitignore` | Excludes .env, node_modules, AGENTS.md, .bob/mcp.json, output/*, etc. |
| `LICENSE` | MIT |
| `media/acp-icon.svg` | Activity bar icon |

## Built-in Agent Presets

Claude Code, GitHub Copilot, Gemini CLI, Codex CLI, OpenCode, Qwen Code, Auggie CLI

## Security Properties

- Zero hardcoded credentials
- ${env:VAR_NAME} placeholder resolution at spawn time only
- CSP-safe webview (nonce-based, no external network calls)
- Minimal child process env (host env + explicit overrides only)
- No secrets in VS Code settings storage

## License: MIT
