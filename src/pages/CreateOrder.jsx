import { supabase } from "../supabaseClient";
import ImageEditor from "../components/ImageEditor";
import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentUser } from "../utils/auth";
import { useLocation } from "react-router-dom";

// tạo id đơn giản
function uid(prefix) {
  return prefix + "_" + Date.now();
}

export default function CreateOrder() {
  const navigate = useNavigate();
const location = useLocation();
const editingOrder = location.state?.editing || null;
  const me = getCurrentUser();

  // quyền (tạm cho admin dùng hết)
  const canSystemTask = !me?.roles || me.roles?.includes("admin");
  const canSystemMessage = !me?.roles || me.roles?.includes("admin");

  const [text, setText] = useState("");
const [images, setImages] = useState([]);
const [editingIndex, setEditingIndex] = useState(null);
  const [mode, setMode] = useState("normal");
useEffect(() => {
  if (editingOrder) {
    setText(
      editingOrder.title
        ? editingOrder.title + "\n" + (editingOrder.text || "")
        : editingOrder.text || ""
    );

    setImages(editingOrder.images || []);
  }
}, [editingOrder]);
 // normal | system-task | system-message
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
  const parsed = useMemo(() => {
    const lines = (text || "").split("\n");
    const title = (lines[0] || "").trim();
    const body = lines.slice(1).join("\n").trim();
    return { title, body };
  }, [text]);

  async function submit() {
  console.log("TEXT:", text);
  console.log("IMAGES:", images);

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

    const { data: msgData } = await supabase
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
  const baseData = {
    title: parsed.title,
    text: parsed.body,
    images: images,
  };
const lines = text.split("\n");
const title = lines[0] || "";
const content = lines.slice(1).join("\n");

const type =
  mode === "normal"
    ? "normal"
    : mode === "system-task"
    ? "system_task"
    : "system_message";

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
  const { data: msgData, error: msgErr } = await supabase
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

  if (!msgErr && msgData) {
    await supabase.from("order_message_images").insert({
      message_id: msgData.id,
      image_url: publicUrl,
    });
  }
}

navigate("/");

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
            style={{ ...S.modeBtn, ...(mode === "system-task" ? S.modeActive : {}) }}
            onClick={() => setMode("system-task")}
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
        <button style={S.btnCancel} onClick={() => navigate("/")}>
          Huỷ
        </button>
        <button style={S.btnOk} onClick={submit}>
          Tạo đơn
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
