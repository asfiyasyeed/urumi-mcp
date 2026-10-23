import { useEffect, useState } from "react";
import { api } from "./api";

export default function Members() {
  const [users, setUsers] = useState([]);
  const [keys, setKeys] = useState([]);
  const [form, setForm] = useState({ email: "", password: "", role: "member" });
  const [newKey, setNewKey] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try { setUsers(await api("/users")); setKeys(await api("/keys")); setError(""); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function add() {
    try { await api("/users", { method: "POST", body: form }); setForm({ email: "", password: "", role: "member" }); load(); }
    catch (e) { setError(e.message); }
  }
  async function remove(u) {
    if (confirm(`Remove ${u.email}?`)) { try { await api(`/users/${u.id}`, { method: "DELETE" }); load(); } catch (e) { setError(e.message); } }
  }
  async function issueKey(u) {
    const r = await api("/keys", { method: "POST", body: { user_id: u.id, name: "issued by admin" } });
    setNewKey(`Key for ${u.email}: ${r.key}`);
    load();
  }
  async function revoke(k) { await api(`/keys/${k.id}`, { method: "DELETE" }); load(); }

  return (
    <div>
      <h3>Members</h3>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {newKey && <p style={{ background: "#ffd", padding: 8 }}><b>Copy now, shown once:</b> <code>{newKey}</code></p>}
      <table border="1" cellPadding="6" style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr><th>Email</th><th>Role</th><th>Active keys</th><th>Actions</th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td><td>{u.role}</td><td>{u.active_keys}</td>
              <td><button onClick={() => issueKey(u)}>Issue key</button>{" "}<button onClick={() => remove(u)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>All API keys</h4>
      <table border="1" cellPadding="6" style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr><th>Owner</th><th>Prefix</th><th>Created</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id}>
              <td>{k.owner}</td><td>{k.key_prefix}...</td><td>{k.created_at}</td>
              <td>{k.revoked_at ? "revoked" : "active"}</td>
              <td>{!k.revoked_at && <button onClick={() => revoke(k)}>Revoke</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Invite a member</h4>
      <input placeholder="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ display: "block", width: 300, marginBottom: 6 }} />
      <input placeholder="initial password (min 8 chars)" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={{ display: "block", width: 300, marginBottom: 6 }} />
      <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={{ marginBottom: 6 }}>
        <option>member</option><option>admin</option>
      </select><br />
      <button onClick={add}>Add member</button>
    </div>
  );
}
