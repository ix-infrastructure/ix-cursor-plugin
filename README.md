# ix-memory for Cursor

`ix-memory` is a local Cursor plugin that brings Ix graph tools, skills, rules, and hooks into Cursor.

It is intended for graph-first code understanding and safer repository workflows:

- Skills such as `/ix-understand`, `/ix-investigate`, and `/ix-impact`
- MCP tools such as `ix_locate`, `ix_explain`, `ix_callers`, and `ix_briefing`
- Hooks for prompt briefing, pre-edit warnings, search guidance, and post-edit ingest

## Repository Layout

- `.cursor-plugin/plugin.json`: Cursor plugin manifest
- `mcp.json`: MCP server wiring for Cursor
- `hooks/hooks.json`: Cursor hook wiring
- `install-local.sh`: local install helper

## Prerequisites

- Cursor desktop installed
- Node.js 18 or newer
- `ix` available on your `PATH`
- Built hook artifacts present under `mcp/dist/hooks/`

If `mcp/dist/hooks/` is missing, build it first:

```bash
cd ix-cursor-plugin/mcp
npm install
npm run build
```

## One-Command Install

Assuming the standalone repository is published at `ix-infrastructure/ix-cursor-plugin`, users can install with:

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/ix-infrastructure/ix-cursor-plugin/main/install.sh | bash
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -NoProfile -Command "iwr https://raw.githubusercontent.com/ix-infrastructure/ix-cursor-plugin/main/install.ps1 -UseBasicParsing | iex"
```

This downloads the repo archive, installs the plugin into `~/.cursor/plugins/local/ix-memory`, and installs/builds MCP dependencies if needed.

To uninstall:

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/ix-infrastructure/ix-cursor-plugin/main/uninstall.sh | bash
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -NoProfile -Command "iwr https://raw.githubusercontent.com/ix-infrastructure/ix-cursor-plugin/main/uninstall.ps1 -UseBasicParsing | iex"
```

## Local Install

Cursor local plugins are loaded from `~/.cursor/plugins/local/<plugin-name>/`.

This repo includes a helper script that registers the plugin by creating:

```text
~/.cursor/plugins/local/ix-memory -> /path/to/ix-cursor-plugin
```

From the repo root:

```bash
bash ix-cursor-plugin/install-local.sh
```

Or from inside the plugin directory:

```bash
bash install-local.sh
```

Then restart Cursor, or reload plugins, so Cursor picks up the local checkout.

## Manual Install

If you do not want to use the script, the manual process is just:

```bash
mkdir -p ~/.cursor/plugins/local
ln -s /absolute/path/to/ix-cursor-plugin ~/.cursor/plugins/local/ix-memory
```

The plugin root must contain `.cursor-plugin/plugin.json`.

## Verify It Works

1. Open a repository in Cursor.
2. Open agent chat.
3. Run a plugin skill such as:

```text
/ix-help how does ContextService work?
```

Or:

```text
/ix-investigate ContextService
```

If the plugin is loaded correctly, Cursor should use `ix_*` tools instead of replying with a generic answer.

## Troubleshooting

- If Cursor does not see the plugin, confirm `~/.cursor/plugins/local/ix-memory` exists and points to this directory.
- If skills are unknown, restart Cursor after installing the plugin.
- If tool calls fail, confirm `ix` is installed and available on your shell `PATH`.
- If hooks fail with missing files, rebuild `mcp/dist/`.
- MCP tools are served by the Ix CLI (`ix mcp`); check them with `ix mcp doctor`.
- If the target install path already exists as a real directory, move or remove it before re-running `install-local.sh`.

## Data Handling

This plugin runs locally inside Cursor and shells out to the local `ix` binary through the bundled MCP server and hooks.

- No hidden telemetry is added by this plugin itself.
- Data access is limited to what Cursor, the local plugin files, and the local `ix` installation can access.
- Network behavior depends on your local `ix` configuration and any backend it is configured to talk to.
- Review the plugin source, hook definitions, and MCP server code before installing in sensitive environments.

## Publishing Notes

For a standalone repository, this `README.md` plus `install-local.sh` is the simplest install story for local development:

1. Clone the repo.
2. Build `mcp/` if needed.
3. Run `bash install-local.sh`.
4. Restart Cursor.

Published plugins for end users are a different flow: those are installed through the Cursor Marketplace when packaged and published there.

For self-hosted installs outside the Marketplace, `install.sh` is the intended entrypoint.

## References

- [SPEC.md](./SPEC.md)
- [plugin/README.md](./plugin/README.md)
- [install.sh](./install.sh)
- [install.ps1](./install.ps1)
- [uninstall.sh](./uninstall.sh)
- [uninstall.ps1](./uninstall.ps1)
- [install-local.sh](./install-local.sh)
