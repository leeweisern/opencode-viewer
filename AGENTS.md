# AGENTS.md

## Project

OpenCode Session Viewer — a local read-only web GUI for browsing OpenCode AI coding sessions. Reads from the OpenCode SQLite database (`~/.local/share/opencode/opencode.db`) and renders a three-panel interface: projects, sessions, and messages with tool calls.

## Stack

- **Runtime**: Bun (required — uses `bun:sqlite`)
- **Server**: `server.ts` — single-file HTTP server, serves API + static files
- **Frontend**: `public/index.html` — single-file vanilla HTML/CSS/JS, no build step
- **CLI**: `bin/cli.ts` — entry point for `bunx opencode-viewer`

## Architecture

```
bin/cli.ts          → CLI args, env setup, auto-open browser
server.ts           → Bun.serve HTTP server, SQLite queries, REST API
public/index.html   → Single-page app (vanilla JS, no framework)
```

The server opens the database **read-only** and exposes:
- `GET /api/projects` — list all projects
- `GET /api/projects/:id/sessions?page=&limit=` — paginated sessions
- `GET /api/sessions/:id` — session detail with messages + parts
- `GET /api/parts/:id/image` — base64 image extraction from part data

The frontend is entirely self-contained in one HTML file — all styles and JS inline. It fetches from the API and renders three panels with client-side state management.

## Design System

Uses the Koomi KB Redesign design language:
- **Font**: Geist + Geist Mono (Google Fonts)
- **Palette**: Warm cream (`#fbfaf7` bg, `#f5f4f0` surfaces, `#e8e6df` borders)
- **Accent**: Teal via `oklch(0.62 0.11 185)`
- **CSS variables**: `--bg`, `--surface`, `--ink`, `--hair`, `--accent`, `--font-sans`, `--font-mono`

## Running

```bash
bun run dev          # dev mode with watch
bun run start        # production
bunx opencode-viewer # via CLI
```

Default port `3456`. Set `OCV_PORT` or `OCV_DB_PATH` env vars to override.

## Conventions

- No dependencies beyond Bun built-ins
- Keep everything in minimal files — avoid splitting unless necessary
- Frontend stays as a single HTML file (no bundler, no framework)
- Server is read-only — never write to the database
- All SQL queries use prepared statements
