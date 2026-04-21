# opencode-viewer

Local GUI to browse your [OpenCode](https://opencode.ai) sessions, messages, and tool calls from the SQLite database.

One command. No setup. Just run it.

```bash
bunx @virmont/opencode-viewer
```

## What it does

Opens a local web UI to explore your OpenCode history stored in `~/.local/share/opencode/opencode.db`:

- **Projects** — all your git repos tracked by OpenCode
- **Sessions** — conversation history per project, newest first
- **Messages** — full thread with user/assistant messages
- **Tool calls** — see every `edit`, `read`, `bash`, `glob` call with inputs/outputs
- **Subagents** — interleaved in the timeline, click to drill in, back to return
- **Images** — screenshots and attachments rendered inline with click-to-expand lightbox
- **Reasoning** — model thinking in collapsible blocks
- **Patches**, **file attachments**, **compaction markers** — all rendered

## Requirements

- [Bun](https://bun.sh) runtime (`curl -fsSL https://bun.sh/install | bash`)
- [OpenCode](https://opencode.ai) installed and used at least once

## Usage

```bash
# Just run it — auto-opens browser
bunx @virmont/opencode-viewer

# Custom port
bunx @virmont/opencode-viewer -p 8080

# Custom database path
bunx @virmont/opencode-viewer --db /path/to/opencode.db

# Don't auto-open browser
bunx @virmont/opencode-viewer --no-open

# Show help
bunx @virmont/opencode-viewer --help
```

## How it works

1. Reads your local `opencode.db` SQLite database (read-only, never writes)
2. Starts a lightweight Bun server on `localhost:3456`
3. Serves a single-page HTML app — no build step, no dependencies
4. All data stays local. Nothing leaves your machine.

## Features

### Three-panel layout
- **Left** — Project list with colored indicators
- **Middle** — Sessions for selected project, paginated
- **Right** — Full message thread with all parts

### Message parts rendered
| Part type | Rendering |
|-----------|-----------|
| `text` | Markdown-lite with code blocks |
| `reasoning` | Collapsible thinking block |
| `tool` | Tool name + status badge + input/output + execution time |
| `patch` | Compact card with commit hash + changed files |
| `file` | Attachment card, images rendered inline |
| `agent` | Subagent pill badge |
| `step-finish` | Muted cost/token summary line |
| `compaction` | Context compacted separator |

### Navigation
- Click a subagent card to drill into its messages
- **Back button** or **Escape** to return to parent session
- **Escape** also deselects session/project
- Click images for full-size lightbox

## Stack

- **Runtime**: [Bun](https://bun.sh) (for `bun:sqlite` and `Bun.serve()`)
- **Frontend**: Vanilla HTML/CSS/JS — zero dependencies, single file
- **Database**: SQLite read-only via `bun:sqlite`
- **Total size**: ~16KB packed

## License

MIT
