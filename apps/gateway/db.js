import Database from "better-sqlite3";
import crypto from "node:crypto";

export const db = new Database(process.env.DB_PATH || "./gateway.db");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin','member')),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  key_prefix TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  auth_header TEXT,
  credential TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER,
  user_email TEXT,
  source TEXT,
  server_slug TEXT,
  tool TEXT,
  duration_ms INTEGER,
  outcome TEXT,
  error TEXT
);
`);

// Passwords: scrypt with a random salt (built into Node, no extra library)
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
export function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, "hex"));
}

// API keys: stored as SHA-256 hash; the raw key is shown once and never saved
export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

// Create the first admin from environment variables (only if no users exist)
export function seedAdmin() {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM users").get();
  const email = process.env.ADMIN_EMAIL;
  const pw = process.env.ADMIN_PASSWORD;
  if (count === 0 && email && pw) {
    db.prepare("INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, 'admin', ?)")
      .run(email, "Admin", hashPassword(pw));
    console.log(`Seeded admin user: ${email}`);
  }
}
