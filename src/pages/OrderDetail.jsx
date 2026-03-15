import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { loadOrders, updateOrderById } from "../utils/ordersAdapter";
import { getCurrentUser } from "../utils/auth";
import OrderActions from "../components/OrderActions";
import ImageEditor from "../components/ImageEditor";
import { getUsers } from "../utils/auth";

export default function OrderDetail() {
const users = getUsers();

const getName = (id) => {
  const u = users.find(x => x.id === id);
  return u ? u.name : id;
};
  const { id } = useParams();
  const navigate = useNavigate();
const handleEdit = () => {
  navigate("/create", { state: { editing: order } });
};
  const me = getCurrentUser();

  const [order, setOrder] = useState(null);
const bodyRef = useRef(null);
const inputRef = useRef(null);
const [images, setImages] = useState([]);

  // CHAT
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");

  // IMAGE VIEWER (AN TOÀN)
  const [viewerIndex, setViewerIndex] = useState(-1); // -1 = đóng

  const orderTopRef = useRef(null);
  const bottomRef = useRef(null);
const [editIndex, setEditIndex] = useState(-1);
// VIEWER cho ảnh trong CHAT
const [chatViewer, setChatViewer] = useState(null); 
// null | { imgs: string[], i: number }

  /* ================= LOAD ORDER ================= */
  useEffect(() => {
    const found = loadOrders().find(o => o.id === id);
    setOrder(found || null);
  }, [id]);

  /* ================= LOAD CHAT ================= */
  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem("chat_" + id) || "[]");
    setMessages(stored);
  }, [id]);

  /* ================= SAVE CHAT + AUTO SCROLL ================= */
  useEffect(() => {
    localStorage.setItem("chat_" + id, JSON.stringify(messages));
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, id]);

  /* ================= MARK AS SEEN ================= */
  useEffect(() => {
    if (!me?.username) return;

    setMessages(prev =>
      prev.map(m => {
        if (m.userId !== me.id && !m.seenBy?.includes(me.id)) {
  return {
    ...m,
    seenBy: [...(m.seenBy || []), me.id]
  };
}
        return m;
      })
    );
  }, [me?.username]);

  if (!order) return null;

  /* ================= CHAT ================= */
  function sendMessage() {
  if (!text.trim() && images.length === 0) return;

  const msg = {
  id: Date.now(),
  userId: me.id,          // ⭐ thêm
  name: me.name,          // ⭐ thêm
  time: Date.now(),
  text,
  images,
  seenBy: []
};

  setMessages(prev => [...prev, msg]);
  setText("");
  setImages([]);   // 🔥 reset preview sau khi gửi
}

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function recall(id) {
    setMessages(prev =>
      prev.map(m =>
        m.id === id ? { ...m, recalled: true } : m
      )
    );
  }

  /* ================= DELETE ================= */
  function handleDelete() {
    const isAdmin = me?.roles?.includes("admin");
    if (!window.confirm("Xác nhận xoá đơn?")) return;

    if (isAdmin) {
      const orders = loadOrders().filter(o => o.id !== order.id);
      localStorage.setItem("orders", JSON.stringify(orders));
      navigate("/");
    } else {
      const updated = { ...order, cancelRequested: true };
      updateOrderById(order.id, updated);
      setOrder(updated);
      navigate("/");
    }
  }

  /* ================= RENDER ================= */
  return (
    <div style={S.page}>

      {/* ===== HEADER ===== */}
      <div style={S.header}>
        <div style={S.title}>
  {order.type === "system-task" && "🚨 NHIỆM VỤ HỆ THỐNG"}
  {order.type === "system-message" && "📢 TIN NHẮN HỆ THỐNG"}
  {(!order.type || order.type === "normal") && order.title}
</div>

        <div style={S.sub}>
          Tạo: {order.createdBy || "-"} |
          Đã xong: {order.done ? "✓" : "-"} |
          Giao: {order.shipped ? "✓" : "-"} |
          Hoàn thành: {order.completed ? "✓" : "-"}
        </div>
<OrderActions
  order={order}
  onUpdated={(updated) => setOrder(updated)}
/>
{/* ===== BACK BAR ===== */}
        <div
  style={S.backBar}
  onClick={() =>
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    })
  }
>
  ↑ Quay lại đơn hàng
</div>
      </div>

      {/* ===== BODY ===== */}
      <div style={S.body} ref={bodyRef}>

        {/* ===== ORDER CONTENT ===== */}
        <div ref={orderTopRef} style={S.orderBox}>
          <div style={S.orderText}>
  <div style={S.orderTitleInside}>
    {order.title}
  </div>

  <div style={{ marginTop: 6 }}>
    {order.text}
  </div>
</div>

          {order.images?.length > 0 && (
  <div style={S.orderImages}>
    {order.images.map((img, i) => (
  <img
    key={i}
    src={img}
    style={S.orderImg}
    onClick={() => setViewerIndex(i)}   // 👈 chỉ mở viewer
  />
))}
  </div>
)}
        </div>


        {/* ===== CHAT ===== */}
        <div>
          {messages.map(m => {
            const isOwner = m.userId === me.id;
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
                    ...S.bubble,
                    background: isOwner ? "#1f6f8b" : "#2a2a2a",
                    color: isOwner ? "#000" : "#fff"
                  }}
                >
                  <div style={S.msgHeader}>
                    <span>{m.name}</span>
                    <span>{new Date(m.time).toLocaleString()}</span>
                    {isOwner && (
                      <span style={S.recall} onClick={() => recall(m.id)}>
                        Thu hồi
                      </span>
                    )}
                  </div>

                  <div style={S.msgText}>
  {m.recalled ? "Tin nhắn đã thu hồi" : m.text}
</div>

{m.images?.length > 0 && (
  <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
    {m.images.map((img, i) => (
      <img
  key={i}
  src={img}
  alt=""
  style={{
    width: 120,
    height: 120,
    objectFit: "cover",
    borderRadius: 12,
    cursor: "pointer"
  }}
  onClick={() => setChatViewer({ imgs: m.images, i })}
/>
    ))}
  </div>
)}

                  <div style={S.seen}>
                    {m.seenBy?.length
  ? "Đã xem: " + m.seenBy.map(getName).join(", ")
  : "Chưa ai xem"}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* ===== INPUT ===== */}
<div style={S.inputBar}>

  {/* PREVIEW ẢNH */}
  {images.length > 0 && (
    <div style={S.previewRow}>
      {images.map((img, i) => (
  <div key={i} style={S.previewItem}>
    <img
      src={img}
      style={S.previewImg}
      onClick={() => setEditIndex(i)}
    />
          <span
            onClick={() =>
              setImages(prev => prev.filter((_, index) => index !== i))
            }
            style={S.removeImg}
          >
            ✕
          </span>
        </div>
      ))}
    </div>
  )}

  {/* CHOOSE */}
  <div style={S.chooseRow}>
    <input
      type="file"
      multiple
      accept="image/*"
      onChange={(e) => {
        const files = Array.from(e.target.files);
        files.forEach(file => {
          const reader = new FileReader();
          reader.onload = () => {
            setImages(prev => [...prev, reader.result]);
          };
          reader.readAsDataURL(file);
        });
      }}
    />
  </div>

  {/* TEXTAREA + BUTTON */}
  <div style={S.inputMain}>
    <textarea
      ref={inputRef}
      value={text}
      onChange={e => setText(e.target.value)}
      onKeyDown={handleKey}
      placeholder="Nhập tin nhắn..."
      style={S.input}
    />

    <div style={S.inputBtns}>
      <button style={S.sendBtn} onClick={sendMessage}>➤</button>
      <button
        style={S.nlBtn}
        onClick={() => {
          const el = inputRef.current;
          if (!el) return;
          const start = el.selectionStart;
          const end = el.selectionEnd;

          const newText =
            text.substring(0, start) +
            "\n" +
            text.substring(end);

          setText(newText);

          setTimeout(() => {
            el.focus();
            el.selectionStart = el.selectionEnd = start + 1;
          }, 0);
        }}
      >
        ↵
      </button>
    </div>
  </div>

</div>

      {/* ===== IMAGE VIEWER ===== */}
{viewerIndex >= 0 && order.images?.[viewerIndex] && (
  <div style={S.viewerOverlay}>
    <div
      style={S.viewerBackdrop}
      onClick={() => setViewerIndex(-1)}
    />

    <div style={S.viewerBox}>
      <button
        style={S.viewerClose}
        onClick={() => setViewerIndex(-1)}
      >
        ✕
      </button>

      <img
        src={order.images[viewerIndex]}
        alt=""
        style={S.viewerImg}
      />

      {viewerIndex > 0 && (
        <button
          style={{ ...S.viewerNav, left: 20 }}
          onClick={() => setViewerIndex(viewerIndex - 1)}
        >
          ◀
        </button>
      )}

      {viewerIndex < order.images.length - 1 && (
        <button
          style={{ ...S.viewerNav, right: 20 }}
          onClick={() => setViewerIndex(viewerIndex + 1)}
        >
          ▶
        </button>
      )}
    </div>
  </div>
)}

{/* ===== EDITOR (SỬA ẢNH PREVIEW) ===== */}
{editIndex >= 0 && order.images?.[editIndex] && (
  <div style={S.viewerOverlay}>
    <div
      style={S.viewerBackdrop}
      onClick={() => setEditIndex(-1)}
    />

    <div style={S.viewerBox}>
      <button
        style={S.viewerClose}
        onClick={() => setEditIndex(-1)}
      >
        ✕
      </button>

     <ImageEditor
  src={order.images[editIndex]}
  onClose={() => setEditIndex(-1)}
  onSave={(newDataUrl) => {
    const next = [...order.images];
    next[editIndex] = newDataUrl;

    const updated = { ...order, images: next };
    updateOrderById(order.id, updated);
    setOrder(updated);

    setEditIndex(-1);
  }}
/>
    </div>
  </div>
)}
{/* ===== CHAT IMAGE VIEWER ===== */}
{chatViewer && (
  <div style={S.viewerOverlay}>
    <div
      style={S.viewerBackdrop}
      onClick={() => setChatViewer(null)}
    />

    <div style={S.viewerBox}>
      <button
        style={S.viewerClose}
        onClick={() => setChatViewer(null)}
      >
        ✕
      </button>

      <img
        src={chatViewer.imgs[chatViewer.i]}
        alt=""
        style={S.viewerImg}
      />

      {/* Nút lùi */}
      {chatViewer.i > 0 && (
        <button
          style={{ ...S.viewerNav, left: 20 }}
          onClick={() =>
            setChatViewer(v => ({ ...v, i: v.i - 1 }))
          }
        >
          ◀
        </button>
      )}

      {/* Nút tiến */}
      {chatViewer.i < chatViewer.imgs.length - 1 && (
        <button
          style={{ ...S.viewerNav, right: 20 }}
          onClick={() =>
            setChatViewer(v => ({ ...v, i: v.i + 1 }))
          }
        >
          ▶
        </button>
      )}
    </div>
  </div>
)}
    </div>
  );
}

/* ================= STYLE ================= */
const S = {
  page: {
    height: "100vh",
    background: "#121212",
    color: "#fff",
    },

  header: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    background: "#1a1a1a",
    padding: 12,
    borderBottom: "1px solid #333",
    zIndex: 100
  },

  title: {
    fontSize: 18,
    fontWeight: 700,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },

  sub: {
    fontSize: 12,
    opacity: 0.8,
    marginTop: 4
  },

  actionRow: {
  display: "flex",
  gap: 4,
  marginTop: 4,
  alignItems: "center",
  flexWrap: "nowrap",       // ❗ KHÔNG cho xuống dòng
  overflowX: "auto",        // nếu nhiều nút sẽ trượt ngang nhẹ
},

  body: {
  marginTop: 170,   // 120 header + ~50 backBar
  overflowY: "auto",
  overflowX: "hidden",
  padding: 14,
  paddingBottom: 120

},

  orderBox: {
    background: "#1e1e1e",
    borderRadius: 12,
    padding: 12
  },

  orderText: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word"
  },

  orderImages: {
    display: "flex",
    gap: 10,
    marginTop: 10,
    flexWrap: "wrap"
  },

  orderImg: {
    width: 120,
    height: 120,
    objectFit: "cover",
    borderRadius: 8,
    cursor: "pointer"
  },

  backBar: {
  position: "fixed",
  top: 90,          // đúng bằng header
  left: 0,
  right: 0,
  padding: 8,
  textAlign: "center",
  fontWeight: 700,
  background: "#121212",
  borderTop: "1px solid #333",
  borderBottom: "1px solid #333",
  cursor: "pointer",
  zIndex: 90
},

  bubble: {
    maxWidth: "80%",
    borderRadius: 12,
    padding: 10
  },

  msgHeader: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 12,
    marginBottom: 6
  },

  msgText: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word"
  },

  recall: {
    cursor: "pointer"
  },

  seen: {
    fontSize: 11,
    marginTop: 4,
    opacity: 0.7
  },

  inputBar: {
  position: "fixed",
  bottom: 0,
  left: 0,
  right: 0,
  background: "#1a1a1a",
  borderTop: "1px solid #333",
  padding: 10,
  zIndex: 200,
  display: "block"
},

  input: {
    flex: 1,
    background: "#2a2a2a",
    border: "none",
    color: "#fff",
    borderRadius: 8,
    padding: 8,
    resize: "none"
  },

  inputBtns: {
    display: "flex",
    flexDirection: "column",
    gap: 6
  },

  btn: {
  background: "#2c2c2c",
  color: "#e0e0e0",
  border: "1px solid #3a3a3a",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 12,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  whiteSpace: "nowrap",
  cursor: "pointer"
},

btnDanger: {
  background: "#b91c1c",
  color: "#fff",
  border: "1px solid #b91c1c",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 12,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  whiteSpace: "nowrap",
  cursor: "pointer"
},

btnActive: {
  background: "#166534",
  color: "#fff",
  border: "1px solid #166534",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 12,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  whiteSpace: "nowrap",
  cursor: "pointer"
},

  nlBtn: {
    background: "#444",
    border: "none",
    borderRadius: 8,
    padding: "6px 10px",
    cursor: "pointer",
    color: "#fff"
  },

  /* VIEWER */
  viewerOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 9999
  },

  viewerBackdrop: {
    position: "absolute",
    inset: 0,
    background: "rgba(0,0,0,0.95)"
  },

  viewerBox: {
    position: "relative",
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  },

  viewerImg: {
    maxWidth: "95%",
    maxHeight: "85%",
    objectFit: "contain"
  },

  viewerClose: {
    position: "absolute",
    top: 20,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: "50%",
    border: "none",
    background: "rgba(0,0,0,0.6)",
    color: "#fff",
    fontSize: 18,
    cursor: "pointer"
  },

  viewerNav: {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    background: "rgba(255,255,255,0.2)",
    border: "none",
    color: "#fff",
    fontSize: 22,
    padding: "8px 12px",
    borderRadius: 8,
    cursor: "pointer"
  },
previewRow: {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  marginBottom: 8
},

previewItem: {
  position: "relative"
},

previewImg: {
  width: 60,
  height: 60,
  objectFit: "cover",
  borderRadius: 6
},

removeImg: {
  position: "absolute",
  top: -6,
  right: -6,
  background: "red",
  color: "#fff",
  fontSize: 12,
  borderRadius: "50%",
  padding: "2px 6px",
  cursor: "pointer"
},

chooseRow: {
  marginBottom: 8
},

inputMain: {
  display: "flex",
  gap: 8
}
};