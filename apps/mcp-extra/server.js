import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const KIND = process.env.SERVER_KIND || "notes"; // "notes" or "utils"
const PORT = Number(process.env.PORT || 3000);

const ok = (data) => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });

// In-memory notes (resets when the pod restarts, fine for a demo)
const notes = [
  { id: 1, title: "Welcome", body: "This is the notes server." },
  { id: 2, title: "Store ideas", body: "Add a summer mug collection." },
];

function buildServer() {
  const server = new McpServer({ name: `${KIND}-mcp`, version: "1.0.0" });

  if (KIND === "notes") {
    server.tool("search", "Search saved notes by keyword.",
      { query: z.string().describe("Keyword to look for in note titles and bodies") },
      async ({ query }) => ok(notes.filter((n) =>
        (n.title + " " + n.body).toLowerCase().includes(query.toLowerCase()))));

    server.tool("add_note", "Save a new note.",
      { title: z.string(), body: z.string() },
      async ({ title, body }) => {
        const n = { id: notes.length + 1, title, body };
        notes.push(n);
        return ok(n);
      });

    server.tool("list_notes", "List all saved notes.", {}, async () => ok(notes));
  } else {
    server.tool("search", "Search a small built-in glossary of e-commerce terms.",
      { query: z.string().describe("Term to look up") },
      async ({ query }) => {
        const glossary = {
          sku: "Stock keeping unit: a unique code for a product.",
          cod: "Cash on delivery: the customer pays when the order arrives.",
          aov: "Average order value: total revenue divided by number of orders.",
        };
        const hits = Object.entries(glossary).filter(([k, v]) =>
          (k + " " + v).toLowerCase().includes(query.toLowerCase()));
        return ok(hits.length ? Object.fromEntries(hits) : "No matching terms.");
      });

    server.tool("current_time", "Get the current date and time in ISO format.", {},
      async () => ok(new Date().toISOString()));

    server.tool("calculate", "Add, subtract, multiply or divide two numbers.",
      { a: z.number(), b: z.number(), op: z.enum(["add", "sub", "mul", "div"]) },
      async ({ a, b, op }) => {
        if (op === "div" && b === 0) return { isError: true, content: [{ type: "text", text: "Cannot divide by zero" }] };
        const r = { add: a + b, sub: a - b, mul: a * b, div: a / b }[op];
        return ok(String(r));
      });
  }
  return server;
}

const app = express();
app.use(express.json());
app.get("/healthz", (req, res) => res.json({ ok: true, kind: KIND }));

app.post("/mcp", async (req, res) => {
  const server = buildServer();
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
const notAllowed = (req, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
app.get("/mcp", notAllowed);
app.delete("/mcp", notAllowed);

app.listen(PORT, () => console.log(`${KIND}-mcp listening on :${PORT}/mcp`));
