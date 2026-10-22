import { db } from "./db.js";
import { listUpstreamTools } from "./upstream.js";

db.prepare("INSERT OR IGNORE INTO servers (slug, name, url) VALUES (?, ?, ?)")
  .run("woo", "WooCommerce", "http://localhost:3100/mcp");

const server = db.prepare("SELECT * FROM servers WHERE slug = 'woo'").get();
const tools = await listUpstreamTools(server);
console.log(tools.map((t) => `${server.slug}__${t.name}`));
