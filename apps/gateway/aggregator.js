import { db } from "./db.js";
import { listUpstreamTools, callUpstreamTool } from "./upstream.js";

// slug -> { state, tools, error, checkedAt }
export const status = new Map();
const TTL_MS = 10000;

export const enabledServers = () =>
  db.prepare("SELECT * FROM servers WHERE enabled = 1 ORDER BY id").all();

export async function refreshServer(s) {
  try {
    const tools = await listUpstreamTools(s);
    status.set(s.slug, { state: "connected", tools, error: null, checkedAt: Date.now() });
  } catch (e) {
    status.set(s.slug, { state: "unreachable", tools: [], error: e.message, checkedAt: Date.now() });
  }
}

// Every server is refreshed in parallel; one failure never affects the others.
export async function listAllTools() {
  const servers = enabledServers();
  await Promise.allSettled(
    servers
      .filter((s) => !status.get(s.slug) || Date.now() - status.get(s.slug).checkedAt > TTL_MS)
      .map(refreshServer)
  );
  const out = [];
  for (const s of servers) {
    const st = status.get(s.slug);
    if (!st || st.state !== "connected") continue;
    for (const t of st.tools) {
      out.push({
        name: `${s.slug}__${t.name}`,
        description: `[${s.name}] ${t.description || ""}`,
        inputSchema: t.inputSchema,
      });
    }
  }
  return out;
}

function audit(user, source, slug, tool, ms, outcome, error) {
  db.prepare(
    `INSERT INTO audit_log (user_id, user_email, source, server_slug, tool, duration_ms, outcome, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(user.id, user.email, source, slug, tool, ms, outcome, error || null);
}

const errResult = (msg) => ({ isError: true, content: [{ type: "text", text: msg }] });

// prefixed = "woo__list_orders"  ->  server "woo", tool "list_orders"
export async function callTool(user, source, prefixed, args) {
  const start = Date.now();
  const i = prefixed.indexOf("__");
  const slug = i > 0 ? prefixed.slice(0, i) : "";
  const tool = i > 0 ? prefixed.slice(i + 2) : prefixed;

  const server = enabledServers().find((s) => s.slug === slug);
  if (!server) {
    audit(user, source, slug, tool, Date.now() - start, "error", "unknown or disabled server");
    return errResult(`Unknown tool "${prefixed}". The server may be disabled or the name is wrong.`);
  }
  try {
    const result = await callUpstreamTool(server, tool, args);
    audit(user, source, slug, tool, Date.now() - start, result.isError ? "error" : "success", result.isError ? "tool returned an error" : null);
    return result;
  } catch (e) {
    audit(user, source, slug, tool, Date.now() - start, "error", e.message);
    return errResult(`Server "${slug}" failed or timed out: ${e.message}`);
  }
}
