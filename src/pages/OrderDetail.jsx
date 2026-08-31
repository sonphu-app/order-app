import { notifyOrderChat } from "../utils/push";
import { supabase } from "../supabaseClient";
import { useParams, useNavigate } from "react-router-dom";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { getCurrentUser, getUsers, refreshCurrentUser } from "../utils/auth";
import OrderActions from "../components/OrderActions";
import {
  cacheImage,
  deleteLocal,
  getAllLocal,
  publishSyncEvent,
  putLocal,
  putManyLocal,
} from "../utils/localSync";
import { createImagePreviewBlob } from "../utils/imagePreview";

const ImageEditor = lazy(() => import("../components/ImageEditor"));

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
const [orderCollapsed, setOrderCollapsed] = useState(false);
const lastChatScrollRef = useRef(0);
const ignoreAutoResizeUntilRef = useRef(0);
const bodyRef = useRef(null);
const inputRef = useRef(null);
const realtimeReadyRef = useRef(false);
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
const viewerTouchRef = useRef(null);
// null | { imgs: string[], i: number }

const handleChatScroll = (e) => {
  const top = e.currentTarget.scrollTop;
  const previous = lastChatScrollRef.current;
  lastChatScrollRef.current = top;

  if (Date.now() < ignoreAutoResizeUntilRef.current) return;

  if (!orderCollapsed && top > 40 && top > previous) {
    ignoreAutoResizeUntilRef.current = Date.now() + 300;
    setOrderCollapsed(true);
  } else if (orderCollapsed && top <= 2 && top < previous) {
    ignoreAutoResizeUntilRef.current = Date.now() + 300;
    setOrderCollapsed(false);
  }
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
      images: localImages.map((item) => item.local_image_url || item.image_url),
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
      images: localImages.map((item) => item.local_image_url || item.image_url),
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
  const imageMap = new Map(localImages.map((row) => [String(row.id), row]));
  remoteImages.forEach((row) => imageMap.set(String(row.id), row));
  setOrder({
    ...(data || localOrder),
    images: [...imageMap.values()].map((row) => row.local_image_url || row.image_url),
  });

  void Promise.all(remoteImages.map(async (row) => ({
    ...row,
    local_image_url: await cacheImage(row.image_url),
  }))).then(async (cachedRows) => {
    await putManyLocal("orderImages", cachedRows);
    await loadOrder({ remote: false });
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
          const row = {
            ...payload.new,
            local_image_url: await cacheImage(payload.new.image_url),
          };
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
          const row = {
            ...payload.new,
            local_image_url: await cacheImage(payload.new.image_url),
          };
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
    loadChat();
  };
  const onFocus = () => refresh(true);
  const timer = window.setInterval(refresh, 12000);
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
      setViewerIndex(-1);
      setChatViewer(null);
    }
    if (viewerIndex >= 0 && event.key === "ArrowLeft") {
      setViewerIndex((current) => Math.max(0, current - 1));
    }
    if (viewerIndex >= 0 && event.key === "ArrowRight") {
      setViewerIndex((current) => Math.min((order?.images?.length || 1) - 1, current + 1));
    }
    if (chatViewer && event.key === "ArrowLeft") {
      setChatViewer((current) => current ? { ...current, i: Math.max(0, current.i - 1) } : current);
    }
    if (chatViewer && event.key === "ArrowRight") {
      setChatViewer((current) => current ? { ...current, i: Math.min(current.imgs.length - 1, current.i + 1) } : current);
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [viewerIndex, chatViewer, order?.images?.length]);

  /* ================= LOAD CHAT ================= */
const loadChat = async ({ remote = true } = {}) => {
  const localMessages = (await getAllLocal("orderMessages"))
    .filter((message) => String(message.order_id) === String(id));
  const localMessageImages = await getAllLocal("orderMessageImages");
  if (localMessages.length > 0) {
    setMessages(localMessages.map((message) => ({
      ...message,
      images: localMessageImages
        .filter((image) => String(image.message_id) === String(message.id))
        .map((image) => image.local_image_url || image.image_url),
    })).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
  }

  if (!remote) return;

  const { data: msgs, error: msgErr } = await supabase
    .from("order_messages")
    .select("*")
    .eq("order_id", id)
    .order("created_at", { ascending: true });

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

      void Promise.all(imgs.map(async (row) => ({
        ...row,
        local_image_url: await cacheImage(row.image_url),
      }))).then(async (cachedRows) => {
        await putManyLocal("orderMessageImages", cachedRows);
        await loadChat({ remote: false });
      });
    }
  }

  const messageMap = new Map(localMessages.map((message) => [String(message.id), message]));
  (msgs || []).forEach((message) => messageMap.set(String(message.id), message));
  const imageMap = new Map(localMessageImages.map((image) => [String(image.id), image]));
  imgs.forEach((image) => imageMap.set(String(image.id), image));
  const allImages = [...imageMap.values()];
  const merged = [...messageMap.values()].map((m) => ({
    ...m,
    images: allImages
      .filter((img) => String(img.message_id) === String(m.id))
      .map((img) => img.local_image_url || img.image_url),
  })).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

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
    inputRef.current?.focus({ preventScroll: true });
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
    await publishSyncEvent({ entityType: "order_message", entityId: msgData.id, payload: msgData });

    await Promise.all(outgoingImages.map(async (base64, i) => {
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
}));

void notifyOrderChat({
  order,
  text: outgoingText,
  imageCount: outgoingImages.length,
}).catch((error) => console.log("NOTIFY ORDER CHAT ERROR:", error));

    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  } finally {
    inputRef.current?.focus({ preventScroll: true });
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

  /* ================= RENDER ================= */
  return (
    <div style={S.page}>
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
  {(!order.type || order.type === "normal") && order.title}
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
        <div
          ref={orderTopRef}
          style={{ ...S.orderBox, ...(orderCollapsed ? S.orderBoxCollapsed : {}) }}
          onClick={() => {
            ignoreAutoResizeUntilRef.current = Date.now() + 300;
            setOrderCollapsed((value) => !value);
          }}
        >
          <div style={{ ...S.orderText, ...(orderCollapsed ? S.orderTextCollapsed : {}) }}>
  <div style={S.orderTitleInside}>
    {order.title}
  </div>

  {order.customer_name && (
    <div style={{ color: "#f1c75b", fontWeight: 800, marginTop: 5 }}>
      👤 {order.customer_name}
    </div>
  )}

  <div style={{ marginTop: 6, ...(orderCollapsed ? S.orderContentCollapsed : {}) }}>
  {order.content}
</div>
</div>

          {order.images?.length > 0 && (
  <div style={{ ...S.orderImages, ...(orderCollapsed ? S.orderImagesCollapsed : {}) }}>
    {order.images.map((img, i) => (
  <img
    key={i}
    src={img}
    style={{ ...S.orderImg, ...(orderCollapsed ? S.orderImgCollapsed : {}) }}
    onClick={(e) => {
      e.stopPropagation();
      setViewerIndex(i);
    }}
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
      onFocus={() => {
        ignoreAutoResizeUntilRef.current = Date.now() + 300;
        setOrderCollapsed(true);
      }}
      onKeyDown={handleKey}
      placeholder="Nhập tin nhắn..."
      style={S.input}
    />

    <div style={S.inputBtns}>
      <button type="button" style={S.sendBtn} onClick={sendMessage}>
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
        onTouchStart={(event) => {
          viewerTouchRef.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          const start = viewerTouchRef.current;
          const end = event.changedTouches[0]?.clientX;
          viewerTouchRef.current = null;
          if (start == null || end == null || Math.abs(end - start) < 45) return;
          setViewerIndex((current) => Math.max(
            0,
            Math.min(order.images.length - 1, current + (end < start ? 1 : -1))
          ));
        }}
      />
      <div style={S.viewerCounter}>{viewerIndex + 1}/{order.images.length} • Vuốt để xem</div>
      {order.images.length > 1 && (
        <>
          <button className="orderViewerArrow orderViewerArrowLeft" disabled={viewerIndex === 0}
            onClick={() => setViewerIndex((current) => Math.max(0, current - 1))}>‹</button>
          <button className="orderViewerArrow orderViewerArrowRight" disabled={viewerIndex === order.images.length - 1}
            onClick={() => setViewerIndex((current) => Math.min(order.images.length - 1, current + 1))}>›</button>
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
        onTouchStart={(event) => {
          viewerTouchRef.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          const start = viewerTouchRef.current;
          const end = event.changedTouches[0]?.clientX;
          viewerTouchRef.current = null;
          if (start == null || end == null || Math.abs(end - start) < 45) return;
          setChatViewer((current) => ({
            ...current,
            i: Math.max(0, Math.min(current.imgs.length - 1, current.i + (end < start ? 1 : -1))),
          }));
        }}
      />
      <div style={S.viewerCounter}>{chatViewer.i + 1}/{chatViewer.imgs.length} • Vuốt để xem</div>
      {chatViewer.imgs.length > 1 && (
        <>
          <button className="orderViewerArrow orderViewerArrowLeft" disabled={chatViewer.i === 0}
            onClick={() => setChatViewer((current) => ({ ...current, i: Math.max(0, current.i - 1) }))}>‹</button>
          <button className="orderViewerArrow orderViewerArrowRight" disabled={chatViewer.i === chatViewer.imgs.length - 1}
            onClick={() => setChatViewer((current) => ({ ...current, i: Math.min(current.imgs.length - 1, current.i + 1) }))}>›</button>
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
    background: "#121212",
    color: "#fff",
    overflow: "hidden",
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
  position: "fixed",
  top: 125,
  bottom: 0,
  left: 0,
  right: 0,
  marginTop: 0,
  overflowY: "auto",
  overflowX: "hidden",
  padding: 14,
  paddingBottom: 260,
  boxSizing: "border-box"
},

  orderBox: {
    background: "#1e1e1e",
    borderRadius: 12,
    padding: 12,
    scrollMarginTop: 170,
    position: "sticky",
    top: 0,
    zIndex: 30,
    boxShadow: "0 8px 18px rgba(0,0,0,.35)",
    cursor: "pointer",
    maxHeight: 900,
    overflow: "hidden",
    transition: "padding .18s ease"
  },

  orderBoxCollapsed: {
    padding: "8px 10px",
    maxHeight: 96,
    overflowY: "hidden",
    display: "flex",
    alignItems: "center",
    gap: 10
  },

  orderTextCollapsed: {
    flex: 1,
    minWidth: 0
  },

  orderContentCollapsed: {
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    fontSize: 12,
    lineHeight: 1.25,
    opacity: 0.82,
    transition: "font-size .18s ease, opacity .18s ease"
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

  orderImagesCollapsed: {
    marginTop: 0,
    flexWrap: "nowrap",
    maxWidth: "46%",
    overflow: "hidden",
    flexShrink: 0
  },

  orderImg: {
    width: 120,
    height: 120,
    objectFit: "cover",
    borderRadius: 8,
    cursor: "pointer",
    transition: "width .18s ease, height .18s ease"
  },

  orderImgCollapsed: {
    width: 56,
    height: 56,
    borderRadius: 7,
    flexShrink: 0
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
  background: "#2b2b2b",
  border: "1px solid #444",
  borderRadius: 10,
  textAlign: "center",
  fontSize: 13,
  cursor: "pointer",
},

inputMain: {
  display: "flex",
  gap: 8
}
};
