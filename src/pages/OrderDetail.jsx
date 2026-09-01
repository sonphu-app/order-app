import { supabase } from "../supabaseClient";
import { useParams, useNavigate } from "react-router-dom";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { getCurrentUser, getUsers, refreshCurrentUser } from "../utils/auth";
import OrderActions from "../components/OrderActions";
import {
  deleteLocal,
  getAllLocal,
  publishSyncEvent,
  putLocal,
  putManyLocal,
} from "../utils/localSync";
import { createImagePreviewBlob } from "../utils/imagePreview";
import { getClipboardImageFiles } from "../utils/clipboardImages";
import CachedImage from "../components/CachedImage";

const ImageEditor = lazy(() => import("../components/ImageEditor"));

function getLocalImageSource(row) {
  const local = String(row?.local_image_url || "");
  // Data URLs are created locally while uploading. Other local_image_url values
  // may be stale object URLs after a page reload, so use the durable public URL.
  return local.startsWith("data:") ? local : row?.image_url;
}

export default function OrderDetail() {
const [users, setUsers] = useState([]);

const getName = (id) => {
  const u = users.find(x => x.id === id);
  if (u) return u.name || u.username || "Nhân viên";
  if (id === me?.id) return me.name || me.username || "Bạn";
  return "Nhân viên";
};
  const { id } = useParams();
  const navigate = useNavigate();
  const me = getCurrentUser();

  const [order, setOrder] = useState(null);
const [orderShrinkProgress, setOrderShrinkProgress] = useState(0);
const bodyRef = useRef(null);
const inputRef = useRef(null);
const realtimeReadyRef = useRef(false);
const initialChatScrollRef = useRef(false);
const [images, setImages] = useState([]);

  // CHAT
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // IMAGE VIEWER (AN TOÀN)
  const [viewerIndex, setViewerIndex] = useState(-1); // -1 = đóng
  const [viewerImageSrc, setViewerImageSrc] = useState("");
  const [viewerZoom, setViewerZoom] = useState(1);
  const [chatViewerZoom, setChatViewerZoom] = useState(1);

  const orderTopRef = useRef(null);
  const bottomRef = useRef(null);
const [editIndex, setEditIndex] = useState(-1);
// VIEWER cho ảnh trong CHAT
const [chatViewer, setChatViewer] = useState(null); 
const [chatViewerImageSrc, setChatViewerImageSrc] = useState("");
const viewerTouchRef = useRef(null);
const imageViewerHistoryRef = useRef(null);
// null | { imgs: string[], i: number }

function closeImageViewer() {
  const wasOpen = imageViewerHistoryRef.current;
  imageViewerHistoryRef.current = null;
  setViewerIndex(-1);
  setChatViewer(null);
  setViewerImageSrc("");
  setChatViewerImageSrc("");
  setViewerZoom(1);
  setChatViewerZoom(1);
  if (wasOpen) window.history.back();
}

function openOrderViewer(index) {
  const source = order?.images?.[index];
  if (!source) return;
  if (!imageViewerHistoryRef.current) {
    window.history.pushState({ ...window.history.state, sonphuImageViewer: true }, "");
    imageViewerHistoryRef.current = "order";
  }
  setViewerIndex(index);
  setViewerImageSrc(source);
  setViewerZoom(1);
}

function openChatViewer(imageList, index) {
  const source = imageList?.[index];
  if (!source) return;
  if (!imageViewerHistoryRef.current) {
    window.history.pushState({ ...window.history.state, sonphuImageViewer: true }, "");
    imageViewerHistoryRef.current = "chat";
  }
  setChatViewer({ imgs: imageList, i: index });
  setChatViewerImageSrc(source);
  setChatViewerZoom(1);
}

const handleChatScroll = (e) => {
  const top = e.currentTarget.scrollTop;
  setOrderShrinkProgress(Math.min(1, Math.max(0, top / 180)));
};
useEffect(() => {
  const run = async () => {
    await refreshCurrentUser();
    const list = await getUsers();
    setUsers(list || []);
  };

  run();
}, []);

  /* ================= LOAD ORDER ================= */
const loadOrder = async ({ remote = true } = {}) => {
  const localOrders = await getAllLocal("orders");
  const localOrder = localOrders.find((item) => String(item.id) === String(id));
  const localImages = (await getAllLocal("orderImages"))
    .filter((item) => String(item.order_id) === String(id));
  if (localOrder) {
    setOrder({
      ...localOrder,
      images: localImages.map(getLocalImageSource),
    });
  }

  if (!remote) return;

  // 1. lấy order
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.log("LOAD ORDER ERROR:", error);
    if (!localOrder) return;
  }
  if (data) await putLocal("orders", data);
  if (data) {
    setOrder({
      ...data,
      images: localImages.map(getLocalImageSource),
    });
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
  const localImageById = new Map(localImages.map((row) => [String(row.id), row]));
  const remoteImages = (orderImgs || []).map((row) => ({
    ...row,
    local_image_url: localImageById.get(String(row.id))?.local_image_url,
  }));
  await putManyLocal("orderImages", remoteImages);
  // A successful remote response is authoritative, so removed images do not
  // remain visible from an older local cache. Keep local rows only on error.
  const mergedImageRows = imgErr ? localImages : remoteImages;
  setOrder({
    ...(data || localOrder),
    images: mergedImageRows.map(getLocalImageSource),
  });
};

const scrollToLatestOnce = () => {
  if (initialChatScrollRef.current) return;
  initialChatScrollRef.current = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!bodyRef.current) return;
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
      setOrderShrinkProgress(Math.min(1, Math.max(0, bodyRef.current.scrollTop / 180)));
    });
  });
};

/* ================= LOAD CHAT ================= */
async function loadChat({ remote = true, full = true } = {}) {
  const localMessages = (await getAllLocal("orderMessages"))
    .filter((message) => String(message.order_id) === String(id));
  const localMessageImages = await getAllLocal("orderMessageImages");
  if (localMessages.length > 0) {
    const cachedMessages = localMessages.map((message) => ({
      ...message,
      images: localMessageImages
        .filter((image) => String(image.message_id) === String(message.id))
        .map(getLocalImageSource),
    })).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    setMessages(cachedMessages);
    scrollToLatestOnce();
  }

  if (!remote) return;

  let messageQuery = supabase
    .from("order_messages")
    .select("*")
    .eq("order_id", id)
    .order("created_at", { ascending: true });
  const latestLocalMessageAt = localMessages.reduce((latest, message) => {
    const value = new Date(message.created_at || 0).getTime();
    return value > latest ? value : latest;
  }, 0);
  if (!full && latestLocalMessageAt > 0) {
    messageQuery = messageQuery.gt("created_at", new Date(latestLocalMessageAt).toISOString());
  }
  const { data: msgs, error: msgErr } = await messageQuery;

  if (msgErr) {
    console.log("LOAD MSG ERROR:", msgErr);
    if (localMessages.length === 0) return;
  }
  await putManyLocal("orderMessages", msgs || []);

  const msgIds = (msgs || []).map((m) => m.id);
  let imgs = [];

  if (msgIds.length > 0) {
    const { data: imgRows, error: imgErr } = await supabase
      .from("order_message_images")
      .select("*")
      .in("message_id", msgIds);

    if (imgErr) {
      console.log("LOAD IMG ERROR:", imgErr);
    } else {
      const cachedById = new Map(localMessageImages.map((row) => [String(row.id), row]));
      imgs = (imgRows || []).map((row) => ({
        ...row,
        local_image_url: cachedById.get(String(row.id))?.local_image_url,
      }));
      await putManyLocal("orderMessageImages", imgs);

    }
  }

  const messageMap = new Map((msgErr || !full ? localMessages : [])
    .map((message) => [String(message.id), message]));
  (msgs || []).forEach((message) => messageMap.set(String(message.id), message));
  const imageMap = new Map((msgErr || !full ? localMessageImages : [])
    .map((image) => [String(image.id), image]));
  imgs.forEach((image) => imageMap.set(String(image.id), image));
  const allImages = [...imageMap.values()];
  const merged = [...messageMap.values()].map((m) => ({
    ...m,
    images: allImages
      .filter((img) => String(img.message_id) === String(m.id))
      .map(getLocalImageSource),
  })).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  setMessages(merged);
  scrollToLatestOnce();
}

async function loadEditHistory() {
  setHistoryLoading(true);
  const localRows = (await getAllLocal("orderEditHistory"))
    .filter((row) => String(row.order_id) === String(id))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  if (localRows.length > 0) setHistoryRows(localRows);

  const { data, error } = await supabase
    .from("order_edit_history")
    .select("*")
    .eq("order_id", id)
    .order("created_at", { ascending: false });
  if (error) {
    console.log("LOAD ORDER HISTORY ERROR:", error);
    if (localRows.length === 0) setHistoryRows([]);
  } else {
    await putManyLocal("orderEditHistory", data || []);
    setHistoryRows(data || []);
  }
  setHistoryLoading(false);
}

function historyChangeText(row) {
  const before = row.before_data || {};
  const after = row.after_data || {};
  if (row.action === "status") {
    return `Trạng thái: ${before.status || "-"} → ${after.status || "-"}`;
  }
  const changes = [];
  if (before.title !== after.title) changes.push("tiêu đề");
  if (before.content !== after.content) changes.push("nội dung");
  if (before.image_count !== after.image_count) changes.push("ảnh");
  if (after.added_images) changes.push(`thêm ${after.added_images} ảnh`);
  if (after.removed_images) changes.push(`xóa ${after.removed_images} ảnh`);
  return changes.length > 0 ? `Đã cập nhật ${changes.join(", ")}` : "Đã cập nhật đơn";
}

useEffect(() => {
  const timer = window.setTimeout(() => loadOrder(), 0);
  return () => window.clearTimeout(timer);
}, [id]);
useEffect(() => {
  const channel = supabase
    .channel(`order-detail-${id}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders", filter: `id=eq.${id}` },
      (payload) => {
        if (payload.eventType === "DELETE") {
          deleteLocal("orders", payload.old.id);
          navigate("/", { replace: true });
          return;
        }
        putLocal("orders", payload.new);
        setOrder((current) => ({ ...current, ...payload.new }));
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "order_messages", filter: `order_id=eq.${id}` },
      (payload) => {
        if (payload.eventType === "DELETE") {
          deleteLocal("orderMessages", payload.old.id);
          setMessages((current) => current.filter((item) => item.id !== payload.old.id));
          return;
        }
        putLocal("orderMessages", payload.new);
        setMessages((current) => {
          const optimistic = current.find((item) =>
            String(item.id).startsWith("local-") &&
            item.sender_id === payload.new.sender_id &&
            item.text === payload.new.text
          );
          if (payload.eventType === "INSERT" && optimistic) return current;
          const existing = current.find((item) => item.id === payload.new.id);
          if (existing) {
            return current.map((item) => item.id === payload.new.id ? { ...item, ...payload.new } : item);
          }
          return [...current, { ...payload.new, images: [] }]
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        });
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "order_images", filter: `order_id=eq.${id}` },
      async (payload) => {
        if (payload.eventType === "DELETE") {
          await deleteLocal("orderImages", payload.old.id);
        } else {
          const row = { ...payload.new };
          await putLocal("orderImages", row);
        }
        loadOrder({ remote: false });
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "order_message_images" },
      async (payload) => {
        if (payload.eventType === "DELETE") await deleteLocal("orderMessageImages", payload.old.id);
        else {
          const row = { ...payload.new };
          await putLocal("orderMessageImages", row);
        }
        loadChat({ remote: false });
      }
    )
    .subscribe((status) => {
      realtimeReadyRef.current = status === "SUBSCRIBED";
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        console.log("ORDER REALTIME:", status);
      }
    });

  return () => {
    realtimeReadyRef.current = false;
    supabase.removeChannel(channel);
  };
}, [id]);
useEffect(() => {
  const refreshFromLocal = (event) => {
    const type = event.detail?.entity_type;
    if (type === "order" || type === "order_image") loadOrder({ remote: false });
    if (type === "order_message" || type === "order_message_image") loadChat({ remote: false });
  };
  window.addEventListener("sonphu-local-sync", refreshFromLocal);
  return () => window.removeEventListener("sonphu-local-sync", refreshFromLocal);
}, [id]);

useEffect(() => {
  const refresh = (force = false) => {
    if ((!force && realtimeReadyRef.current) || document.visibilityState !== "visible") return;
    loadOrder();
    loadChat({ full: force });
  };
  const onFocus = () => refresh(true);
  const timer = window.setInterval(refresh, 60000);
  window.addEventListener("focus", onFocus);
  return () => {
    clearInterval(timer);
    window.removeEventListener("focus", onFocus);
  };
}, [id]);

useEffect(() => {
  if (viewerIndex < 0 && !chatViewer) return undefined;
  const onKey = (event) => {
    if (event.key === "Escape") {
      closeImageViewer();
    }
    if (viewerIndex >= 0 && event.key === "ArrowLeft") {
      openOrderViewer(viewerIndex - 1);
    }
    if (viewerIndex >= 0 && event.key === "ArrowRight") {
      openOrderViewer(viewerIndex + 1);
    }
    if (chatViewer && event.key === "ArrowLeft") {
      openChatViewer(chatViewer.imgs, chatViewer.i - 1);
    }
    if (chatViewer && event.key === "ArrowRight") {
      openChatViewer(chatViewer.imgs, chatViewer.i + 1);
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [viewerIndex, chatViewer, order?.images?.length]);

useEffect(() => {
  const handleBrowserBack = () => {
    if (!imageViewerHistoryRef.current) return;
    imageViewerHistoryRef.current = null;
    setViewerIndex(-1);
    setChatViewer(null);
    setViewerImageSrc("");
    setChatViewerImageSrc("");
  };
  window.addEventListener("popstate", handleBrowserBack);
  return () => window.removeEventListener("popstate", handleBrowserBack);
}, []);

useEffect(() => {
  initialChatScrollRef.current = false;
  const timer = window.setTimeout(() => loadChat(), 0);
  return () => window.clearTimeout(timer);
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
  const orderDisplayTitle = order.customer_name || order.title || "";
  const shrink = orderShrinkProgress;
  const adaptiveOrderBoxStyle = {
    padding: `${12 - (4 * shrink)}px`,
    maxHeight: `${900 - (750 * shrink)}px`,
  };
  const adaptiveOrderTextStyle = {
    fontSize: `${22 - (5 * shrink)}px`,
    lineHeight: 1.62 - (0.17 * shrink),
  };
  const adaptiveOrderTitleStyle = {
    fontSize: `${23 - (4 * shrink)}px`,
  };
  const adaptiveOrderImageStyle = {
    width: `${120 - (64 * shrink)}px`,
    height: `${120 - (64 * shrink)}px`,
  };

  /* ================= CHAT ================= */
  async function sendMessage() {
  if (!text.trim() && images.length === 0) return;

  const outgoingText = text.trim();
  const outgoingImages = [...images];
  const optimisticId = `local-${crypto.randomUUID()}`;
  const optimisticMessage = {
    id: optimisticId,
    order_id: id,
    sender_id: me.id,
    sender_name: me.name || me.username || "Không rõ",
    text: outgoingText,
    seen_by: [me.id],
    is_system: false,
    created_at: new Date().toISOString(),
    images: outgoingImages,
  };

  setMessages((current) => [...current, optimisticMessage]);
  setText("");
  setImages([]);
  requestAnimationFrame(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  });

  try {
    const { data: msgData, error: msgErr } = await supabase
      .from("order_messages")
      .insert({
        order_id: id,
        sender_id: me.id,
        sender_name: me.name || me.username || "Không rõ",
        text: outgoingText,
        seen_by: [me.id],
        is_system: false,
      })
      .select()
      .single();

    if (msgErr || !msgData) {
      console.log("SEND MSG ERROR:", msgErr);
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      setText(outgoingText);
      setImages(outgoingImages);
      return;
    }
    setMessages((current) => current.map((message) => (
      message.id === optimisticId ? { ...msgData, images: outgoingImages } : message
    )));
    await putLocal("orderMessages", msgData);
    void publishSyncEvent({ entityType: "order_message", entityId: msgData.id, payload: msgData });

    void Promise.all(outgoingImages.map(async (base64, i) => {
  const blob = await (await fetch(base64)).blob();
  const fileName = `${msgData.id}_${Date.now()}_${i}.jpg`;
  const previewName = `${msgData.id}_${Date.now()}_${i}_preview.jpg`;
  const previewBlob = await createImagePreviewBlob(base64);

  const { error: previewUploadError } = await supabase.storage
    .from("order-images")
    .upload(previewName, previewBlob, {
      contentType: "image/jpeg",
      cacheControl: "31536000",
    });

  let savedImage = null;
  if (!previewUploadError) {
    const { data: previewUrlData } = supabase.storage
      .from("order-images")
      .getPublicUrl(previewName);
    const { data } = await supabase.from("order_message_images").insert({
      message_id: msgData.id,
      image_url: previewUrlData.publicUrl,
    }).select().single();
    savedImage = data;
    if (savedImage) {
      await publishSyncEvent({
        entityType: "order_message_image",
        entityId: savedImage.id,
        payload: savedImage,
        storagePaths: [previewName],
      });
    }
  }

  const { error: uploadError } = await supabase.storage
    .from("order-images")
    .upload(fileName, blob, {
      contentType: "image/jpeg",
      cacheControl: "31536000",
    });

  if (uploadError) {
    console.log("UPLOAD CHAT IMG ERROR:", uploadError);
    return;
  }

  const { data: publicUrlData } = supabase.storage
    .from("order-images")
    .getPublicUrl(fileName);

  const imageWrite = savedImage
    ? supabase.from("order_message_images").update({ image_url: publicUrlData.publicUrl }).eq("id", savedImage.id).select().single()
    : supabase.from("order_message_images").insert({ message_id: msgData.id, image_url: publicUrlData.publicUrl }).select().single();
  const { data: finalImage } = await imageWrite;
  if (finalImage) {
    await publishSyncEvent({
      entityType: "order_message_image",
      entityId: finalImage.id,
      payload: finalImage,
      storagePaths: [fileName],
    });
  }
})).catch((error) => console.log("UPLOAD ORDER CHAT IMAGES ERROR:", error));
  } catch (error) {
    console.log("SEND ORDER MESSAGE ERROR:", error);
  }
}

  function handleKey(e) {
    const isDesktop = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (isDesktop && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function recall(message) {
    if (!message?.id || message.sender_id !== me?.id) return;
    if (!window.confirm("Thu hồi tin nhắn và toàn bộ ảnh đã gửi?")) return;

    const marker = "/storage/v1/object/public/order-images/";
    const storagePaths = (message.images || [])
      .map((url) => {
        const path = String(url || "").split(marker)[1];
        return path ? decodeURIComponent(path.split("?")[0]) : null;
      })
      .filter(Boolean);

    if (storagePaths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from("order-images")
        .remove(storagePaths);
      if (storageError) console.log("RECALL STORAGE ERROR:", storageError);
    }

    const { error: imageError } = await supabase
      .from("order_message_images")
      .delete()
      .eq("message_id", message.id);

    if (imageError) {
      console.log("RECALL IMAGE ROWS ERROR:", imageError);
      return;
    }

    const { error: messageError } = await supabase
      .from("order_messages")
      .update({ text: "Tin nhắn đã thu hồi" })
      .eq("id", message.id);

    if (messageError) {
      console.log("RECALL MESSAGE ERROR:", messageError);
      return;
    }

    const recalledMessage = { ...message, text: "Tin nhắn đã thu hồi" };
    delete recalledMessage.images;
    await putLocal("orderMessages", recalledMessage);
    await publishSyncEvent({
      entityType: "order_message",
      entityId: message.id,
      payload: recalledMessage,
    });

    const localImageRows = (await getAllLocal("orderMessageImages"))
      .filter((row) => String(row.message_id) === String(message.id));
    for (const row of localImageRows) {
      await publishSyncEvent({
        entityType: "order_message_image",
        entityId: row.id,
        operation: "delete",
      });
    }

    await loadChat();
  }

  function addSelectedImages(fileList, openEditor = false) {
    const files = Array.from(fileList || []);
    const firstNewIndex = images.length;
    Promise.all(files.map((file) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    }))).then((newImages) => {
      setImages((current) => [...current, ...newImages]);
      if (openEditor && newImages.length > 0) setEditIndex(firstNewIndex);
    });
  }

  function handlePasteImages(event) {
    const pastedImages = getClipboardImageFiles(event);
    if (pastedImages.length === 0) return;
    event.preventDefault();
    addSelectedImages(pastedImages);
  }

  /* ================= RENDER ================= */
  return (
    <div style={S.page} onPaste={handlePasteImages}>
      <style>{`
        .orderViewerArrow {
          position: absolute; top: 50%; transform: translateY(-50%);
          width: 48px; height: 64px; border: 0; border-radius: 12px;
          background: rgba(0,0,0,.6); color: #fff; font-size: 42px; cursor: pointer;
        }
        .orderViewerArrow:disabled { opacity: .25; cursor: default; }
        .orderViewerArrowLeft { left: 18px; }
        .orderViewerArrowRight { right: 18px; }
        @media (hover: none), (pointer: coarse) { .orderViewerArrow { display: none; } }
      `}</style>

      {/* ===== HEADER ===== */}
      <div style={S.header}>
        <div style={S.title}>
{order.type === "system_task" && "🚨 NHIỆM VỤ HỆ THỐNG"}
{order.type === "system_message" && "📢 TIN NHẮN HỆ THỐNG"}
{(!order.type || order.type === "normal") && (
  <>
    {order.pinned && <span style={S.priorityInlineLabel}>⭐ ĐƠN ƯU TIÊN</span>}
    {order.needs_rework && <span style={S.reworkInlineLabel}>🔁 CẦN LÀM LẠI</span>}
    <span>📦 {orderDisplayTitle}</span>
  </>
)}
</div>

        Đã xong: {["done", "delivered", "completed"].includes(order.status) ? "✓" : "-"} |
Giao: {["delivered", "completed"].includes(order.status) ? "✓" : "-"} |
Hoàn thành: {order.status === "completed" ? "✓" : "-"}
<OrderActions
  order={order}
  onUpdated={(updated) => setOrder(updated)}
/>
        <div style={S.sub}>
          Tạo bởi: {order.created_by_name || "Không rõ"} • {new Date(order.created_at).toLocaleString()}
          {order.done_by_name && <> | Đã xong: {order.done_by_name} • {new Date(order.done_at || order.updated_at).toLocaleString()}</>}
          {order.delivered_by_name && <> | Đã giao: {order.delivered_by_name} • {new Date(order.delivered_at || order.updated_at).toLocaleString()}</>}
          {order.completed_by_name && <> | Hoàn thành: {order.completed_by_name} • {new Date(order.completed_at || order.updated_at).toLocaleString()}</>}
        </div>
      </div>

      {/* ===== BODY ===== */}
      <div
        style={S.body}
        ref={bodyRef}
        onScroll={handleChatScroll}
      >

        {/* ===== ORDER CONTENT ===== */}
        <div style={S.orderMessageRow}>
        <div
          ref={orderTopRef}
          style={{ ...S.orderBox, ...adaptiveOrderBoxStyle }}
        >
          <div style={{ ...S.orderText, ...adaptiveOrderTextStyle }}>
  <div style={{ ...S.orderTitleInside, ...adaptiveOrderTitleStyle }}>
    {(!order.type || order.type === "normal") && order.pinned && (
      <span style={S.priorityInlineLabel}>⭐ ĐƠN ƯU TIÊN</span>
    )}
    {(!order.type || order.type === "normal") && order.needs_rework && (
      <span style={S.reworkInlineLabel}>🔁 CẦN LÀM LẠI</span>
    )}
    <span>{(!order.type || order.type === "normal") && "📦 "}{orderDisplayTitle}</span>
  </div>

  <div style={{ marginTop: 6 }}>
  {order.content}
</div>
</div>

          {order.images?.length > 0 && (
  <div style={S.orderImages}>
    {order.images.map((img, i) => (
  <CachedImage
    key={`${i}-${img}`}
    src={img}
    alt=""
    style={{ ...S.orderImg, ...adaptiveOrderImageStyle }}
    onClick={(e) => {
      e.stopPropagation();
      openOrderViewer(i);
    }}
  />
))}
  </div>
)}
        </div>
        </div>
        <div style={S.historyBar}>
          <button
            type="button"
            style={S.historyButton}
            onClick={async () => {
              if (!historyOpen) await loadEditHistory();
              setHistoryOpen((current) => !current);
            }}
          >
            {historyOpen ? "Ẩn lịch sử" : "Xem lịch sử thay đổi"}
          </button>
        </div>

        {historyOpen && (
          <div style={S.historyPanel}>
            {historyLoading && <div style={S.historyEmpty}>Đang tải lịch sử...</div>}
            {!historyLoading && historyRows.length === 0 && (
              <div style={S.historyEmpty}>Chưa có lịch sử thay đổi.</div>
            )}
            {!historyLoading && historyRows.map((row) => (
              <div key={row.id} style={S.historyRow}>
                <div style={S.historyRowTop}>
                  <strong>{row.editor_name || "Không rõ"}</strong>
                  <span>{row.created_at ? new Date(row.created_at).toLocaleString() : ""}</span>
                </div>
                <div>{historyChangeText(row)}</div>
              </div>
            ))}
          </div>
        )}


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
                    background: isOwner ? "#f3dda9" : "#fffaf0",
                    color: "#3d2b1b"
                  }}
                >
                  <div style={S.msgHeader}>
                    <span>{m.sender_name}</span>
                    <span>{new Date(m.created_at).toLocaleString()}</span>
                    {isOwner && m.text !== "Tin nhắn đã thu hồi" && (
                      <span style={S.recall} onClick={() => recall(m)}>
                        Thu hồi
                      </span>
                    )}
                  </div>

                  <div style={S.msgText}>
  {m.recalled ? "Tin nhắn đã thu hồi" : m.text}
</div>

{!m.recalled && m.text !== "Tin nhắn đã thu hồi" && m.images?.length > 0 && (
  <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
    {m.images.map((img, i) => (
      <CachedImage
  key={`${i}-${img}`}
  src={img}
  alt=""
  style={{
    width: 120,
    height: 120,
    objectFit: "cover",
    borderRadius: 12,
    cursor: "pointer"
  }}
  onClick={() => openChatViewer(m.images, i)}
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
    <CachedImage
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

  {/* CAMERA / THÊM ẢNH */}
  <div style={S.chooseRow}>
    <label style={S.attachBtn}>📷 Camera
      <input hidden type="file" accept="image/*" capture="environment"
        onChange={(e) => { addSelectedImages(e.target.files, true); e.target.value = ""; }} />
    </label>
    <label style={S.attachBtn}>🖼 Thêm ảnh
      <input hidden type="file" multiple accept="image/*"
        onChange={(e) => { addSelectedImages(e.target.files); e.target.value = ""; }} />
    </label>
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
      <button
        type="button"
        style={S.sendBtn}
        onPointerDown={(event) => event.preventDefault()}
        onClick={sendMessage}
      >
  ➤
</button>
    </div>
  </div>

</div>

      {/* ===== IMAGE VIEWER ===== */}
{viewerIndex >= 0 && order.images?.[viewerIndex] && (
  <div style={S.viewerOverlay}>
    <div
      style={S.viewerBackdrop}
      onClick={closeImageViewer}
    />

    <div style={S.viewerBox}>
      <button
        style={S.viewerClose}
        onClick={closeImageViewer}
      >
        ✕
      </button>

      <CachedImage
        src={viewerImageSrc || order.images[viewerIndex]}
        alt=""
        style={{ ...S.viewerImg, transform: `scale(${viewerZoom})` }}
        onWheel={(event) => {
          event.preventDefault();
          setViewerZoom((current) => Math.min(4, Math.max(1, current + (event.deltaY < 0 ? 0.2 : -0.2))));
        }}
        onTouchStart={(event) => {
          viewerTouchRef.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          const start = viewerTouchRef.current;
          const end = event.changedTouches[0]?.clientX;
          viewerTouchRef.current = null;
          if (start == null || end == null || Math.abs(end - start) < 45) return;
          const nextIndex = Math.max(0, Math.min(order.images.length - 1, viewerIndex + (end < start ? 1 : -1)));
          openOrderViewer(nextIndex);
        }}
      />
      <div style={S.viewerCounter}>{viewerIndex + 1}/{order.images.length} • Vuốt để xem</div>
      {order.images.length > 1 && (
        <>
          <button className="orderViewerArrow orderViewerArrowLeft" disabled={viewerIndex === 0}
            onClick={() => openOrderViewer(viewerIndex - 1)}>‹</button>
          <button className="orderViewerArrow orderViewerArrowRight" disabled={viewerIndex === order.images.length - 1}
            onClick={() => openOrderViewer(viewerIndex + 1)}>›</button>
        </>
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

     <Suspense fallback={null}><ImageEditor
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
     /></Suspense>
    </div>
  </div>
)}
{/* ===== CHAT IMAGE VIEWER ===== */}
{chatViewer && (
  <div style={S.viewerOverlay}>
    <div
      style={S.viewerBackdrop}
      onClick={closeImageViewer}
    />

    <div style={S.viewerBox}>
      <button
        style={S.viewerClose}
        onClick={closeImageViewer}
      >
        ✕
      </button>

      <CachedImage
        src={chatViewerImageSrc || chatViewer.imgs[chatViewer.i]}
        alt=""
        style={{ ...S.viewerImg, transform: `scale(${chatViewerZoom})` }}
        onWheel={(event) => {
          event.preventDefault();
          setChatViewerZoom((current) => Math.min(4, Math.max(1, current + (event.deltaY < 0 ? 0.2 : -0.2))));
        }}
        onTouchStart={(event) => {
          viewerTouchRef.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          const start = viewerTouchRef.current;
          const end = event.changedTouches[0]?.clientX;
          viewerTouchRef.current = null;
          if (start == null || end == null || Math.abs(end - start) < 45) return;
          const nextIndex = Math.max(0, Math.min(chatViewer.imgs.length - 1, chatViewer.i + (end < start ? 1 : -1)));
          openChatViewer(chatViewer.imgs, nextIndex);
        }}
      />
      <div style={S.viewerCounter}>{chatViewer.i + 1}/{chatViewer.imgs.length} • Vuốt để xem</div>
      {chatViewer.imgs.length > 1 && (
        <>
          <button className="orderViewerArrow orderViewerArrowLeft" disabled={chatViewer.i === 0}
            onClick={() => openChatViewer(chatViewer.imgs, chatViewer.i - 1)}>‹</button>
          <button className="orderViewerArrow orderViewerArrowRight" disabled={chatViewer.i === chatViewer.imgs.length - 1}
            onClick={() => openChatViewer(chatViewer.imgs, chatViewer.i + 1)}>›</button>
        </>
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
    background: "#f5efe3",
    color: "#3d2b1b",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    },

  header: {
    position: "relative",
    top: 0,
    width: "100%",
    boxSizing: "border-box",
    background: "#fff7e6",
    padding: 12,
    borderBottom: "1px solid #d8b36a",
    boxShadow: "0 3px 12px rgba(91,55,22,.12)",
    zIndex: 100
  },

  title: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    fontSize: 21,
    fontWeight: 800,
    color: "#6f430d",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },

  sub: {
    fontSize: 15,
    color: "#745b3d",
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
    position: "relative",
    flex: 1,
    minHeight: 0,
    width: "100%",
    overflowY: "auto",
    overflowX: "hidden",
    padding: 14,
    paddingBottom: 260,
    boxSizing: "border-box"
},

  orderBox: {
    maxWidth: "min(84%, 560px)",
    boxSizing: "border-box",
    background: "#fffaf0",
    border: "1px solid #dec38d",
    borderRadius: 16,
    padding: "11px 14px",
    scrollMarginTop: 20,
    boxShadow: "0 2px 8px rgba(91,55,22,.1)",
    maxHeight: 900,
    overflow: "hidden",
    transition: "padding .12s ease, max-height .12s ease"
  },

  orderMessageRow: {
    display: "flex",
    justifyContent: "flex-start",
    marginBottom: 12,
  },

  orderText: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontSize: 22,
    lineHeight: 1.62,
  },

  orderTitleInside: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    color: "#6f430d",
    fontSize: 23,
    lineHeight: 1.2,
    fontWeight: 800,
    marginBottom: 6,
    whiteSpace: "nowrap",
    overflow: "hidden",
  },

  priorityInlineLabel: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    padding: "3px 7px",
    borderRadius: 20,
    background: "#ffd166",
    color: "#171717",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  reworkInlineLabel: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    padding: "3px 7px",
    borderRadius: 20,
    background: "#ffd166",
    color: "#171717",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
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
    borderRadius: 12,
    cursor: "pointer",
    transition: "width .18s ease, height .18s ease"
  },

  historyBar: {
    display: "flex",
    justifyContent: "flex-end",
    marginTop: 8,
  },

  historyButton: {
    padding: "6px 10px",
    border: "1px solid #d1aa62",
    borderRadius: 12,
    background: "#fffaf0",
    color: "#5f4a32",
    fontSize: 15,
    cursor: "pointer",
  },

  historyPanel: {
    marginTop: 6,
    padding: 8,
    border: "1px solid #d8b36a",
    borderRadius: 10,
    background: "#fffaf0",
    maxHeight: 220,
    overflowY: "auto",
  },

  historyEmpty: {
    color: "#745b3d",
    fontSize: 15,
    padding: 6,
    textAlign: "center",
  },

  historyRow: {
    padding: "8px 4px",
    borderBottom: "1px solid #d8dee5",
    color: "#4d3218",
    fontSize: 15,
  },

  historyRowTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    color: "#6f430d",
    marginBottom: 3,
  },

  bubble: {
    maxWidth: "80%",
    borderRadius: 12,
    padding: 12,
    border: "1px solid #d4dbe3",
  },

  msgHeader: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 14,
    marginBottom: 6
  },

  msgText: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontSize: 18,
    lineHeight: 1.5,
  },

  recall: {
    cursor: "pointer"
  },

  seen: {
    fontSize: 13,
    marginTop: 4,
    opacity: 0.7
  },

  inputBar: {
  position: "fixed",
  bottom: 0,
  left: 0,
  right: 0,
    background: "#fff7e6",
    borderTop: "1px solid #d8b36a",
    boxShadow: "0 -4px 16px rgba(91,55,22,.12)",
  padding: 10,
  zIndex: 200,
  display: "block"
},

  input: {
    flex: 1,
    background: "#fffaf0",
    border: "1px solid #d1aa62",
    color: "#3d2b1b",
    borderRadius: 8,
    padding: 8,
    resize: "none",
    fontSize: 17,
    lineHeight: 1.45,
  },

  inputBtns: {
    display: "flex",
    flexDirection: "column",
    gap: 6
  },

  sendBtn: {
    width: 44,
    height: 44,
    border: "none",
    borderRadius: "50%",
    background: "#b98224",
    color: "#fffaf0",
    fontSize: 20,
    cursor: "pointer",
  },

  btn: {
  background: "#fff3d6",
  color: "#4d3218",
  border: "1px solid #d1aa62",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 14,
  height: 34,
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
  fontSize: 14,
  height: 34,
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
  fontSize: 14,
  height: 34,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  whiteSpace: "nowrap",
  cursor: "pointer"
},

  nlBtn: {
    background: "#eadfc9",
    border: "none",
    borderRadius: 8,
    padding: "6px 10px",
    cursor: "pointer",
    color: "#3d2b1b"
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

  viewerCounter: {
    position: "absolute",
    bottom: 24,
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(0,0,0,0.65)",
    color: "#fff",
    fontSize: 13,
    padding: "7px 10px",
    borderRadius: 999,
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
  marginBottom: 8,
  display: "flex",
  gap: 8,
},

attachBtn: {
  flex: 1,
  padding: "9px 10px",
  background: "#fff3d6",
  color: "#4d3218",
  border: "1px solid #d1aa62",
  borderRadius: 10,
  textAlign: "center",
  fontSize: 15,
  cursor: "pointer",
},

inputMain: {
  display: "flex",
  gap: 8
}
};
