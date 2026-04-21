import { Database } from "bun:sqlite";
import { Buffer } from "node:buffer";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.OCV_PORT) || 3456;
const DB_PATH =
  process.env.OCV_DB_PATH ||
  join(homedir(), ".local", "share", "opencode", "opencode.db");
const PUBLIC_DIR = join(import.meta.dir, "public");

if (!existsSync(DB_PATH)) {
  console.error(`OpenCode database not found at: ${DB_PATH}`);
  process.exit(1);
}

let db: Database;

try {
  db = new Database(DB_PATH, { readonly: true });
} catch (error) {
  console.error("Failed to open OpenCode database in read-only mode:", error);
  process.exit(1);
}

type JsonObject = Record<string, unknown>;

type ProjectRow = {
  id: string;
  worktree: string | null;
  name: string | null;
  icon_color: string | null;
  time_created: number | string | null;
  time_updated: number | string | null;
};

type SessionRow = {
  id: string;
  title: string | null;
  summary: string | null;
  directory: string | null;
  time_created: number | string | null;
  time_updated: number | string | null;
};

type SessionDetailRow = {
  id: string;
  project_id: string | null;
  parent_id: string | null;
  title: string | null;
  summary: string | null;
  directory: string | null;
  time_created: number | string | null;
  time_updated: number | string | null;
};

type MessagePartJoinRow = {
  id: string;
  time_created: number | string | null;
  time_updated: number | string | null;
  message_data: string | null;
  part_id: string | null;
  part_data: string | null;
  part_time: number | string | null;
};

const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const allowedPartTypes = new Set([
  "text",
  "reasoning",
  "tool",
  "patch",
  "file",
  "agent",
  "step-finish",
  "step-start",
  "snapshot",
  "compaction",
  "retry",
]);

const projectStmt = db.query<ProjectRow>(
  "SELECT id, worktree, name, icon_color, time_created, time_updated FROM project ORDER BY time_updated DESC",
);

const sessionsCountStmt = db.query<{ total: number }>(
  "SELECT COUNT(*) as total FROM session WHERE project_id = ? AND parent_id IS NULL",
);

const projectSessionsStmt = db.query<SessionRow>(
  `SELECT id, title, NULL as summary, directory, time_created, time_updated
   FROM session
   WHERE project_id = ? AND parent_id IS NULL
   ORDER BY time_updated DESC
   LIMIT ? OFFSET ?`,
);

const sessionStmt = db.query<SessionDetailRow>(
  "SELECT id, project_id, parent_id, title, NULL as summary, directory, time_created, time_updated FROM session WHERE id = ?",
);

const sessionMessagesStmt = db.query<MessagePartJoinRow>(
  `SELECT m.id, m.time_created, m.time_updated, m.data as message_data,
          p.id as part_id, p.data as part_data, p.time_created as part_time
   FROM message m
   LEFT JOIN part p ON p.message_id = m.id
   WHERE m.session_id = ?
   ORDER BY m.time_created ASC, p.time_created ASC`,
);

const subagentsStmt = db.query<SessionRow>(
  `SELECT id, title, NULL as summary, NULL as directory, time_created, time_updated
   FROM session
   WHERE parent_id = ?
   ORDER BY time_created ASC`,
);

const partImageStmt = db.query<{ data: string }>("SELECT data FROM part WHERE id = ?");

function parseJSON(value: string | null): JsonObject | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object") return parsed as JsonObject;
    return null;
  } catch {
    return null;
  }
}

function getString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isBase64ImageData(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("data:image");
}

function sanitizePartData(partData: JsonObject, partType: string): JsonObject {
  const sanitizedPartData: JsonObject = { ...partData };

  if (partType === "file") {
    const fileUrl = getString(sanitizedPartData.url);
    if (fileUrl && fileUrl.startsWith("data:image")) {
      sanitizedPartData.url = "[base64-image]";
      sanitizedPartData.hasImage = true;
    }
  }

  if (partType === "tool") {
    const state = sanitizedPartData.state;
    if (state && typeof state === "object" && !Array.isArray(state)) {
      const stateObject = state as JsonObject;
      const attachments = stateObject.attachments;

      if (Array.isArray(attachments)) {
        const hasBase64ImageAttachment = attachments.some((attachment) => {
          if (isBase64ImageData(attachment)) {
            return true;
          }

          if (attachment && typeof attachment === "object") {
            const attachmentObject = attachment as JsonObject;
            return (
              isBase64ImageData(attachmentObject.url) ||
              isBase64ImageData(attachmentObject.data) ||
              isBase64ImageData(attachmentObject.content)
            );
          }

          return false;
        });

        if (hasBase64ImageAttachment) {
          sanitizedPartData.state = {
            ...stateObject,
            attachments: [],
          };
          sanitizedPartData.hasAttachments = true;
        }
      }
    }
  }

  return sanitizedPartData;
}

function extractPartImageDataUri(partData: JsonObject): string | null {
  const url = partData.url;
  if (typeof url === "string" && url.startsWith("data:image")) {
    return url;
  }

  const state = partData.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return null;
  }

  const attachments = (state as JsonObject).attachments;
  if (!Array.isArray(attachments)) {
    return null;
  }

  for (const attachment of attachments) {
    if (typeof attachment === "string" && attachment.startsWith("data:image")) {
      return attachment;
    }

    if (attachment && typeof attachment === "object" && !Array.isArray(attachment)) {
      const attachmentUrl = (attachment as JsonObject).url;
      if (typeof attachmentUrl === "string" && attachmentUrl.startsWith("data:image")) {
        return attachmentUrl;
      }
    }
  }

  return null;
}

function getPagination(url: URL): { page: number; limit: number; offset: number } {
  const pageParam = Number(url.searchParams.get("page") ?? "1");
  const limitParam = Number(url.searchParams.get("limit") ?? "50");

  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 200) : 50;

  return { page, limit, offset: (page - 1) * limit };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function notFound(message = "Not found"): Response {
  return json({ error: message }, 404);
}

function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

async function serveStatic(pathname: string): Promise<Response> {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const safePath = normalize(relativePath).replace(/^\.{2}(\/|\\|$)/, "");
  const filePath = join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return notFound();
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return notFound();
  }

  const file = Bun.file(filePath);

  if (extname(filePath) === ".html") {
    return withCors(
      new Response(file, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      }),
    );
  }

  return withCors(new Response(file));
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    try {
      const partImageMatch = pathname.match(/^\/api\/parts\/([^/]+)\/image$/);
      if (partImageMatch) {
        const partId = decodeURIComponent(partImageMatch[1]);
        const row = partImageStmt.get(partId) as { data: string } | null;

        if (!row?.data) {
          return notFound("Part not found");
        }

        const partData = parseJSON(row.data);
        if (!partData) {
          return notFound("Invalid part data");
        }

        const dataUri = extractPartImageDataUri(partData);
        if (!dataUri) {
          return notFound("No image in part");
        }

        const match = dataUri.match(/^data:(image\/[^;]+);base64,([\s\S]+)$/);
        if (!match) {
          return notFound("Invalid image data");
        }

        const mime = match[1];
        const base64Payload = match[2].replace(/\s+/g, "");
        const buffer = Buffer.from(base64Payload, "base64");

        if (!buffer.length) {
          return notFound("Invalid image data");
        }

        return new Response(buffer, {
          headers: {
            ...corsHeaders,
            "Content-Type": mime,
            "Cache-Control": "public, max-age=86400",
          },
        });
      }

      if (pathname === "/api/projects") {
        const projects = projectStmt.all();
        return json({ projects });
      }

      const projectSessionsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/sessions$/);
      if (projectSessionsMatch) {
        const projectId = decodeURIComponent(projectSessionsMatch[1]);
        const { page, limit, offset } = getPagination(url);

        const totalRow = sessionsCountStmt.get(projectId) as { total: number } | null;
        const sessions = projectSessionsStmt.all(projectId, limit, offset);

        return json({
          projectId,
          page,
          limit,
          total: totalRow?.total ?? 0,
          sessions,
        });
      }

      const sessionDetailMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionDetailMatch) {
        const sessionId = decodeURIComponent(sessionDetailMatch[1]);
        const session = sessionStmt.get(sessionId) as SessionDetailRow | null;

        if (!session) {
          return notFound("Session not found");
        }

        const rows = sessionMessagesStmt.all(sessionId);
        const subagentRows = subagentsStmt.all(sessionId);

        const messageMap = new Map<
          string,
          {
            id: string;
            _type?: "subagent";
            time_created: number | string | null;
            time_updated: number | string | null;
            title?: string | null;
            summary?: string | null;
            role: string | null;
            modelID: string | null;
            providerID: string | null;
            agent: string | null;
            cost: number | null;
            tokens: unknown;
            parts: Array<
              {
                id: string;
                time_created: number | string | null;
              } & JsonObject
            >;
          }
        >();

        for (const row of rows) {
          if (!messageMap.has(row.id)) {
            const messageData = parseJSON(row.message_data);
            const costValue = messageData?.cost;

            messageMap.set(row.id, {
              id: row.id,
              time_created: row.time_created,
              time_updated: row.time_updated,
              role: getString(messageData?.role),
              modelID: getString(messageData?.modelID),
              providerID: getString(messageData?.providerID),
              agent: getString(messageData?.agent),
              cost: typeof costValue === "number" ? costValue : null,
              tokens: messageData?.tokens ?? null,
              parts: [],
            });
          }

          if (!row.part_id || !row.part_data) {
            continue;
          }

          const partData = parseJSON(row.part_data);
          const partType = getString(partData?.type);

          if (!partData || !partType || !allowedPartTypes.has(partType)) {
            continue;
          }

          const message = messageMap.get(row.id);
          if (!message) continue;

          const sanitizedPartData = sanitizePartData(partData, partType);

          message.parts.push({
            id: row.part_id,
            time_created: row.part_time,
            ...sanitizedPartData,
          });
        }

        const messages = Array.from(messageMap.values());

        for (const sub of subagentRows) {
          messages.push({
            id: sub.id,
            _type: "subagent",
            time_created: sub.time_created,
            time_updated: sub.time_updated,
            title: sub.title,
            summary: sub.summary,
            role: null,
            modelID: null,
            providerID: null,
            agent: null,
            cost: null,
            tokens: null,
            parts: [],
          });
        }

        messages.sort((a, b) => {
          const taValue = Number(a.time_created);
          const tbValue = Number(b.time_created);
          const ta = Number.isFinite(taValue) ? taValue : 0;
          const tb = Number.isFinite(tbValue) ? tbValue : 0;
          return ta - tb;
        });

        return json({
          session,
          messages,
        });
      }

      const subagentsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/subagents$/);
      if (subagentsMatch) {
        const sessionId = decodeURIComponent(subagentsMatch[1]);
        const subagents = subagentsStmt.all(sessionId);
        return json({ sessionId, subagents });
      }

      return await serveStatic(pathname);
    } catch (error) {
      console.error("Request error:", error);
      return json({ error: "Internal server error" }, 500);
    }
  },
});

console.log(`OpenCode Viewer running at http://localhost:${server.port}`);
