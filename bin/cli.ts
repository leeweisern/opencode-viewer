#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    port: { type: "string", short: "p", default: "3456" },
    "no-open": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
    db: { type: "string" },
  },
  strict: false,
});

if (values.help) {
  console.log(`
  opencode-viewer — Browse your OpenCode sessions locally

  Usage:
    bunx opencode-viewer [options]

  Options:
    -p, --port <port>   Port to listen on (default: 3456)
    --db <path>         Custom path to opencode.db
    --no-open           Don't auto-open browser
    -h, --help          Show this help

  Requires Bun runtime (uses bun:sqlite).
`);
  process.exit(0);
}

const port = Number(values.port) || 3456;
const dbPath =
  (values.db as string) ||
  join(homedir(), ".local", "share", "opencode", "opencode.db");

if (!existsSync(dbPath)) {
  console.error(`\n  ✗ OpenCode database not found at: ${dbPath}\n`);
  console.error(
    "  Make sure OpenCode is installed and has been run at least once.",
  );
  console.error("  Or specify a custom path: bunx opencode-viewer --db /path/to/opencode.db\n");
  process.exit(1);
}

// Set env vars for the server to pick up
process.env.OCV_PORT = String(port);
process.env.OCV_DB_PATH = dbPath;

// Import and start server
const serverPath = join(import.meta.dir, "..", "server.ts");
await import(serverPath);

// Auto-open browser
if (!values["no-open"]) {
  const url = `http://localhost:${port}`;
  const { platform } = process;
  const cmd =
    platform === "darwin"
      ? ["open", url]
      : platform === "win32"
        ? ["cmd", "/c", "start", url]
        : ["xdg-open", url];

  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
}
