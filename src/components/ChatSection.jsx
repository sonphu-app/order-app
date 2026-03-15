import { useEffect, useRef, useState } from "react";
import { getCurrentUser } from "../utils/auth";

export default function ChatSection({ orderId }) {
  const me = getCurrentUser();
  const bottomRef = useRef(null);

  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");

  // LOAD
  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem("chat_" + orderId) || "[]");
    setMessages(stored);
  }, [orderId]);

  // SAVE + AUTO SCROLL
  useEffect(() => {
    localStorage.setItem("chat_" + orderId, JSON.stringify(messages));
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, orderId]);

  // MARK AS SEEN
  useEffect(() => {
    if (!me?.username) return;

    setMessages(prev =>
      prev.map(m => {
        if (
          m.sender !== me.username &&
          !m.seenBy?.includes(me.username)
        ) {
          return {
            ...m,
            seenBy: [...(m.seenBy || []), me.username]
          };
        }
        return m;
      })
    );
  }, [me?.username]);

  function sendMessage() {
    if (!text.trim()) return;

    const newMsg = {
  id: Date.now(),
  sender: me.username,
  text,
  time: Date.now(),
  seenBy: [] // ban đầu chưa ai xem
};

    setMessages(prev => [...prev, newMsg]);
    setText("");
  }

  function recall(id) {
    setMessages(prev =>
      prev.map(m =>
        m.id === id ? { ...m, recalled: true } : m
      )
    );
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div style={S.wrapper}>
      {/* MESSAGE LIST */}
      <div style={S.messageList}>
        {messages.map(m => {
          const isOwner = m.sender === me?.username;

          return (
            <div
  key={m.id}
  style={{
    display: "flex",
    justifyContent: isOwner ? "flex-end" : "flex-start",
    marginBottom: 12
  }}
>
  <div
    style={{
      background: isOwner ? "#A8C4D0" : "#2a2a2a",
      color: isOwner ? "#000" : "#fff",
      borderRadius: 12,
      padding: 10,
      maxWidth: "80%",
      display: "flex",
      flexDirection: "column",
      gap: 6
    }}
  >
    {/* DÒNG 1 */}
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 12,
        opacity: 0.9
      }}
    >
      <span>{m.sender}</span>

      <span>
        {new Date(m.time).toLocaleString()}
      </span>

      {isOwner && (
        <span
          style={{ cursor: "pointer", marginLeft: 8 }}
          onClick={() => recall(m.id)}
        >
          Thu hồi
        </span>
      )}
    </div>

    {/* DÒNG 2-3 */}
    <div style={{ whiteSpace: "pre-wrap" }}>
      {m.text}
    </div>

    {/* DÒNG AI ĐÃ XEM */}
    <div
  style={{
    fontSize: 11,
    marginTop: 4,
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    justifyContent: isOwner ? "flex-end" : "flex-start"
  }}
>
  {m.seenBy && m.seenBy.length > 0 ? (
    <>
      <span style={{ opacity: 0.7 }}>Đã xem:</span>

      {m.seenBy.map(name => (
        <span
          key={name}
          style={{
            background: "#ffffff22",
            padding: "2px 6px",
            borderRadius: 6,
            fontSize: 10
          }}
        >
          {name}
        </span>
      ))}
    </>
  ) : (
    <span style={{ opacity: 0.6 }}>Chưa ai xem</span>
  )}
</div>
  </div>
</div>
          );
        })}

        <div ref={bottomRef}></div>
      </div>

      {/* INPUT CỐ ĐỊNH DƯỚI */}
      <div style={S.inputBar}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Nhập tin nhắn..."
          style={S.input}
        />
        <div style={S.btnColumn}>
          <button style={S.sendBtn} onClick={sendMessage}>
            ➤
          </button>
          <button
            style={S.lineBtn}
            onClick={() => setText(t => t + "\n")}
          >
            ↵
          </button>
        </div>
      </div>
    </div>
  );
}

const S = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    height: "100%"
  },
  messageList: {
    flex: 1,
    overflowY: "auto",
    padding: 12
  },
  msg: {
    display: "flex",
    flexDirection: "column",
    marginBottom: 14
  },
  header: {
    display: "flex",
    gap: 10,
    fontSize: 12,
    opacity: 0.8
  },
  recall: {
    cursor: "pointer",
    color: "#ff7777"
  },
  bubble: {
    padding: 10,
    borderRadius: 10,
    maxWidth: "80%",
    whiteSpace: "pre-wrap"
  },
  seen: {
    fontSize: 11,
    opacity: 0.6,
    marginTop: 4
  },
  inputBar: {
    position: "sticky",
    bottom: 0,
    background: "#1a1a1a",
    padding: 10,
    borderTop: "1px solid #333",
    display: "flex",
    gap: 8
  },
  input: {
    flex: 1,
    background: "#2a2a2a",
    border: "none",
    color: "white",
    borderRadius: 8,
    padding: 10,
    resize: "none"
  },
  btnColumn: {
    display: "flex",
    flexDirection: "column",
    gap: 6
  },
  sendBtn: {
    background: "#2ecc71",
    border: "none",
    borderRadius: 8,
    padding: "6px 10px",
    cursor: "pointer"
  },
  lineBtn: {
    background: "#444",
    border: "none",
    borderRadius: 8,
    padding: "6px 10px",
    cursor: "pointer",
    color: "white"
  }
};