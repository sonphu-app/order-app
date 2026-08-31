import { notifyNewOrder } from "../utils/push";
import { supabase } from "../supabaseClient";
import { lazy, Suspense, useRef } from "react";

const ImageEditor = lazy(() => import("../components/ImageEditor"));
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentUser } from "../utils/auth";
import { useLocation } from "react-router-dom";
import { publishSyncEvent, putLocal } from "../utils/localSync";

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
const [customerName, setCustomerName] = useState("");
const [images, setImages] = useState([]);
const [editingIndex, setEditingIndex] = useState(null);
const textRef = useRef(null);
  const [mode, setMode] = useState("normal");
useEffect(() => {
  if (editingOrder) {
    setMode(editingOrder.type || "normal");

    setText(
      editingOrder.title
        ? editingOrder.title + "\n" + (editingOrder.content || editingOrder.text || "")
        : editingOrder.content || editingOrder.text || ""
    );

    setImages(editingOrder.images || []);
    setCustomerName(editingOrder.customer_name || "");
  }
  requestAnimationFrame(() => textRef.current?.focus());
}, [editingOrder]);
 // normal | system_task | system_message
const handleFiles = (fileList, openEditor = false) => {
  const files = Array.from(fileList || []);
  const firstNewIndex = images.length;
  Promise.all(files.map((file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(ev.target.result);
    reader.readAsDataURL(file);
  }))).then((newImages) => {
    setImages((current) => [...current, ...newImages]);
    if (openEditor && newImages.length > 0) setEditingIndex(firstNewIndex);
  });
};
async function uploadOneImage(fileBase64, fileName) {
  const blob = await (await fetch(fileBase64)).blob();

  const { error: uploadError } = await supabase.storage
    .from("order-images")
    .upload(fileName, blob);

  if (uploadError) {
    console.log("UPLOAD ORDER IMAGE ERROR:", uploadError);
    return null;
  }

  const { data: publicUrlData } = supabase.storage
    .from("order-images")
    .getPublicUrl(fileName);

  return { url: publicUrlData.publicUrl, storagePath: fileName };
}

async function replaceOrderImages(orderId, imageList) {
  // xoá ảnh cũ trong bảng liên kết ảnh đơn
  await supabase
    .from("order_images")
    .delete()
    .eq("order_id", orderId);

  const uploadedImages = await Promise.all(imageList.map((image, i) =>
    uploadOneImage(image, `${orderId}_${Date.now()}_${i}.png`)
  ));
  const rows = uploadedImages.flatMap((uploaded) => uploaded ? [{
        order_id: orderId,
        image_url: uploaded.url,
        storage_path: uploaded.storagePath,
      }] : []);

  if (rows.length > 0) {
    const insertRows = rows.map((row) => ({
      order_id: row.order_id,
      image_url: row.image_url,
    }));
    const { data: savedRows } = await supabase.from("order_images").insert(insertRows).select();
    for (let i = 0; i < (savedRows || []).length; i++) {
      await publishSyncEvent({
        entityType: "order_image",
        entityId: savedRows[i].id,
        payload: savedRows[i],
        storagePaths: [rows[i].storage_path],
      });
    }
  }
}

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
    customer_name: customerName.trim() || null,
    status: "new",
    needs_rework: false,
    has_image: images.length > 0,
    done_by_name: "",
    delivered_by_name: "",
    completed_by_name: "",
    required_users:
      editingOrder.type === "system_message"
        ? (await supabase.from("users").select("id")).data?.map(u => u.id).filter((userId) => userId !== me?.id) || []
        : [],
  })
  .eq("id", editingOrder.id);

  if (updateError) {
    console.log(updateError);
    alert("Lỗi sửa đơn");
    return;
  }
const updatedOrder = {
  ...editingOrder,
  title: title.trim(),
  content: content.trim(),
  customer_name: customerName.trim() || null,
  status: "new",
  needs_rework: false,
  has_image: images.length > 0,
  done_by_name: "",
  delivered_by_name: "",
  completed_by_name: "",
  updated_at: new Date().toISOString(),
};
await putLocal("orders", updatedOrder);
await publishSyncEvent({ entityType: "order", entityId: editingOrder.id, payload: updatedOrder });
const beforeData = {
  title: editingOrder.title || "",
  content: editingOrder.content || editingOrder.text || "",
  type: editingOrder.type || "normal",
  status: editingOrder.status || "new",
};

const afterData = {
  title: title.trim(),
  content: content.trim(),
  customer_name: customerName.trim() || null,
  type: editingOrder.type || "normal",
  status: "new",
};

await supabase.from("order_edit_history").insert({
  order_id: editingOrder.id,
  editor_id: me?.id || null,
  editor_name: me?.name || me?.username || "Không rõ",
  action: "edit",
  before_data: beforeData,
  after_data: afterData,
});

 await replaceOrderImages(editingOrder.id, images);

  navigate(`/order/${editingOrder.id}`, { replace: true });
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
  customer_name: customerName.trim() || null,
  status: "new",
  needs_rework: false,
  pinned: type === "system_message",
  created_by: me?.id || null,
created_by_name: me?.name || me?.username || "Không rõ",
  has_image: images.length > 0,
  understood_by: me?.id ? [me.id] : [],
  required_users:
    type === "system_message"
      ? (await supabase.from("users").select("id")).data?.map(u => u.id).filter((userId) => userId !== me?.id) || []
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
await putLocal("orders", orderData);
navigate("/", {
  replace: true,
  state: { createdOrder: orderData, focusOrderId: orderId, statusTab: "new" },
});

// Đưa đơn lên màn hình ngay; đồng bộ liên máy, tải ảnh và push tiếp tục chạy nền.
void (async () => {
  await publishSyncEvent({ entityType: "order", entityId: orderId, payload: orderData });
  await replaceOrderImages(orderId, images);
  await notifyNewOrder({
    id: orderId,
    title: title.trim(),
    content: content.trim(),
  });
})().catch((error) => console.log("CREATE ORDER BACKGROUND ERROR:", error));
return;
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

      <input
        style={S.customerInput}
        placeholder="Tên khách hàng (không bắt buộc)"
        value={customerName}
        onChange={(e) => setCustomerName(e.target.value)}
      />

      <textarea
  ref={textRef}
  style={S.textarea}
  placeholder="Dòng đầu = tiêu đề, các dòng sau = nội dung"
  value={text}
  onChange={(e) => setText(e.target.value)}
/>

{/* ===== CHỌN ẢNH ===== */}
<div style={S.imageButtons}>
  <label style={S.imageButton}>📷 Camera
    <input hidden type="file" accept="image/*" capture="environment"
      onChange={(e) => { handleFiles(e.target.files, true); e.target.value = ""; }} />
  </label>
  <label style={S.imageButton}>🖼 Thêm ảnh
    <input hidden type="file" multiple accept="image/*"
      onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
  </label>
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
  <Suspense fallback={null}><ImageEditor
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
  /></Suspense>
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
  customerInput: {
    width: "100%",
    padding: 12,
    borderRadius: 12,
    border: "1px solid #d0a646",
    background: "#1a1a1a",
    color: "#fff",
    marginBottom: 10,
    boxSizing: "border-box",
  },
  imageButtons: {
    display: "flex",
    gap: 10,
    marginTop: 4,
  },
  imageButton: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    background: "#2a2a2a",
    border: "1px solid #444",
    textAlign: "center",
    cursor: "pointer",
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
