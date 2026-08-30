// CHỈ DÁN - KHÔNG SỬA LINH TINH
import { notifyGroupChat } from "../utils/push";
import React, { lazy, Suspense, useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import "../styles/chat.css";
import { getCurrentUser, getUsers, refreshCurrentUser } from "../utils/auth";
import { cacheImage, getAllLocal, publishSyncEvent, putLocal, putManyLocal } from "../utils/localSync";
import { createImagePreviewBlob } from "../utils/imagePreview";
import { useNavigate } from "react-router-dom";

const ImageEditor = lazy(() => import("../components/ImageEditor"));

function format(ts) {
  return ts ? new Date(ts).toLocaleString() : "";
}

export default function Chat() {
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [editingIndex, setEditingIndex] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [groupUnreadCount, setGroupUnreadCount] = useState(0);

  const inputRef = useRef(null);
  const bottomRef = useRef(null);
  const msgListRef = useRef(null);
  const reloadTimerRef = useRef(null);
  const navigate = useNavigate();

  const me = getCurrentUser();

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
  const loadChat = useCallback(async ({ remote = true } = {}) => {
    const localMessages = await getAllLocal("groupMessages");
    const localImages = await getAllLocal("groupMessageImages");
    if (localMessages.length > 0) {
      setMessages(localMessages.map((message) => ({
        ...message,
        images: localImages
          .filter((image) => String(image.message_id) === String(message.id))
          .map((image) => image.local_image_url || image.image_url),
      })).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
    }

    if (!remote) return;

    const { data } = await supabase
      .from("group_messages")
      .select("*")
      .order("created_at", { ascending: true });

    const safeData = data || [];
    await putManyLocal("groupMessages", safeData);
    const ids = safeData.map((m) => m.id);

    let imgs = [];
    if (ids.length > 0) {
      const { data: imgData } = await supabase
        .from("group_message_images")
        .select("*")
        .in("message_id", ids);

      imgs = await Promise.all((imgData || []).map(async (row) => ({
        ...row,
        local_image_url: await cacheImage(row.image_url),
      })));
      await putManyLocal("groupMessageImages", imgs);
    }

    const messageMap = new Map(localMessages.map((message) => [String(message.id), message]));
    safeData.forEach((message) => messageMap.set(String(message.id), message));
    const imageMap = new Map(localImages.map((image) => [String(image.id), image]));
    imgs.forEach((image) => imageMap.set(String(image.id), image));
    const allImages = [...imageMap.values()];
    const merged = [...messageMap.values()].map((m) => ({
      ...m,
      images: allImages
        .filter((i) => String(i.message_id) === String(m.id))
        .map((i) => i.local_image_url || i.image_url)
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
    const refresh = (includeUnread = false) => {
      clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(async () => {
        await loadChat();
        if (includeUnread) await loadUnread();
        scrollToBottom(true);
      }, 120);
    };
    const channel = supabase
      .channel("group-chat")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_messages" },
        () => refresh(true)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_message_images" },
        () => refresh(false)
      )
      .subscribe();

    return () => {
      clearTimeout(reloadTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [loadChat, loadUnread, scrollToBottom]);

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
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));

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
    await publishSyncEvent({ entityType: "group_message", entityId: msg.id, payload: msg });

    await Promise.all(sendingAttachments.map(async (source, i) => {
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
    }));

    void notifyGroupChat({
      text: sendingText,
      imageCount: sendingAttachments.length,
    }).catch((error) => console.log("NOTIFY GROUP CHAT ERROR:", error));

    setTimeout(() => {
      scrollToBottom(true);
      inputRef.current?.focus();
    }, 50);
  }

  const handleKeyDown = async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await send();
    }
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
                      <img
                        key={i}
                        src={img}
                        className="chatImg"
                        onClick={() => setViewer({ images: m.images, index: i })}
                      />
                    ))}
                  </div>
                )}

                <div className="msgSeen">
                  {(m.seen_by || []).map(getName).join(", ") || "Chưa ai xem"}
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
          onFocus={() => setTimeout(() => scrollToBottom(true), 100)}
          onClick={() => setTimeout(() => scrollToBottom(true), 100)}
          onKeyDown={handleKeyDown}
        />

        <div className="composerRow">
          <label className="attachButton" aria-label="Chọn ảnh">
            ＋
            <input
              className="fileInput"
              type="file"
              multiple
              accept="image/*"
              onChange={(e) => {
              const files = Array.from(e.target.files || []);
              files.forEach((f) => {
                const reader = new FileReader();
                reader.onload = () =>
                  setAttachments((a) => [...a, reader.result]);
                reader.readAsDataURL(f);
              });

              setTimeout(() => scrollToBottom(true), 100);
              }}
            />
          </label>

          <button className="sendButton" onClick={send} aria-label="Gửi tin nhắn">
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
          <button className="viewerClose" onClick={() => setViewer(null)}>
            ×
          </button>

          {viewer.images.length > 1 && viewer.index > 0 && (
            <button
              className="navBtn left"
              onClick={() =>
                setViewer((v) => ({ ...v, index: v.index - 1 }))
              }
            >
              ‹
            </button>
          )}

          <img
            src={viewer.images[viewer.index]}
            className="viewerImg"
            alt=""
          />

          {viewer.images.length > 1 &&
            viewer.index < viewer.images.length - 1 && (
              <button
                className="navBtn right"
                onClick={() =>
                  setViewer((v) => ({ ...v, index: v.index + 1 }))
                }
              >
                ›
              </button>
            )}
        </div>
      )}
    </div>
  );
}
