// CHỈ DÁN - KHÔNG SỬA LINH TINH
import React, { lazy, Suspense, useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import "../styles/chat.css";
import { getCurrentUser, getUsers, refreshCurrentUser } from "../utils/auth";
import { cacheImage, deleteLocal, getAllLocal, publishSyncEvent, putLocal, putManyLocal } from "../utils/localSync";
import { createImagePreviewBlob } from "../utils/imagePreview";
import { useNavigate } from "react-router-dom";

const ImageEditor = lazy(() => import("../components/ImageEditor"));

function format(ts) {
  return ts ? new Date(ts).toLocaleString() : "";
}

function getImageThumbnail(url) {
  const source = String(url || "");
  const marker = "/storage/v1/object/public/";
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return source;
  const baseUrl = source.slice(0, markerIndex);
  const storagePath = source.slice(markerIndex + marker.length).split("?")[0];
  return `${baseUrl}/storage/v1/render/image/public/${storagePath}?width=360&height=360&resize=contain&quality=75`;
}

function getLocalImageSource(row) {
  const local = String(row?.local_image_url || "");
  return local.startsWith("data:") ? local : row?.image_url;
}

function DeferredCachedImage({ src, ...props }) {
  const localSource = /^(blob:|data:)/i.test(String(src || ""));
  const [resolvedSrc, setResolvedSrc] = useState(localSource ? src : "");
  const imageRef = useRef(null);

  useEffect(() => {
    if (!src || localSource) return undefined;
    let active = true;
    let observer;
    const reveal = () => {
      void cacheImage(src).then((cachedSrc) => {
        if (active) setResolvedSrc(cachedSrc || src);
      });
      observer?.disconnect();
    };

    if (typeof IntersectionObserver === "undefined") reveal();
    else {
      observer = new IntersectionObserver((entries) => {
        if (entries[0]?.isIntersecting) reveal();
      }, { rootMargin: "240px" });
      if (imageRef.current) observer.observe(imageRef.current);
    }
    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [src, localSource]);

  return <img ref={imageRef} src={resolvedSrc || undefined} loading="lazy" decoding="async" {...props} />;
}

export default function Chat() {
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [editingIndex, setEditingIndex] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [viewerImageSrc, setViewerImageSrc] = useState("");
  const [groupUnreadCount, setGroupUnreadCount] = useState(0);

  const inputRef = useRef(null);
  const bottomRef = useRef(null);
  const msgListRef = useRef(null);
  const reloadTimerRef = useRef(null);
  const viewerTouchRef = useRef(null);
  const imageViewerHistoryRef = useRef(false);
  const realtimeReadyRef = useRef(false);
  const navigate = useNavigate();

  const me = getCurrentUser();

  const showViewerImage = useCallback((images, index) => {
    const source = images?.[index];
    if (!source) {
      setViewerImageSrc("");
      return;
    }
    setViewerImageSrc(source);
    if (/^(blob:|data:)/i.test(source)) return;
    void cacheImage(source).then((cachedSource) => setViewerImageSrc(cachedSource || source));
  }, []);

  const openViewer = useCallback((images, index) => {
    if (!images?.[index]) return;
    if (!imageViewerHistoryRef.current) {
      window.history.pushState({ ...window.history.state, sonphuImageViewer: true }, "");
      imageViewerHistoryRef.current = true;
    }
    showViewerImage(images, index);
    setViewer({ images, index });
  }, [showViewerImage]);

  const closeViewer = useCallback(() => {
    const wasOpen = imageViewerHistoryRef.current;
    imageViewerHistoryRef.current = false;
    setViewer(null);
    setViewerImageSrc("");
    if (wasOpen) window.history.back();
  }, []);

  const moveViewer = useCallback((delta) => {
    if (!viewer) return;
    const nextIndex = Math.max(0, Math.min(viewer.images.length - 1, viewer.index + delta));
    showViewerImage(viewer.images, nextIndex);
    setViewer({ ...viewer, index: nextIndex });
  }, [showViewerImage, viewer]);

  const getName = (id) => {
    const u = users.find((x) => x.id === id);
    return u ? u.name : id;
  };

  const scrollToBottom = useCallback((smooth = false) => {
    requestAnimationFrame(() => {
      if (bottomRef.current) {
        bottomRef.current.scrollIntoView({
          behavior: smooth ? "smooth" : "auto",
          block: "end"
        });
      }

      if (msgListRef.current) {
        msgListRef.current.scrollTop = msgListRef.current.scrollHeight;
      }
    });
  }, []);

  // ===== LOAD USERS =====
  const loadUsersAsync = useCallback(async () => {
    const data = await getUsers();
    setUsers(data || []);
  }, []);

  // ===== LOAD CHAT =====
  const loadChat = useCallback(async ({ remote = true, full = true } = {}) => {
    const localMessages = await getAllLocal("groupMessages");
    const localImages = await getAllLocal("groupMessageImages");
    if (localMessages.length > 0) {
      setMessages(localMessages.map((message) => ({
        ...message,
        images: localImages
          .filter((image) => String(image.message_id) === String(message.id))
          .map(getLocalImageSource),
      })).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
    }

    if (!remote) return;

    let messageQuery = supabase
      .from("group_messages")
      .select("*")
      .order("created_at", { ascending: true });
    const latestLocalMessageAt = localMessages.reduce((latest, message) => {
      const value = new Date(message.created_at || 0).getTime();
      return value > latest ? value : latest;
    }, 0);
    if (!full && latestLocalMessageAt > 0) {
      messageQuery = messageQuery.gt("created_at", new Date(latestLocalMessageAt).toISOString());
    }
    const { data } = await messageQuery;

    const safeData = data || [];
    await putManyLocal("groupMessages", safeData);
    const ids = safeData.map((m) => m.id);

    let imgs = [];
    if (ids.length > 0) {
      const { data: imgData } = await supabase
        .from("group_message_images")
        .select("*")
        .in("message_id", ids);
      const cachedById = new Map(localImages.map((row) => [String(row.id), row]));
      imgs = (imgData || []).map((row) => ({
        ...row,
        local_image_url: cachedById.get(String(row.id))?.local_image_url,
      }));
      await putManyLocal("groupMessageImages", imgs);

    }

    const messageMap = new Map((!full ? localMessages : []).map((message) => [String(message.id), message]));
    safeData.forEach((message) => messageMap.set(String(message.id), message));
    const imageMap = new Map((!full ? localImages : []).map((image) => [String(image.id), image]));
    imgs.forEach((image) => imageMap.set(String(image.id), image));
    const allImages = [...imageMap.values()];
    const merged = [...messageMap.values()].map((m) => ({
      ...m,
      images: allImages
        .filter((i) => String(i.message_id) === String(m.id))
        .map(getLocalImageSource)
    })).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    setMessages(merged);
  }, []);

  // ===== LOAD UNREAD =====
  const loadUnread = useCallback(async () => {
    const me = getCurrentUser();
    if (!me) return;

    const { data } = await supabase
      .from("group_messages")
      .select("sender_id, seen_by");

    const safeData = data || [];

    const count = safeData.filter((m) => {
      return m.sender_id !== me.id && !(m.seen_by || []).includes(me.id);
    }).length;

    setGroupUnreadCount(count);
  }, []);

  // ===== INIT =====
  useEffect(() => {
    (async () => {
      await refreshCurrentUser();
      await loadUsersAsync();
      await loadChat();
      await loadUnread();

      setTimeout(() => {
        scrollToBottom(false);
      }, 100);
    })();
  }, [loadUsersAsync, loadChat, loadUnread, scrollToBottom]);

  // ===== REALTIME =====
  useEffect(() => {
    const refreshImagesFromLocal = () => {
      clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => loadChat({ remote: false }), 40);
    };
    const channel = supabase
      .channel("group-chat")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_messages" },
        async (payload) => {
          if (payload.eventType === "DELETE") {
            await deleteLocal("groupMessages", payload.old.id);
            setMessages((current) => current.filter((message) => message.id !== payload.old.id));
          } else {
            await putLocal("groupMessages", payload.new);
            setMessages((current) => {
              const optimistic = current.find((message) =>
                String(message.id).startsWith("local-") &&
                message.sender_id === payload.new.sender_id &&
                message.text === payload.new.text
              );
              if (payload.eventType === "INSERT" && optimistic) return current;
              const existing = current.find((message) => String(message.id) === String(payload.new.id));
              if (!existing) return [...current, { ...payload.new, images: [] }];
              return current.map((message) => String(message.id) === String(payload.new.id)
                ? { ...message, ...payload.new }
                : message);
            });
          }
          await loadUnread();
          if (payload.eventType === "INSERT") scrollToBottom(true);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_message_images" },
        async (payload) => {
          if (payload.eventType === "DELETE") await deleteLocal("groupMessageImages", payload.old.id);
          else {
            const row = { ...payload.new };
            await putLocal("groupMessageImages", row);
          }
          refreshImagesFromLocal();
        }
      )
      .subscribe((status) => {
        realtimeReadyRef.current = status === "SUBSCRIBED";
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.log("GROUP CHAT REALTIME:", status);
        }
      });

    return () => {
      realtimeReadyRef.current = false;
      clearTimeout(reloadTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [loadChat, loadUnread, scrollToBottom]);

  // iOS và mạng yếu: giữ một nhịp đồng bộ dự phòng nếu kênh Realtime bị ngắt.
  useEffect(() => {
    const refresh = (force = false) => {
      if ((!force && realtimeReadyRef.current) || document.visibilityState !== "visible") return;
      loadChat({ full: force });
      loadUnread();
    };
    const onFocus = () => refresh(true);
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadChat, loadUnread]);

  useEffect(() => {
    const refreshFromLocal = (event) => {
      if (!String(event.detail?.entity_type || "").startsWith("group_")) return;
      loadChat({ remote: false });
    };
    window.addEventListener("sonphu-local-sync", refreshFromLocal);
    return () => window.removeEventListener("sonphu-local-sync", refreshFromLocal);
  }, [loadChat]);

  // ===== AUTO SCROLL WHEN MESSAGES CHANGE =====
  useEffect(() => {
    scrollToBottom(false);
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!viewer) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") closeViewer();
      if (event.key === "ArrowLeft") moveViewer(-1);
      if (event.key === "ArrowRight") moveViewer(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeViewer, moveViewer, viewer]);

  useEffect(() => {
    const handleBrowserBack = () => {
      if (!imageViewerHistoryRef.current) return;
      imageViewerHistoryRef.current = false;
      setViewer(null);
      setViewerImageSrc("");
    };
    window.addEventListener("popstate", handleBrowserBack);
    return () => window.removeEventListener("popstate", handleBrowserBack);
  }, []);

  // ===== MARK SEEN =====
  useEffect(() => {
    if (!me) return;

    const run = async () => {
      for (const m of messages) {
        if (m.sender_id !== me.id && !(m.seen_by || []).includes(me.id)) {
          await supabase
            .from("group_messages")
            .update({
              seen_by: [...(m.seen_by || []), me.id]
            })
            .eq("id", m.id);
        }
      }
      loadUnread();
    };

    run();
  }, [messages, me, loadUnread]);

  // ===== SEND =====
  async function send() {
    if (!text.trim() && attachments.length === 0) return;

    const me = getCurrentUser();
    if (!me) return;

    const sendingText = text.trim();
    const sendingAttachments = [...attachments];
    const optimisticId = `local-${crypto.randomUUID()}`;

    setMessages((current) => [...current, {
      id: optimisticId,
      sender_id: me.id,
      sender_name: me.name,
      text: sendingText,
      seen_by: [me.id],
      created_at: new Date().toISOString(),
      images: sendingAttachments,
    }]);
    setText("");
    setAttachments([]);
    scrollToBottom(false);

    const { data: msg } = await supabase
      .from("group_messages")
      .insert({
        sender_id: me.id,
        sender_name: me.name,
        text: sendingText,
        seen_by: [me.id]
      })
      .select()
      .single();

    if (!msg) {
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      setText(sendingText);
      setAttachments(sendingAttachments);
      return;
    }
    setMessages((current) => current.map((message) => (
      message.id === optimisticId ? { ...msg, images: sendingAttachments } : message
    )));
    await putLocal("groupMessages", msg);
    void publishSyncEvent({ entityType: "group_message", entityId: msg.id, payload: msg });

    void Promise.all(sendingAttachments.map(async (source, i) => {
      const blob = await (await fetch(source)).blob();
      const stamp = Date.now();
      const name = `group_${msg.id}_${i}_${stamp}.jpg`;
      const previewName = `group_${msg.id}_${i}_${stamp}_preview.jpg`;
      const previewBlob = await createImagePreviewBlob(source);

      const { error: previewError } = await supabase.storage.from("order-images").upload(previewName, previewBlob, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
      });

      let savedImage = null;
      if (!previewError) {
        const { data: previewUrl } = supabase.storage.from("order-images").getPublicUrl(previewName);
        const { data: previewRow } = await supabase.from("group_message_images").insert({
          message_id: msg.id,
          image_url: previewUrl.publicUrl,
        }).select().single();
        savedImage = previewRow;
        if (savedImage) await publishSyncEvent({
          entityType: "group_message_image",
          entityId: savedImage.id,
          payload: savedImage,
          storagePaths: [previewName],
        });
      }

      const { error: uploadError } = await supabase.storage.from("order-images").upload(name, blob, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
      });
      if (uploadError) return;

      const { data } = supabase.storage
        .from("order-images")
        .getPublicUrl(name);

      const write = savedImage
        ? supabase.from("group_message_images").update({ image_url: data.publicUrl }).eq("id", savedImage.id).select().single()
        : supabase.from("group_message_images").insert({ message_id: msg.id, image_url: data.publicUrl }).select().single();
      const { data: finalImage } = await write;
      if (finalImage) {
        await publishSyncEvent({
          entityType: "group_message_image",
          entityId: finalImage.id,
          payload: finalImage,
          storagePaths: [name],
        });
      }
    })).catch((error) => console.log("UPLOAD GROUP CHAT IMAGES ERROR:", error));
  }

  const handleKeyDown = async (e) => {
    const isDesktop = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (isDesktop && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await send();
    }
  };

  const addSelectedImages = async (files, openEditor = false) => {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    const urls = await Promise.all(selected.map((file) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    })));
    const firstNewIndex = attachments.length;
    setAttachments((current) => [...current, ...urls]);
    if (openEditor) setEditingIndex(firstNewIndex);
    setTimeout(() => scrollToBottom(true), 50);
  };

  return (
    <div className="chatPage">
      <div className="chatHeader">
        <button className="chatBack" onClick={() => navigate("/")} aria-label="Về trang chính">‹</button>
        <div className="chatTitle"><strong>Chat nội bộ</strong><small>{users.length} thành viên</small></div>
        <span
          style={{
            marginLeft: 10,
            background: "#ff3b30",
            padding: "2px 8px",
            borderRadius: 999,
            animation: groupUnreadCount > 0 ? "pulseBadge 1s infinite" : "none"
          }}
        >
          {groupUnreadCount}
        </span>
      </div>

      <div
        className="msgList"
        ref={msgListRef}
        onClick={() => scrollToBottom(true)}
      >
        {messages.map((m) => {
          const isMine = m.sender_id === me?.id;

          return (
            <div
              key={m.id}
              className={`msgRow ${isMine ? "msgMine" : "msgOther"}`}
            >
              <div className="msgBubble">
                <div className="msgHeader">
                  {m.sender_name} • {format(m.created_at)}
                </div>

                <div className="msgText">{m.text}</div>

                {!!m.images?.length && (
                  <div className="msgImages">
                    {m.images.map((img, i) => (
                      <DeferredCachedImage
                        key={`${i}-${img}`}
                        src={getImageThumbnail(img)}
                        className="chatImg"
                        alt=""
                        onClick={() => openViewer(m.images, i)}
                      />
                    ))}
                  </div>
                )}

                <div className="msgSeen">
                  Đã xem: {(m.seen_by || []).map(getName).join(", ") || "Chưa ai"}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {attachments.length > 0 && (
        <div className="previewRow">
          {attachments.map((img, i) => (
            <div key={i} className="previewBox">
              <img src={img} alt="" />
              <button
                type="button"
                className="previewEdit"
                onClick={() => setEditingIndex(i)}
              >
                Sửa
              </button>
              <button
                className="previewRemove"
                onClick={() =>
                  setAttachments((prev) => prev.filter((_, idx) => idx !== i))
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="composer">
        <textarea
          ref={inputRef}
          value={text}
          rows={1}
          placeholder="Nhập tin nhắn..."
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setTimeout(() => scrollToBottom(false), 100)}
          onClick={() => setTimeout(() => scrollToBottom(false), 100)}
          onKeyDown={handleKeyDown}
        />

        <div className="composerRow">
          <label className="attachButton" aria-label="Chụp ảnh" title="Chụp ảnh">
            📷
            <input
              className="fileInput"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => addSelectedImages(e.target.files, true)}
            />
          </label>

          <label className="attachButton addImageButton" aria-label="Thêm ảnh" title="Thêm ảnh">
            🖼
            <input
              className="fileInput"
              type="file"
              multiple
              accept="image/*"
              onChange={(e) => addSelectedImages(e.target.files)}
            />
          </label>

          <button
            type="button"
            className="sendButton"
            onPointerDown={(event) => event.preventDefault()}
            onClick={send}
            aria-label="Gửi tin nhắn"
          >
            ➤
          </button>
        </div>
      </div>

      {editingIndex !== null && attachments[editingIndex] && (
        <Suspense fallback={null}><ImageEditor
          src={attachments[editingIndex]}
          onClose={() => setEditingIndex(null)}
          onSave={(editedImage) => {
            setAttachments((current) =>
              current.map((image, index) =>
                index === editingIndex ? editedImage : image
              )
            );
            setEditingIndex(null);
          }}
        /></Suspense>
      )}

      {viewer && (
        <div className="viewer">
          <button className="viewerClose" onClick={closeViewer}>
            ×
          </button>

          <img
            src={viewerImageSrc || viewer.images[viewer.index]}
            className="viewerImg"
            alt=""
            onTouchStart={(event) => {
              viewerTouchRef.current = event.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={(event) => {
              const start = viewerTouchRef.current;
              const end = event.changedTouches[0]?.clientX;
              viewerTouchRef.current = null;
              if (start == null || end == null || Math.abs(end - start) < 45) return;
                moveViewer(end < start ? 1 : -1);
            }}
          />
          {viewer.images.length > 1 && (
            <>
              <button
                type="button"
                className="viewerArrow viewerArrowLeft"
                disabled={viewer.index === 0}
                onClick={() => moveViewer(-1)}
              >‹</button>
              <button
                type="button"
                className="viewerArrow viewerArrowRight"
                disabled={viewer.index === viewer.images.length - 1}
                onClick={() => moveViewer(1)}
              >›</button>
            </>
          )}
          {viewer.images.length > 1 && <div className="viewerCounter">{viewer.index + 1}/{viewer.images.length} • Vuốt để xem</div>}
        </div>
      )}
    </div>
  );
}
