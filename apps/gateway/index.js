import { apiRouter } from "./api.js";
import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { db, seedAdmin, sha256 } from "./db.js";
import { listAllTools, callTool } from "./aggregator.js";

seedAdmin();

export function authenticate(req) {
  const m = (req.headers.authorization || "").match(/^Bearer (.+)$/i);
  if (!m) return null;
  return db.prepare(
    `SELECT u.id, u.email, u.role FROM api_keys k
     JOIN users u ON u.id = k.user_id
     WHERE k.key_hash = ? AND k.revoked_at IS NULL`
  ).get(sha256(m[1].trim())) || null;
}

// A new MCP server object per request, bound to the calling user
function buildServer(user) {
  const server = new Server({ name: "mcp-gateway", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await listAllTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    callTool(user, "mcp-client", req.params.name, req.params.arguments));
  return server;
}

const app = express();
app.use(express.json());
app.use("/api", apiRouter);
app.get("/healthz", (req, res) => res.json({ ok: true }));

app.post("/mcp", async (req, res) => {
  const user = authenticate(req);
  if (!user) {
    return res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Invalid or revoked API key" }, id: null });
  }
  const server = buildServer(user);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
  }
});
const no = (req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
app.get("/mcp", no);
app.delete("/mcp", no);

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => console.log(`gateway listening on :${PORT}`));
