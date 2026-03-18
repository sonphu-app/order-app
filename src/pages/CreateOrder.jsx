import { supabase } from "../supabaseClient";
import ImageEditor from "../components/ImageEditor";
import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentUser } from "../utils/auth";
import { useLocation } from "react-router-dom";

// tạo id đơn giản

export default function CreateOrder() {
  const navigate = useNavigate();
const location = useLocation();
const editingOrder = location.state?.editing || null;
  const me = getCurrentUser();

  // quyền (tạm cho admin dùng hết)
  const canSystemTask = me?.role === "admin";
const canSystemMessage = me?.role === "admin";

const [submitting, setSubmitting] = useState(false); 
 const [text, setText] = useState("");
const [images, setImages] = useState([]);
const [editingIndex, setEditingIndex] = useState(null);
  const [mode, setMode] = useState("normal");
useEffect(() => {
  if (editingOrder) {
    setText(
      editingOrder.title
  ? editingOrder.title + "\n" + (editingOrder.content || editingOrder.text || "")
  : editingOrder.content || editingOrder.text || ""
    );

    setImages(editingOrder.images || []);
  }
}, [editingOrder]);
 // normal | system_task | system_message
const handleFiles = (e) => {
  const files = Array.from(e.target.files);

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImages(prev => [...prev, ev.target.result]);
    };
    reader.readAsDataURL(file);
  });
};

  // tách title / body từ text
  
  async function submit() {
  console.log("TEXT:", text);
  console.log("IMAGES:", images);

  if (submitting) return;   // ✅ chống bấm nhiều
  setSubmitting(true);      // ✅ bắt đầu xử lý
try {

  if (!text.trim()) {
    alert("Bạn chưa nhập nội dung");
    return;
  }
// =========================
// ✅ TRƯỜNG HỢP: ĐANG SỬA ĐƠN
// =========================
if (editingOrder) {
  const lines = text.split("\n");
  const title = lines[0] || "";
  const content = lines.slice(1).join("\n");

  // 1️⃣ Update order (reset về new)
  const { error: updateError } = await supabase
  .from("orders")
  .update({
    title: title.trim(),
    content: content.trim(),
    status: "new",
    has_image: images.length > 0,
    done_by_name: "",
    delivered_by_name: "",
    completed_by_name: "",
    required_users:
      editingOrder.type === "system_message"
        ? (await supabase.from("users").select("id")).data?.map(u => u.id) || []
        : [],
  })
  .eq("id", editingOrder.id);

  if (updateError) {
    console.log(updateError);
    alert("Lỗi sửa đơn");
    return;
  }

  // 2️⃣ XÓA toàn bộ message + ảnh cũ
  await supabase
    .from("order_messages")
    .delete()
    .eq("order_id", editingOrder.id);
let msgData = null;

if (images.length > 0) {
  const { data } = await supabase
    .from("order_messages")
    .insert({
      order_id: editingOrder.id,
      sender_id: me.id,
      sender_name: me.name,
      text: "",
      seen_by: [me.id],
      is_system: false,
    })
    .select()
    .single();

  msgData = data;
}

// 3️⃣ Upload ảnh mới (nếu có)
for (let i = 0; i < images.length; i++) {
  const base64 = images[i];
  const blob = await (await fetch(base64)).blob();
  const fileName = `${editingOrder.id}_${Date.now()}_${i}.png`;

  const { error: uploadError } = await supabase.storage
    .from("order-images")
    .upload(fileName, blob);

  if (uploadError) {
    console.log(uploadError);
    continue;
  }

  const { data: publicUrlData } = supabase.storage
    .from("order-images")
    .getPublicUrl(fileName);

  const publicUrl = publicUrlData.publicUrl;

  if (msgData) {
  await supabase.from("order_message_images").insert({
    message_id: msgData.id,
    image_url: publicUrl,
  });
}
}

  navigate(`/order/${editingOrder.id}`);
  return;
}

  // dữ liệu từ ô nhập
const lines = text.split("\n");
const title = lines[0] || "";
const content = lines.slice(1).join("\n");

const type = mode;

// 1) tạo order
const { data: orderData, error: orderError } = await supabase
  .from("orders")
  .insert({
  type,
  title: title.trim(),
  content: content.trim(),
  status: "new",
  pinned: type === "system_message",
  created_by: me?.id || null,
created_by_name: me?.name || me?.username || "Không rõ",
  has_image: images.length > 0,
  understood_by: [],
  required_users:
    type === "system_message"
      ? (await supabase.from("users").select("id")).data?.map(u => u.id) || []
      : [],
})
  .select()
  .single();

if (orderError) {
  console.error("ORDER ERROR:", orderError);
  alert(JSON.stringify(orderError));
  return;
}

const orderId = orderData.id;
let msgData = null;

if (images.length > 0) {
  const { data } = await supabase
    .from("order_messages")
    .insert({
      order_id: orderId,
      sender_id: me.id,
      sender_name: me.name,
      text: "",
      seen_by: [me.id],
      is_system: false,
    })
    .select()
    .single();

  msgData = data;
}

// 2) upload ảnh (nếu có)
for (let i = 0; i < images.length; i++) {
  const base64 = images[i];
  const blob = await (await fetch(base64)).blob();
  const fileName = `${orderId}_${Date.now()}_${i}.png`;

  const { error: uploadError } = await supabase.storage
    .from("order-images")
    .upload(fileName, blob);

  if (uploadError) {
    console.log(uploadError);
    continue;
  }

  const { data: publicUrlData } = supabase.storage
    .from("order-images")
    .getPublicUrl(fileName);

  const publicUrl = publicUrlData.publicUrl;

  // tạo 1 message để gắn ảnh

  if (msgData) {
    await supabase.from("order_message_images").insert({
      message_id: msgData.id,
      image_url: publicUrl,
    });
  }
}

navigate("/");
} finally {
  setSubmitting(false);
}

  // =========================
  // ✅ TRƯỜNG HỢP: ĐANG SỬA ĐƠN
  // =========================

  // =========================
  // ✅ TRƯỜNG HỢP: TẠO MỚI
  // =========================
}

  return (
    <div style={S.page}>
      <div style={S.header}>Tạo đơn</div>

      {/* chọn loại */}
      <div style={S.modeRow}>
        <button
          style={{ ...S.modeBtn, ...(mode === "normal" ? S.modeActive : {}) }}
          onClick={() => setMode("normal")}
        >
          Đơn thường
        </button>

        {canSystemTask && (
          <button
            style={{ ...S.modeBtn, ...(mode === "system_task" ? S.modeActive : {}) }}
            onClick={() => setMode("system_task")}
          >
            ⭐ Nhiệm vụ hệ thống
          </button>
        )}

        {canSystemMessage && (
          <button
            style={{ ...S.modeBtn, ...(mode === "system_message" ? S.modeActive : {}) }}
            onClick={() => setMode("system_message")}
          >
            📢 Tin nhắn hệ thống
          </button>
        )}
      </div>

      <textarea
  style={S.textarea}
  placeholder="Dòng đầu = tiêu đề, các dòng sau = nội dung"
  value={text}
  onChange={(e) => setText(e.target.value)}
/>

{/* ===== CHỌN ẢNH ===== */}
<div style={{marginTop:20}}>
  <input
    type="file"
    multiple
    accept="image/*"
    onChange={handleFiles}
  />
</div>
{/* ===== PREVIEW ẢNH ===== */}
<div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:10}}>
  {images.map((img, i) => (
    <div key={i} style={{position:"relative"}}>
      
      <img
  src={img}
  onClick={() => setEditingIndex(i)}
  style={{
    width:80,
    height:80,
    objectFit:"cover",
    borderRadius:8,
    cursor:"pointer"
  }}
/>
      {/* nút xoá */}
      <div
        onClick={() =>
          setImages(prev => prev.filter((_, index) => index !== i))
        }
        style={{
          position:"absolute",
          top:-6,
          right:-6,
          background:"red",
          color:"white",
          borderRadius:"50%",
          width:20,
          height:20,
          fontSize:12,
          display:"flex",
          alignItems:"center",
          justifyContent:"center",
          cursor:"pointer"
        }}
      >
        ✕
      </div>

    </div>
))} 
</div>

{/* ===== IMAGE EDITOR POPUP ===== */}
{editingIndex !== null && (
  <ImageEditor
    src={images[editingIndex]}
    onSave={(newImg) => {
      setImages(prev =>
        prev.map((img, idx) =>
          idx === editingIndex ? newImg : img
        )
      );
      setEditingIndex(null);
    }}
    onClose={() => setEditingIndex(null)}
  />
)}

<div style={S.actions}>
        <button
  style={S.btnCancel}
  onClick={() => !submitting && navigate("/")}
  disabled={submitting}
>
  Huỷ
</button>
        <button style={S.btnOk} onClick={submit} disabled={submitting}>
  {submitting ? "Đang tạo..." : (editingOrder ? "Lưu sửa" : "Tạo đơn")}
</button>
      </div>
    </div>
  );
}

const S = {
  page: {
    minHeight: "100dvh",
    background: "#121212",
    color: "#fff",
    padding: 20
  },
  header: {
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 20
  },
  modeRow: {
    display: "flex",
    gap: 10,
    marginBottom: 20
  },
  modeBtn: {
    padding: "10px 14px",
    background: "#2a2a2a",
    border: "none",
    color: "#fff",
    borderRadius: 10,
    cursor: "pointer"
  },
  modeActive: {
    background: "#2ecc71",
    color: "#111",
    fontWeight: 700
  },
  textarea: {
    width: "100%",
    height: 200,
    padding: 12,
    borderRadius: 12,
    border: "1px solid #333",
    background: "#1a1a1a",
    color: "#fff",
    marginBottom: 20
  },
  actions: {
    display: "flex",
    gap: 10
  },
  btnCancel: {
    flex: 1,
    padding: 14,
    background: "#333",
    color: "#fff",
    border: "none",
    borderRadius: 12,
    cursor: "pointer"
  },
  btnOk: {
    flex: 1,
    padding: 14,
    background: "#2ecc71",
    color: "#111",
    border: "none",
    borderRadius: 12,
    fontWeight: 700,
    cursor: "pointer"
  }
};
