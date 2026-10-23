import { useState } from "react";
import { api } from "./api";

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!input.trim() || busy) return;
    const next = [...messages, { role: "user", text: input }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const r = await api("/chat", { method: "POST", body: { messages: next.map(({ role, text }) => ({ role, text })) } });
      setMessages([...next, { role: "assistant", text: r.reply, toolCalls: r.toolCalls }]);
    } catch (e) {
      setMessages([...next, { role: "assistant", text: "Error: " + e.message }]);
    }
    setBusy(false);
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <h3>Chat agent</h3>
      <p style={{ color: "gray" }}>Try: "What tools do you have?", "Create a product called Test Cap priced 99", "What orders came in today?"</p>
      <div style={{ border: "1px solid #ccc", padding: 12, minHeight: 240, marginBottom: 8 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <b>{m.role === "user" ? "You" : "Agent"}:</b> <span style={{ whiteSpace: "pre-wrap" }}>{m.text}</span>
            {m.toolCalls?.length > 0 && (
              <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
                Tools called: {m.toolCalls.map((t, j) => (
                  <code key={j} style={{ marginRight: 6, color: t.ok ? "green" : "crimson" }}>{t.name}({JSON.stringify(t.args)})</code>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <p style={{ color: "gray" }}>Thinking...</p>}
      </div>
      <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
        placeholder="Ask something..." style={{ width: "80%" }} />
      <button onClick={send} disabled={busy}>Send</button>
    </div>
  );
}
