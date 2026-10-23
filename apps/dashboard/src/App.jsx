import { useEffect, useState } from "react";
import { api } from "./api";
import Servers from "./Servers";
import Members from "./Members";
import MyKey from "./MyKey";
import Audit from "./Audit";

function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function submit() {
    try {
      const r = await api("/login", { method: "POST", body: { email, password } });
      sessionStorage.setItem("token", r.token);
      onLogin(r.user);
    } catch (e) { setError(e.message); }
  }
  return (
    <div style={{ maxWidth: 320, margin: "80px auto", fontFamily: "sans-serif" }}>
      <h2>MCP Gateway</h2>
      <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
      <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()} style={{ width: "100%", marginBottom: 8 }} />
      <button onClick={submit}>Log in</button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("mykey");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!sessionStorage.getItem("token")) { setReady(true); return; }
    api("/me").then(setUser).catch(() => sessionStorage.clear()).finally(() => setReady(true));
  }, []);

  if (!ready) return <p style={{ padding: 24 }}>Loading...</p>;
  if (!user) return <Login onLogin={(u) => { setUser(u); setPage(u.role === "admin" ? "servers" : "mykey"); }} />;

  const admin = user.role === "admin";
  const tabs = [
    ...(admin ? [["servers", "Servers"], ["members", "Members"]] : []),
    ["mykey", "My API key"],
    ["audit", "Audit log"],
  ];
  return (
    <div style={{ fontFamily: "sans-serif", padding: 24 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <b>MCP Gateway</b>
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setPage(id)} style={{ fontWeight: page === id ? "bold" : "normal" }}>{label}</button>
        ))}
        <span style={{ marginLeft: "auto" }}>{user.email} ({user.role})</span>
        <button onClick={async () => { await api("/logout", { method: "POST" }).catch(() => {}); sessionStorage.clear(); setUser(null); }}>Log out</button>
      </div>
      {page === "servers" && admin && <Servers />}
      {page === "members" && admin && <Members />}
      {page === "mykey" && <MyKey />}
      {page === "audit" && <Audit />}
    </div>
  );
}
