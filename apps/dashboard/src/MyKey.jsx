import { useEffect, useState } from "react";
import { api } from "./api";

function Copy({ text }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(text);
      else {
        const t = document.createElement("textarea");
        t.value = text; document.body.appendChild(t); t.select();
        document.execCommand("copy"); t.remove();
      }
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch { /* ignore */ }
  }
  return <button onClick={copy}>{done ? "Copied" : "Copy"}</button>;
}

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
  const url = `${origin}/mcp`;
  const header = "Authorization: Bearer <your key>";
  const example = `claude mcp add --transport http gateway ${url} --header "Authorization: Bearer <your key>"`;

  return (
    <div>
      <h3>My API key</h3>
      {error && <p className="error">{error}</p>}

      <div className="panel">
        <div className="panel-title">Connect an MCP client</div>
        <div className="row"><span className="label">Gateway URL</span><code>{url}</code><Copy text={url} /></div>
        <div className="row"><span className="label">Header</span><code>{header}</code><Copy text={header} /></div>
        <details>
          <summary>Example: Claude Code</summary>
          <div className="row"><code>{example}</code><Copy text={example} /></div>
        </details>
      </div>

      <div className="actions">
        <button className="primary" onClick={create}>Generate new key</button>
        <span className="hint">The full key is shown once, then only its prefix.</span>
      </div>
      {newKey && (
        <div className="keybox row">
          <code>{newKey}</code><Copy text={newKey} />
        </div>
      )}

      <h4>Your keys</h4>
      <table>
        <thead><tr><th>Prefix</th><th>Created</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id}>
              <td><code>{k.key_prefix}...</code></td>
              <td>{k.created_at}</td>
              <td><span className={"badge " + (k.revoked_at ? "" : "connected")}>{k.revoked_at ? "revoked" : "active"}</span></td>
              <td>{!k.revoked_at && <button className="danger" onClick={() => revoke(k)}>Revoke</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
