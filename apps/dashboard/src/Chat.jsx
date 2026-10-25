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
    <div className="chat">
      <h3>Chat agent</h3>
      <p className="hint">Try: "What tools do you have?", "Create a product called Test Cap priced 99", "What orders came in today?"</p>
      <div className="chatbox">
        {messages.length === 0 && <span className="hint">No messages yet.</span>}
        {messages.map((m, i) => (
          <div key={i} className={"msg " + m.role}>
            {m.text}
            {m.toolCalls?.length > 0 && (
              <div className="chips">
                {m.toolCalls.map((t, j) => (
                  <span key={j} className={"chip" + (t.ok ? "" : " bad")}>{t.name}({JSON.stringify(t.args)})</span>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <span className="hint">Thinking...</span>}
      </div>
      <div className="composer">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask something..." />
        <button className="primary" onClick={send} disabled={busy}>Send</button>
      </div>
    </div>
  );
}
