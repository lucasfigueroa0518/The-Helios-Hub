> ## Documentation Index
> Fetch the complete documentation index at: https://code.claude.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Claude Code changelog

> Release notes for Claude Code, including new features, improvements, and bug fixes by version.

This page is generated from the [CHANGELOG.md on GitHub](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md). Longer releases are grouped by type of change, with long lists of improvements and bug fixes collapsed.

Run `claude --version` to check your installed version.

**2.1.319**

November 6, 2026

**Added**

* Added support for MCP tasks in the terminal: when an MCP server runs a tool call as a task, Claude Code moves it to the background right away and tells Claude the result when it finishes
* Added the `CLAUDE_CODE_DISABLE_MCP_TASK_BACKGROUND` environment variable to make Claude Code wait for an MCP task inside its tool call instead of moving it to the background right away
* Added `permissions.denyInsteadOfPrompting` setting: a tool call that would wait on a permission prompt is denied and the turn continues, in terminal sessions, subagents and teammates
* Added `/claude-api latency-optimize` to find where your Claude API code makes people wait and try faster settings against your eval
* Gateway: Added startup warnings for upstreams that mix AWS GovCloud with other upstreams, and for base URL variables in the gateway's environment
* \[Claude Tag] Added a Claude Tag row to the Models admin page for Enterprise orgs with Claude Tag connected, linking to where its model defaults are managed

**Changed**

* Changed auto mode with telemetry or feature flags off, including behind LLM gateways: calls the server can't check are asked about or denied, with no fallback to the built-in classifier; set `CLAUDE_CODE_AUTO_MODE_SERVER=0` to keep using it (Bedrock, Vertex and Foundry are unchanged)
* Changed auto mode behind an LLM gateway: `CLAUDE_CODE_AUTO_MODE_SERVER=1` turns on the server-side check even with `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` set; if managed settings set the latter, they must set the `1` too
* Changed MCP tasks to work in the terminal without feature-flag fetching (Bedrock, Vertex, Foundry, LLM gateways, `DISABLE_TELEMETRY`); set `CLAUDE_CODE_DISABLE_MCP_TASKS=1` to turn them off

**16 improvements**

* Improved config saves on Windows: Claude Code waits longer for a file another program has open, so a kill during a save is less likely to leave `~/.claude.json` empty
* Improved Claude in Chrome after a brief disconnect: it waits up to 6 seconds for the session's own browser to return before picking another

**90 bug fixes**

* Fixed MCP servers on the older handshake failing to connect, or returning empty results, because Claude Code declared an extension that it only uses with newer servers
* Fixed a long-running MCP tool call on a claude.ai connector sometimes never reporting its result after `--resume`
* Fixed a session's diff failing to load on claude.ai and the mobile apps when the folder Claude Code runs in has a file or folder named `HEAD`
* Fixed `/diff` showing "Diff unavailable" when a git repository has a file or folder named `HEAD` at its top level

**2.1.318**

November 4, 2026

**Added**

* Added a record of your answer when Claude Code asks to turn on the mods it writes in a session
* Added `assume_role` on `mantle` upstreams of the Claude apps gateway, for a role in another AWS account and for per-developer AWS cost attribution
