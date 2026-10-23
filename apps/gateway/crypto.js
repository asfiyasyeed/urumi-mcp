import crypto from "node:crypto";

function key() {
  const k = process.env.CREDENTIAL_KEY;
  if (!k) throw new Error("CREDENTIAL_KEY is not set");
  return crypto.createHash("sha256").update(k).digest();
}

// AES-256-GCM: encrypts and also detects tampering
export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return `enc:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

export function decrypt(v) {
  if (!v || !v.startsWith("enc:")) return v;
  const [, iv, tag, data] = v.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

export const decryptServer = (s) => ({ ...s, credential: decrypt(s.credential) });
