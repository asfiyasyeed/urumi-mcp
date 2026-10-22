import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 8000);

// Open a short-lived connection to one upstream, run fn(client), then close it.
async function withClient(server, fn) {
  const headers = {};
  if (server.credential) {
    headers[server.auth_header || "Authorization"] = server.credential;
  }
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers },
  });
  const client = new Client({ name: "mcp-gateway", version: "1.0.0" });
  try {
    await client.connect(transport, { timeout: TIMEOUT_MS });
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function listUpstreamTools(server) {
  return withClient(server, async (c) => (await c.listTools({}, { timeout: TIMEOUT_MS })).tools);
}

export async function callUpstreamTool(server, tool, args) {
  return withClient(server, (c) =>
    c.callTool({ name: tool, arguments: args || {} }, undefined, { timeout: TIMEOUT_MS })
  );
}
