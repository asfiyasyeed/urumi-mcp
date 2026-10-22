import { db } from "./db.js";
const rows = [
  ["woo", "WooCommerce", process.env.WOO_URL || "http://localhost:3100/mcp"],
  ["notes", "Notes", process.env.NOTES_URL || "http://localhost:3201/mcp"],
  ["utils", "Utilities", process.env.UTILS_URL || "http://localhost:3202/mcp"],
];
for (const [slug, name, url] of rows) {
  db.prepare("INSERT INTO servers (slug, name, url) VALUES (?, ?, ?) ON CONFLICT(slug) DO UPDATE SET url = excluded.url")
    .run(slug, name, url);
}
console.log(db.prepare("SELECT slug, url, enabled FROM servers").all());
