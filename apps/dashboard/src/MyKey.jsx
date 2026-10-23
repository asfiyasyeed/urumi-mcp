import { useEffect, useState } from "react";
import { api } from "./api";

export default function MyKey() {
  const [keys, setKeys] = useState([]);
  const [newKey, setNewKey] = useState("");
  const [error, setError] = useState("");

  async function load() { try { setKeys(await api("/keys")); } catch (e) { setError(e.message); } }
  useEffect(() => { load(); }, []);

  async function create() {
    const r = await api("/keys", { method: "POST", body: { name: "my key" } });
    setNewKey(r.key);
    load();
  }
  async function revoke(k) { await api(`/keys/${k.id}`, { method: "DELETE" }); load(); }

  const origin = import.meta.env.VITE_GATEWAY_URL || (window.location.port === "5173" ? "http://localhost:4000" : window.location.origin);
  return (
    <div>
      <h3>My API key</h3>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <p>Your gateway URL: <code>{origin}/mcp</code><br />Send your key in the header <code>Authorization: Bearer &lt;your key&gt;</code>. Example for Claude Code:<br /><code>claude mcp add --transport http gateway {origin}/mcp --header "Authorization: Bearer YOUR_KEY"</code></p>
      <button onClick={create}>Generate new key</button>
      {newKey && <p style={{ background: "#ffd", padding: 8 }}><b>Copy now, shown only once:</b> <code>{newKey}</code></p>}
      <table border="1" cellPadding="6" style={{ borderCollapse: "collapse", marginTop: 12 }}>
        <thead><tr><th>Prefix</th><th>Created</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id}>
              <td>{k.key_prefix}...</td><td>{k.created_at}</td><td>{k.revoked_at ? "revoked" : "active"}</td>
              <td>{!k.revoked_at && <button onClick={() => revoke(k)}>Revoke</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
