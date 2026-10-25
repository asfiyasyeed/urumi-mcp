import { useEffect, useState } from "react";
import { api } from "./api";
import Servers from "./Servers";
import Members from "./Members";
import MyKey from "./MyKey";
import Audit from "./Audit";
import Chat from "./Chat";

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
    <div className="login">
      <h2>MCP Gateway</h2>
      <p className="hint">Sign in to manage servers and use your tools.</p>
      <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="Password" type="password" value={password}
        onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <button className="primary" onClick={submit}>Log in</button>
      {error && <p className="error">{error}</p>}
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

  if (!ready) return <p className="shell hint">Loading...</p>;
  if (!user) return <Login onLogin={(u) => { setUser(u); setPage(u.role === "admin" ? "servers" : "mykey"); }} />;

  const admin = user.role === "admin";
  const tabs = [
    ...(admin ? [["servers", "Servers"], ["members", "Members"]] : []),
    ["mykey", "My API key"],
    ["chat", "Chat"],
    ["audit", "Audit log"],
  ];
  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <span className="brand">MCP Gateway</span>
          {tabs.map(([id, label]) => (
            <button key={id} className={"tab" + (page === id ? " active" : "")} onClick={() => setPage(id)}>{label}</button>
          ))}
          <span className="who">{user.email} ({user.role})</span>
          <button onClick={async () => { await api("/logout", { method: "POST" }).catch(() => {}); sessionStorage.clear(); setUser(null); }}>Log out</button>
        </div>
      </div>
      <div className="shell">
        {page === "servers" && admin && <Servers />}
        {page === "members" && admin && <Members />}
        {page === "mykey" && <MyKey />}
        {page === "chat" && <Chat />}
        {page === "audit" && <Audit />}
      </div>
    </>
  );
}
