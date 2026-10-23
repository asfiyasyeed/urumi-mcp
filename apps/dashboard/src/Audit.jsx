import { useEffect, useState } from "react";
import { api } from "./api";

export default function Audit() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  async function load() { try { setRows(await api("/audit?limit=200")); } catch (e) { setError(e.message); } }
  useEffect(() => { load(); }, []);

  return (
    <div>
      <h3>Audit log <button onClick={load}>Refresh</button></h3>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <table border="1" cellPadding="6" style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr><th>Time (UTC)</th><th>User</th><th>Via</th><th>Server</th><th>Tool</th><th>ms</th><th>Outcome</th><th>Error</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.ts}</td><td>{r.user_email}</td><td>{r.source}</td><td>{r.server_slug}</td><td>{r.tool}</td>
              <td>{r.duration_ms}</td>
              <td style={{ color: r.outcome === "success" ? "green" : "crimson" }}>{r.outcome}</td>
              <td>{r.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
