import { notifyNewOrder } from "../utils/push";
import { supabase } from "../supabaseClient";
import { lazy, Suspense, useRef } from "react";

const ImageEditor = lazy(() => import("../components/ImageEditor"));
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentUser } from "../utils/auth";
import { useLocation } from "react-router-dom";
import {
  deleteOrderDraft,
  getAllOrderDrafts,
  publishSyncEvent,
  putLocal,
  putOrderDraft,
} from "../utils/localSync";
import { getClipboardImageFiles } from "../utils/clipboardImages";

function getStoragePath(row) {
  if (row?.storage_path) return row.storage_path;
  const marker = "/storage/v1/object/public/order-images/";
  const url = String(row?.image_url || "");
  const index = url.indexOf(marker);
  return index < 0 ? null : decodeURIComponent(url.slice(index + marker.length).split("?")[0]);
}

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
  const [drafts, setDrafts] = useState([]);
  const draftIdRef = useRef(`draft-${crypto.randomUUID()}`);
  const draftStateRef = useRef({ customerName: "", text: "", mode: "normal", images: [] });
  const saveDraftRef = useRef(null);
  const submittingRef = useRef(false);
useEffect(() => {
  if (editingOrder) {
    setMode(editingOrder.type || "normal");

    setText(editingOrder.content || editingOrder.text || "");

    setImages(editingOrder.images || []);
    setCustomerName(editingOrder.customer_name || editingOrder.title || "");
  } else {
    setText("");
    setImages([]);
    setCustomerName("");
    setMode("normal");
  }
  requestAnimationFrame(() => textRef.current?.focus());
}, [editingOrder]);

useEffect(() => {
  draftStateRef.current = { customerName, text, mode, images };
}, [customerName, text, mode, images]);

useEffect(() => {
  submittingRef.current = submitting;
}, [submitting]);

useEffect(() => {
  if (editingOrder) return undefined;
  let active = true;
  getAllOrderDrafts()
    .then((rows) => {
      if (!active) return;
      setDrafts((rows || []).sort((a, b) => new Date(b.saved_at || 0) - new Date(a.saved_at || 0)));
    })
    .catch((error) => console.log("LOAD ORDER DRAFTS ERROR:", error));
  return () => { active = false; };
}, [editingOrder]);

saveDraftRef.current = async () => {
  if (editingOrder || submittingRef.current) return null;
  const snapshot = draftStateRef.current;
  if (!snapshot.customerName.trim() && !snapshot.text.trim() && snapshot.images.length === 0) return null;
  const row = {
    id: draftIdRef.current,
    customer_name: snapshot.customerName,
    content: snapshot.text,
    mode: snapshot.mode,
    images: snapshot.images,
    saved_at: new Date().toISOString(),
  };
  try {
    await putOrderDraft(row);
    return row;
  } catch (error) {
    console.log("SAVE ORDER DRAFT ERROR:", error);
    return null;
  }
};

useEffect(() => () => {
  void saveDraftRef.current?.();
}, [editingOrder]);

useEffect(() => {
  if (editingOrder) return undefined;
  const hasDraftContent = customerName.trim() || text.trim() || images.length > 0;
  if (!hasDraftContent) return undefined;

  const timer = window.setTimeout(async () => {
    const savedDraft = await saveDraftRef.current?.();
    if (!savedDraft) return;
    setDrafts((current) => [
      savedDraft,
      ...current.filter((item) => item.id !== savedDraft.id),
    ]);
  }, 700);

  return () => window.clearTimeout(timer);
}, [customerName, text, mode, images, editingOrder]);

async function saveDraftSnapshot() {
  return saveDraftRef.current?.();
}

async function handleCancel() {
  if (submitting) return;
  await saveDraftSnapshot();
  navigate("/");
}

function loadDraft(draft) {
  draftIdRef.current = draft.id;
  setCustomerName(draft.customer_name || "");
  setText(draft.content || "");
  setMode(draft.mode || "normal");
  setImages(Array.isArray(draft.images) ? draft.images : []);
  setEditingIndex(null);
}
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

const handlePasteImages = (event) => {
  const pastedImages = getClipboardImageFiles(event);
  if (pastedImages.length === 0) return;
  event.preventDefault();
  handleFiles(pastedImages);
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
  const { data: oldRows } = await supabase
    .from("order_images")
    .select("id, image_url")
    .eq("order_id", orderId);

  // xoá ảnh cũ trong bảng liên kết ảnh đơn
  await supabase
    .from("order_images")
    .delete()
    .eq("order_id", orderId);

  const oldStoragePaths = (oldRows || []).map(getStoragePath).filter(Boolean);
  if (oldStoragePaths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from("order-images")
      .remove(oldStoragePaths);
    if (storageError) console.log("REMOVE OLD ORDER IMAGES ERROR:", storageError);
  }

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

  async function submit() {
  console.log("TEXT:", text);
  console.log("IMAGES:", images);

  if (submitting) return;   // ✅ chống bấm nhiều
  submittingRef.current = true;
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
  const nextTitle = customerName.trim();
  const content = text.trim();
  const previousImageCount = (editingOrder.images || []).length;
  const now = new Date().toISOString();

  // 1️⃣ Update order (reset về new)
  const { error: updateError } = await supabase
  .from("orders")
  .update({
    title: nextTitle,
    content: content.trim(),
    customer_name: customerName.trim() || null,
    status: "new",
    needs_rework: false,
    has_image: images.length > 0,
    done_by_name: "",
    delivered_by_name: "",
    completed_by_name: "",
    updated_at: now,
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
  title: nextTitle,
  content: content.trim(),
  customer_name: customerName.trim() || null,
  status: "new",
  needs_rework: false,
  has_image: images.length > 0,
  done_by_name: "",
  delivered_by_name: "",
  completed_by_name: "",
  updated_at: now,
};
await putLocal("orders", updatedOrder);
await publishSyncEvent({ entityType: "order", entityId: editingOrder.id, payload: updatedOrder });
const beforeData = {
  title: editingOrder.title || "",
  content: editingOrder.content || editingOrder.text || "",
  image_count: (editingOrder.images || []).length,
  type: editingOrder.type || "normal",
  status: editingOrder.status || "new",
};

const afterData = {
  title: nextTitle,
  content: content.trim(),
  image_count: images.length,
  added_images: Math.max(0, images.length - previousImageCount),
  removed_images: Math.max(0, previousImageCount - images.length),
  customer_name: customerName.trim() || null,
  type: editingOrder.type || "normal",
  status: "new",
};

const { error: historyError } = await supabase.from("order_edit_history").insert({
  order_id: editingOrder.id,
  editor_id: me?.id || null,
  editor_name: me?.name || me?.username || "Không rõ",
  action: "edit",
  before_data: beforeData,
  after_data: afterData,
});
if (historyError) console.log("SAVE ORDER HISTORY ERROR:", historyError);

 await replaceOrderImages(editingOrder.id, images);

  navigate(`/order/${editingOrder.id}`, { replace: true });
  return;
}

  // Tiêu đề và nội dung là hai trường riêng.
const nextTitle = customerName.trim();
const content = text.trim();

const type = mode;

// 1) tạo order
const { data: orderData, error: orderError } = await supabase
  .from("orders")
  .insert({
  type,
  title: nextTitle,
  content: content.trim(),
  customer_name: customerName.trim() || null,
  status: "new",
  updated_at: new Date().toISOString(),
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
try {
  await deleteOrderDraft(draftIdRef.current);
} catch (error) {
  console.log("DELETE ORDER DRAFT ERROR:", error);
}
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
    title: nextTitle,
    content: content,
  });
})().catch((error) => console.log("CREATE ORDER BACKGROUND ERROR:", error));
return;
} finally {
  submittingRef.current = false;
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
    <div style={S.page} onPaste={handlePasteImages}>
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
  placeholder="Nhập nội dung đơn"
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
  onClick={handleCancel}
  disabled={submitting}
>
  Huỷ
</button>
        <button style={S.btnOk} onClick={submit} disabled={submitting}>
  {submitting ? "Đang tạo..." : (editingOrder ? "Lưu sửa" : "Tạo đơn")}
        </button>
      </div>

      {!editingOrder && (
        <section style={S.draftPanel} aria-label="Các bản nháp">
          <div style={S.draftHeading}>Bản tạm — chạm để mở lại</div>
          {drafts.length === 0 && (
            <div style={S.draftEmpty}>
              Chưa có bản tạm. Đơn đang nhập sẽ tự lưu tại đây.
            </div>
          )}
          {drafts.map((draft) => (
            <div key={draft.id} style={S.draftRow}>
              <button type="button" style={S.draftLoad} onClick={() => loadDraft(draft)}>
                <strong>{draft.customer_name || (draft.content || "").split(/\r?\n/)[0] || "Đơn chưa đặt tên"}</strong>
                <small>{new Date(draft.saved_at || 0).toLocaleString()}</small>
                <small style={S.draftOpenHint}>Mở lại bản tạm</small>
              </button>
              <button
                type="button"
                style={S.draftDelete}
                aria-label="Xoá bản tạm"
                onClick={async (event) => {
                  event.stopPropagation();
                  await deleteOrderDraft(draft.id);
                  setDrafts((current) => current.filter((item) => item.id !== draft.id));
                }}
              >
                ×
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

const S = {
  page: {
    minHeight: "100dvh",
    background: "#f5efe3",
    color: "#3d2b1b",
    padding: 20
  },
  header: {
    fontSize: 30,
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
    background: "#fffaf0",
    border: "1px solid #d5b477",
    color: "#4d3218",
    borderRadius: 10,
    cursor: "pointer"
  },
  modeActive: {
    background: "#d3a13f",
    color: "#3d260d",
    fontWeight: 700
  },
  textarea: {
    width: "100%",
    height: 200,
    padding: 12,
    borderRadius: 12,
    border: "1px solid #d1aa62",
    background: "#fffaf0",
    color: "#3d2b1b",
    fontSize: 18,
    lineHeight: 1.5,
    marginBottom: 20
  },
  customerInput: {
    width: "100%",
    padding: 12,
    borderRadius: 12,
    border: "1px solid #c8952e",
    background: "#fffaf0",
    color: "#3d2b1b",
    fontSize: 18,
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
    background: "#fffaf0",
    color: "#3d2b1b",
    border: "1px solid #d1aa62",
    fontSize: 16,
    textAlign: "center",
    cursor: "pointer",
  },
  actions: {
    display: "flex",
    gap: 10
  },
  draftPanel: {
    marginTop: 18,
    padding: 12,
    border: "1px solid #d8b36a",
    borderRadius: 12,
    background: "#fffaf0",
  },
  draftHeading: {
    color: "#6f430d",
    fontWeight: 700,
    marginBottom: 8,
  },
  draftEmpty: {
    padding: "10px 4px",
    color: "#745b3d",
    fontSize: 15,
  },
  draftRow: {
    display: "flex",
    alignItems: "stretch",
    gap: 6,
    marginTop: 6,
  },
  draftLoad: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 3,
    padding: "9px 10px",
    border: "1px solid #d8b36a",
    borderRadius: 9,
    background: "#fff7e6",
    color: "#3d2b1b",
    textAlign: "left",
    cursor: "pointer",
  },
  draftDelete: {
    width: 38,
    border: "1px solid #553333",
    borderRadius: 9,
    background: "#fff0f0",
    color: "#b42318",
    fontSize: 20,
    cursor: "pointer",
  },
  draftOpenHint: {
    color: "#8a560f",
    fontWeight: 700,
  },
  btnCancel: {
    flex: 1,
    padding: 14,
    background: "#eadfc9",
    color: "#3d2b1b",
    border: "1px solid #d1aa62",
    borderRadius: 12,
    cursor: "pointer",
    fontSize: 17,
    fontWeight: 700,
  },
  btnOk: {
    flex: 1,
    padding: 14,
    background: "#d3a13f",
    color: "#3d260d",
    border: "none",
    borderRadius: 12,
    fontWeight: 800,
    fontSize: 17,
    cursor: "pointer"
  }
};
