import { useEffect, useState } from "react";
import { api } from "./api";

const colors = { connected: "green", unreachable: "crimson", disabled: "gray", unknown: "orange" };
const empty = { slug: "", name: "", url: "", auth_header: "", credential: "" };

export default function Servers() {
  const [servers, setServers] = useState([]);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    try { setServers(await api("/servers")); setError(""); }
    catch (e) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    try {
      await api("/servers", { method: "POST", body: form });
      setForm(empty);
      load();
    } catch (e) { setError(e.message); }
  }
  async function toggle(s) { await api(`/servers/${s.id}`, { method: "PATCH", body: { enabled: !s.enabled } }); load(); }
  async function remove(s) {
    if (confirm(`Remove server "${s.name}"?`)) { await api(`/servers/${s.id}`, { method: "DELETE" }); load(); }
  }
  async function editCred(s) {
    const c = prompt(`New credential for "${s.name}" (leave empty to clear):`);
    if (c !== null) { await api(`/servers/${s.id}`, { method: "PATCH", body: { credential: c } }); load(); }
  }

  return (
    <div>
      <h3>MCP servers</h3>
      {error && <p className="error">{error}</p>}
      {loading && <p>Loading...</p>}
      <table border="1" cellPadding="6" style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr><th>Name</th><th>Slug</th><th>URL</th><th>Status</th><th>Credential</th><th>Tools</th><th>Actions</th></tr></thead>
        <tbody>
          {servers.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.slug}</td>
              <td>{s.url}</td>
              <td title={s.error || ""}><span className={"badge " + s.state}>{s.state}</span></td>
              <td>{s.has_credential ? "set (hidden)" : "none"}</td>
              <td>{s.tools.map((t) => t.name).join(", ")}</td>
              <td>
                <button onClick={() => toggle(s)}>{s.enabled ? "Disable" : "Enable"}</button>{" "}
                <button onClick={() => editCred(s)}>Credential</button>{" "}
                <button className="danger" onClick={() => remove(s)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Add a server</h4>
      {["slug", "name", "url", "auth_header", "credential"].map((k) => (
        <input key={k} placeholder={k === "auth_header" ? "auth header (optional, default Authorization)" : k}
          type={k === "credential" ? "password" : "text"}
          value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
          style={{ display: "block", width: 380, marginBottom: 6 }} />
      ))}
      <button className="primary" onClick={add}>Add server</button>
    </div>
  );
}
