# TokenPilot Claude Code Adapter

This adapter is the gateway-first TokenPilot integration for Claude Code.

Current scope:

- install Claude Code routing through a local Anthropic-compatible gateway
- install lightweight Claude Code hooks for session and tool observability
- inspect local install state with doctor
- register a real MCP-backed `memory_fault_recover` tool
- decode and forward Anthropic Messages requests through shared gateway helpers
- expose `lightmem2 claude-code ...` through the shared CLI surface

Not implemented in this first scaffold:

- lifecycle eviction
- aggressive mode parity with OpenClaw
- in-host slash commands

Install now writes three things:

- `~/.claude/settings.json` for gateway routing, tool-search env, and TokenPilot hook entries
- `~/.claude/.claude.json` for the `tokenpilot_memory_fault_recover` MCP server
- `~/.claude/tokenpilot.json` for TokenPilot runtime config

The installer also preserves existing files as:

- `settings.json.tokenpilot.bak`
- `.claude.json.tokenpilot.bak`

That MCP server backs the same recovery hints injected into trimmed payloads, so
Claude Code can call the real `memory_fault_recover` tool instead of only
seeing protocol text.

Current doctor checks report whether:

- Claude settings are installed
- observability hooks are installed
- observability hooks are complete or only partially installed
- observability hooks still point to the expected current handler command
- gateway routing is active
- tool search is enabled
- recovery MCP is installed
- MCP `TOKENPILOT_STATE_DIR` matches the TokenPilot config state dir
- MCP command / args still match the current TokenPilot install
- proxy health is reachable
- session-state / ux-effects data already exist
