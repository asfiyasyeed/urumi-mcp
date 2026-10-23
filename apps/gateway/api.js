import { runChat } from "./chat.js";
import express from "express";
import crypto from "node:crypto";
import { db, hashPassword, verifyPassword, sha256 } from "./db.js";
import { status, refreshServer, listAllTools } from "./aggregator.js";
import { encrypt, decryptServer } from "./crypto.js";

db.exec(`CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
)`);

export const apiRouter = express.Router();
const SESSION_MS = 8 * 60 * 60 * 1000;

// ---------- auth middleware ----------
function auth(req, res, next) {
  const m = (req.headers.authorization || "").match(/^Bearer (ses_.+)$/);
  if (!m) return res.status(401).json({ error: "Not logged in" });
  const user = db.prepare(
    `SELECT u.id, u.email, u.name, u.role FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  ).get(sha256(m[1]), Date.now());
  if (!user) return res.status(401).json({ error: "Session expired. Please log in again." });
  req.user = user;
  next();
}
const adminOnly = (req, res, next) =>
  req.user.role === "admin" ? next() : res.status(403).json({ error: "Admins only" });

// ---------- login / logout ----------
apiRouter.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare("SELECT * FROM users WHERE email = ?").get(email || "");
  if (!u || !verifyPassword(password || "", u.password_hash)) {
    return res.status(401).json({ error: "Wrong email or password" });
  }
  const token = "ses_" + crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(sha256(token), u.id, Date.now() + SESSION_MS);
  res.json({ token, user: { id: u.id, email: u.email, name: u.name, role: u.role } });
});

apiRouter.post("/logout", auth, (req, res) => {
  const m = req.headers.authorization.match(/^Bearer (ses_.+)$/);
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(m[1]));
  res.json({ ok: true });
});

apiRouter.get("/me", auth, (req, res) => res.json(req.user));

// ---------- tools (any logged-in user) ----------
apiRouter.get("/tools", auth, async (req, res) => res.json(await listAllTools()));

// ---------- servers (admin) ----------
const normalizeCred = (cred, header) =>
  (!header || header === "Authorization") && !/\s/.test(cred) ? `Bearer ${cred}` : cred;

const validUrl = (u) => {
  try { return ["http:", "https:"].includes(new URL(u).protocol); } catch { return false; }
};

const publicServer = (s, st) => ({
  id: s.id, slug: s.slug, name: s.name, url: s.url,
  auth_header: s.auth_header,
  has_credential: !!s.credential,          // the credential itself is never returned
  enabled: !!s.enabled,
  state: s.enabled ? (st?.state || "unknown") : "disabled",
  error: s.enabled ? st?.error || null : null,
  tools: (st?.tools || []).map((t) => ({ name: t.name, description: t.description })),
});

apiRouter.get("/servers", auth, adminOnly, async (req, res) => {
  const rows = db.prepare("SELECT * FROM servers ORDER BY id").all();
  await Promise.allSettled(rows.filter((s) => s.enabled).map((s) => refreshServer(decryptServer(s))));
  res.json(rows.map((s) => publicServer(s, status.get(s.slug))));
});

apiRouter.post("/servers", auth, adminOnly, async (req, res) => {
  const { slug, name, url, auth_header, credential } = req.body || {};
  if (!/^[a-z0-9-]{2,20}$/.test(slug || "")) {
    return res.status(400).json({ error: "slug must be 2-20 chars: lowercase letters, digits, hyphens" });
  }
  if (!name) return res.status(400).json({ error: "name is required" });
  if (!validUrl(url)) return res.status(400).json({ error: "url must start with http:// or https://" });
  const hdr = auth_header || null;
  const cred = credential ? encrypt(normalizeCred(credential, hdr)) : null;
  try {
    db.prepare("INSERT INTO servers (slug, name, url, auth_header, credential) VALUES (?, ?, ?, ?, ?)")
      .run(slug, name, url, hdr, cred);
  } catch {
    return res.status(409).json({ error: "A server with this slug already exists" });
  }
  const row = db.prepare("SELECT * FROM servers WHERE slug = ?").get(slug);
  await refreshServer(decryptServer(row));
  res.status(201).json(publicServer(row, status.get(slug)));
});

apiRouter.patch("/servers/:id", auth, adminOnly, async (req, res) => {
  const s = db.prepare("SELECT * FROM servers WHERE id = ?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "Server not found" });
  const b = req.body || {};
  const url = b.url ?? s.url;
  if (!validUrl(url)) return res.status(400).json({ error: "url must start with http:// or https://" });
  const hdr = b.auth_header ?? s.auth_header;
  let cred = s.credential;
  if (b.credential !== undefined) cred = b.credential ? encrypt(normalizeCred(b.credential, hdr)) : null;
  const enabled = b.enabled === undefined ? s.enabled : b.enabled ? 1 : 0;
  db.prepare("UPDATE servers SET name = ?, url = ?, auth_header = ?, credential = ?, enabled = ? WHERE id = ?")
    .run(b.name ?? s.name, url, hdr, cred, enabled, s.id);
  status.delete(s.slug);
  const row = db.prepare("SELECT * FROM servers WHERE id = ?").get(s.id);
  if (row.enabled) await refreshServer(decryptServer(row));
  res.json(publicServer(row, status.get(row.slug)));
});

apiRouter.delete("/servers/:id", auth, adminOnly, (req, res) => {
  const s = db.prepare("SELECT * FROM servers WHERE id = ?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "Server not found" });
  db.prepare("DELETE FROM servers WHERE id = ?").run(s.id);
  status.delete(s.slug);
  res.json({ ok: true });
});

// ---------- members (admin) ----------
apiRouter.get("/users", auth, adminOnly, (req, res) => {
  res.json(db.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.created_at,
       (SELECT COUNT(*) FROM api_keys k WHERE k.user_id = u.id AND k.revoked_at IS NULL) AS active_keys
     FROM users u ORDER BY u.id`
  ).all());
});

apiRouter.post("/users", auth, adminOnly, (req, res) => {
  const { email, name, role, password } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: "email and a password of at least 8 characters are required" });
  }
  if (!["admin", "member"].includes(role || "member")) return res.status(400).json({ error: "role must be admin or member" });
  try {
    const r = db.prepare("INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)")
      .run(email, name || email.split("@")[0], role || "member", hashPassword(password));
    res.status(201).json({ id: r.lastInsertRowid, email, role: role || "member" });
  } catch {
    res.status(409).json({ error: "A user with this email already exists" });
  }
});

apiRouter.delete("/users/:id", auth, adminOnly, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: "You cannot remove yourself" });
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- API keys ----------
apiRouter.get("/keys", auth, (req, res) => {
  const admin = req.user.role === "admin";
  res.json(db.prepare(
    `SELECT k.id, k.name, k.key_prefix, k.created_at, k.revoked_at, u.email AS owner
     FROM api_keys k JOIN users u ON u.id = k.user_id
     WHERE (? = 1 OR k.user_id = ?) ORDER BY k.id DESC`
  ).all(admin ? 1 : 0, req.user.id));
});

apiRouter.post("/keys", auth, (req, res) => {
  const owner = req.user.role === "admin" && req.body?.user_id ? Number(req.body.user_id) : req.user.id;
  if (!db.prepare("SELECT id FROM users WHERE id = ?").get(owner)) return res.status(404).json({ error: "User not found" });
  const raw = "gw_" + crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO api_keys (user_id, name, key_prefix, key_hash) VALUES (?, ?, ?, ?)")
    .run(owner, req.body?.name || "key", raw.slice(0, 7), sha256(raw));
  res.status(201).json({ key: raw, note: "Copy this now. It is shown only once." });
});

apiRouter.delete("/keys/:id", auth, (req, res) => {
  const k = db.prepare("SELECT * FROM api_keys WHERE id = ?").get(req.params.id);
  if (!k || (req.user.role !== "admin" && k.user_id !== req.user.id)) {
    return res.status(404).json({ error: "Key not found" });
  }
  db.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").run(k.id);
  res.json({ ok: true });
});

// ---------- audit log ----------
apiRouter.get("/audit", auth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const admin = req.user.role === "admin";
  res.json(db.prepare(
    `SELECT id, ts, user_email, source, server_slug, tool, duration_ms, outcome, error
     FROM audit_log WHERE (? = 1 OR user_id = ?) ORDER BY id DESC LIMIT ?`
  ).all(admin ? 1 : 0, req.user.id, limit));
});

// ---------- chat agent (any logged-in user; acts as that user) ----------
apiRouter.post("/chat", auth, async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!messages.length) return res.status(400).json({ error: "messages are required" });
  try {
    res.json(await runChat(req.user, messages));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
