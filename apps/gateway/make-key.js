import crypto from "node:crypto";
import { db, hashPassword, sha256 } from "./db.js";
const [email, role = "member", password = "changeme123"] = process.argv.slice(2);
if (!email) { console.error("usage: node make-key.js email [admin|member] [password]"); process.exit(1); }
let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
if (!user) {
  const r = db.prepare("INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)")
    .run(email, email.split("@")[0], role, hashPassword(password));
  user = { id: r.lastInsertRowid };
}
const raw = "gw_" + crypto.randomBytes(24).toString("hex");
db.prepare("INSERT INTO api_keys (user_id, name, key_prefix, key_hash) VALUES (?, ?, ?, ?)")
  .run(user.id, "cli", raw.slice(0, 7), sha256(raw));
console.log(`Key for ${email}:\n${raw}\n(copy it now; it is not stored)`);
