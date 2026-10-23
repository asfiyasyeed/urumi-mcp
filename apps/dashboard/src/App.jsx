import { useState } from "react";
import { api } from "./api";

function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    try {
      const r = await api("/login", { method: "POST", body: { email, password } });
      sessionStorage.setItem("token", r.token);
      onLogin(r.user);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div style={{ maxWidth: 320, margin: "80px auto", fontFamily: "sans-serif" }}>
      <h2>MCP Gateway</h2>
      <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
      <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
      <button onClick={submit}>Log in</button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  if (!user) return <Login onLogin={setUser} />;
  return (
    <div style={{ fontFamily: "sans-serif", padding: 24 }}>
      <h2>Welcome, {user.email} ({user.role})</h2>
      <button onClick={() => { sessionStorage.clear(); setUser(null); }}>Log out</button>
    </div>
  );
}
