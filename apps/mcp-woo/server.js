import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const BASE = process.env.WOO_BASE_URL || "http://wordpress.store.svc.cluster.local";
const HOST = process.env.WOO_HOST_HEADER || "store.localtest.me:8080";
const KEY = process.env.WOO_CONSUMER_KEY;
const SECRET = process.env.WOO_CONSUMER_SECRET;
const PORT = Number(process.env.PORT || 3000);

if (!KEY || !SECRET) {
  console.error("Missing WOO_CONSUMER_KEY or WOO_CONSUMER_SECRET");
  process.exit(1);
}
const AUTH = "Basic " + Buffer.from(`${KEY}:${SECRET}`).toString("base64");

// One helper that talks to the WooCommerce REST API
async function wc(method, path, { query, body } = {}) {
  const url = new URL(`${BASE}/wp-json/wc/v3${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: AUTH,
      Host: HOST,
      "X-Forwarded-Proto": "https",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const msg = typeof data === "string" ? data.slice(0, 200) : data.message || JSON.stringify(data);
    throw new Error(`WooCommerce returned ${res.status}: ${msg}`);
  }
  return data;
}

const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: "text", text: `Error: ${e.message}` }] });
const safe = (fn) => async (args) => {
  try { return ok(await fn(args)); } catch (e) { return fail(e); }
};

const product = (p) => ({
  id: p.id, name: p.name, price: p.price, status: p.status,
  stock_status: p.stock_status, link: p.permalink,
});
const order = (o) => ({
  id: o.id, status: o.status, total: o.total, currency: o.currency,
  created: o.date_created,
  customer: `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim(),
  items: (o.line_items || []).map((i) => ({ name: i.name, quantity: i.quantity })),
});

function buildServer() {
  const server = new McpServer({ name: "woocommerce-mcp", version: "1.0.0" });

  server.tool(
    "list_products",
    "List products in the WooCommerce store. Optionally search by name.",
    {
      search: z.string().optional().describe("Text to search in product names"),
      per_page: z.number().int().min(1).max(50).default(10).describe("How many products to return"),
    },
    safe(async ({ search, per_page }) =>
      (await wc("GET", "/products", { query: { search, per_page } })).map(product))
  );

  server.tool(
    "create_product",
    "Create and publish a new product with a name and a price.",
    {
      name: z.string().min(1).describe("Product name"),
      regular_price: z.string().describe("Price as a string, e.g. '199'"),
      description: z.string().optional().describe("Optional product description"),
    },
    safe(async ({ name, regular_price, description }) =>
      product(await wc("POST", "/products", {
        body: { name, regular_price, description, status: "publish", type: "simple" },
      })))
  );

  server.tool(
    "list_orders",
    "List orders. Use 'after' (ISO date-time, e.g. 2026-10-21T00:00:00) to get orders created since that moment, such as today's orders.",
    {
      status: z.string().optional().describe("Order status such as processing, completed, on-hold"),
      after: z.string().optional().describe("Only orders created after this ISO 8601 date-time"),
      per_page: z.number().int().min(1).max(50).default(10),
    },
    safe(async ({ status, after, per_page }) =>
      (await wc("GET", "/orders", { query: { status, after, per_page } })).map(order))
  );

  server.tool(
    "get_order",
    "Get full details of one order by its ID.",
    { id: z.number().int().describe("Order ID") },
    safe(async ({ id }) => await wc("GET", `/orders/${id}`))
  );

  server.tool(
    "update_order_status",
    "Change the status of an order.",
    {
      id: z.number().int().describe("Order ID"),
      status: z.enum(["pending", "processing", "on-hold", "completed", "cancelled", "refunded"]),
    },
    safe(async ({ id, status }) => order(await wc("PUT", `/orders/${id}`, { body: { status } })))
  );

  return server;
}

const app = express();
app.use(express.json());

app.get("/healthz", (req, res) => res.json({ ok: true }));

// Stateless mode: a fresh server + transport for every request
app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  }
});
const notAllowed = (req, res) =>
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
app.get("/mcp", notAllowed);
app.delete("/mcp", notAllowed);

app.listen(PORT, () => console.log(`woocommerce-mcp listening on :${PORT}/mcp`));
