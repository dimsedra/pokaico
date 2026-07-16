import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./styles/index.css";

interface Message {
  id: string;
  sender: "user" | "pokai";
  text: string;
  isError?: boolean;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const isSubmitting = useRef(false);

  // Generate a unique session ID once per app launch
  const [sessionId] = useState(() => {
    return "session-" + Math.random().toString(36).substring(2, 10);
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isSubmitting.current) return;

    const userMessageText = input.trim();
    setInput("");
    isSubmitting.current = true;
    setLoading(true);

    const userMessage: Message = {
      id: "msg-" + Date.now() + "-user",
      sender: "user",
      text: userMessageText,
    };

    setMessages((prev) => [...prev, userMessage]);

    try {
      // Invoke Tauri Rust chat command (conversion of snake_case to camelCase argument)
      const res = await invoke<{ response: string }>("chat", {
        message: userMessageText,
        sessionId,
      });

      const pokaiMessage: Message = {
        id: "msg-" + Date.now() + "-pokai",
        sender: "pokai",
        text: res.response,
      };

      setMessages((prev) => [...prev, pokaiMessage]);
    } catch (err) {
      console.error("Chat error:", err);
      const errorMessage: Message = {
        id: "msg-" + Date.now() + "-error",
        sender: "pokai",
        text: String(err),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      isSubmitting.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <header className="chat-header">
        <h1>Pokaico</h1>
        <p>cozy AI lifespace</p>
      </header>

      <div className="messages-list">
        {messages.length === 0 && (
          <div className="typing-indicator" style={{ alignSelf: "center", fontStyle: "normal" }}>
            Start a cozy conversation with Pokai...
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`message-bubble ${msg.sender} ${msg.isError ? "error" : ""}`}
          >
            {msg.text}
          </div>
        ))}

        {loading && (
          <div className="typing-indicator">
            Pokai is thinking...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSendMessage} className="input-container">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          className="chat-input"
          readOnly={loading}
          autoFocus
        />
        <button
          type="submit"
          className="send-button"
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
}

export default App;
