import { supabase } from "../supabaseClient";
import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { getCurrentUser, getUsers, refreshCurrentUser } from "../utils/auth";
import OrderActions from "../components/OrderActions";
import ImageEditor from "../components/ImageEditor";

export default function OrderDetail() {
const [users, setUsers] = useState([]);

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
const [sending, setSending] = useState(false);
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
useEffect(() => {
  const run = async () => {
    await refreshCurrentUser();
    const list = await getUsers();
    setUsers(list || []);
  };

  run();
}, []);

  /* ================= LOAD ORDER ================= */
const loadOrder = async () => {
  // 1. lấy order
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.log("LOAD ORDER ERROR:", error);
    return;
  }

  // 2. lấy ảnh của order
  const { data: orderImgs, error: imgErr } = await supabase
    .from("order_images")
    .select("*")
    .eq("order_id", id)
    .order("created_at", { ascending: true });

  if (imgErr) {
    console.log("LOAD ORDER IMAGES ERROR:", imgErr);
  }

  // 3. gộp lại
  setOrder({
    ...data,
    images: (orderImgs || []).map(x => x.image_url),
  });
};

useEffect(() => {
  loadOrder();
}, [id]);
useEffect(() => {
  const channel = supabase
    .channel(`order-detail-${id}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders", filter: `id=eq.${id}` },
      () => loadOrder()
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "order_messages", filter: `order_id=eq.${id}` },
      () => loadChat()
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "order_images", filter: `order_id=eq.${id}` },
      () => loadOrder()
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "order_message_images" },
      () => loadChat()
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [id]);

  /* ================= LOAD CHAT ================= */
const loadChat = async () => {
  const { data: msgs, error: msgErr } = await supabase
    .from("order_messages")
    .select("*")
    .eq("order_id", id)
    .order("created_at", { ascending: true });

  if (msgErr) {
    console.log("LOAD MSG ERROR:", msgErr);
    return;
  }

  const msgIds = (msgs || []).map((m) => m.id);

  let imgs = [];

  if (msgIds.length > 0) {
    const { data: imgRows, error: imgErr } = await supabase
      .from("order_message_images")
      .select("*")
      .in("message_id", msgIds);

    if (imgErr) {
      console.log("LOAD IMG ERROR:", imgErr);
      return;
    }

    imgs = imgRows || [];
  }

  const merged = (msgs || []).map((m) => ({
    ...m,
    images: imgs
      .filter((img) => img.message_id === m.id)
      .map((img) => img.image_url),
  }));

  setMessages(merged);
};

useEffect(() => {
  loadChat();
}, [id]);
  /* ================= SCROLL TO TOP WHEN OPEN ORDER ================= */
  useEffect(() => {
  orderTopRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
}, [id]);

  /* ================= MARK AS SEEN ================= */
  useEffect(() => {
  if (!me?.id || messages.length === 0) return;

  const markSeen = async () => {
    const needUpdate = messages.filter(
      (m) =>
        m.sender_id !== me.id &&
        !(m.seen_by || []).includes(me.id)
    );

    for (const m of needUpdate) {
      await supabase
        .from("order_messages")
        .update({
          seen_by: [...(m.seen_by || []), me.id],
        })
        .eq("id", m.id);
    }
  };

  markSeen();
}, [messages, me?.id]);

  if (!order) return null;

  /* ================= CHAT ================= */
  async function sendMessage() {
  if (sending) return;
  if (!text.trim() && images.length === 0) return;

  setSending(true);

  try {
    const { data: msgData, error: msgErr } = await supabase
      .from("order_messages")
      .insert({
        order_id: id,
        sender_id: me.id,
        sender_name: me.name || me.username || "Không rõ",
        text: text.trim(),
        seen_by: [me.id],
        is_system: false,
      })
      .select()
      .single();

    if (msgErr || !msgData) {
      console.log("SEND MSG ERROR:", msgErr);
      return;
    }

    for (let i = 0; i < images.length; i++) {
      const base64 = images[i];
      const blob = await (await fetch(base64)).blob();
      const fileName = `${msgData.id}_${Date.now()}_${i}.png`;

      const { error: uploadError } = await supabase.storage
        .from("order-images")
        .upload(fileName, blob);

      if (uploadError) {
        console.log("UPLOAD CHAT IMG ERROR:", uploadError);
        continue;
      }

      const { data: publicUrlData } = supabase.storage
        .from("order-images")
        .getPublicUrl(fileName);

      await supabase.from("order_message_images").insert({
        message_id: msgData.id,
        image_url: publicUrlData.publicUrl,
      });
    }

    setText("");
    setImages([]);

    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  } finally {
    setSending(false);
  }
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
  async function handleDelete() {
  if (!window.confirm("Xác nhận xoá đơn?")) return;

  const { error } = await supabase
    .from("orders")
    .delete()
    .eq("id", order.id);

  if (error) {
    console.log("DELETE ERROR:", error);
    return;
  }

  navigate("/");
}

  /* ================= RENDER ================= */
  return (
    <div style={S.page}>

      {/* ===== HEADER ===== */}
      <div style={S.header}>
        <div style={S.title}>
  {order.type === "system_task" && "🚨 NHIỆM VỤ HỆ THỐNG"}
{order.type === "system_message" && "📢 TIN NHẮN HỆ THỐNG"}
  {(!order.type || order.type === "normal") && order.title}
</div>

        Đã xong: {["done", "delivered", "completed"].includes(order.status) ? "✓" : "-"} |
Giao: {["delivered", "completed"].includes(order.status) ? "✓" : "-"} |
Hoàn thành: {order.status === "completed" ? "✓" : "-"}
<OrderActions
  order={order}
  onUpdated={(updated) => setOrder(updated)}
/>
{/* ===== BACK BAR ===== */}
        <div
  style={S.backBar}
  onClick={() =>
  orderTopRef.current?.scrollIntoView({
    behavior: "smooth",
    block: "start",
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
  {order.content}
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
            const isOwner = m.sender_id === me.id;
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
                    background: isOwner ? "#6fb7d6" : "#6b4f3a",
                    color: isOwner ? "#000" : "#fff"
                  }}
                >
                  <div style={S.msgHeader}>
                    <span>{m.sender_name}</span>
                    <span>{new Date(m.created_at).toLocaleString()}</span>
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
                    {m.seen_by?.length
  ? "Đã xem: " + m.seen_by.map(getName).join(", ")
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
      <button style={S.sendBtn} onClick={sendMessage} disabled={sending}>
  {sending ? "..." : "➤"}
</button>
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
{editIndex >= 0 && images?.[editIndex] && (
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
  src={images[editIndex]}
  onClose={() => setEditIndex(-1)}
  onSave={(newDataUrl) => {
  setImages(prev =>
    prev.map((img, idx) =>
      idx === editIndex ? newDataUrl : img
    )
  );
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