// CHỈ DÁN - KHÔNG SỬA LINH TINH
import { notifyGroupChat } from "../utils/push";
import React, { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import ImageEditor from "../components/ImageEditor";
import "../styles/chat.css";
import { getCurrentUser, getUsers, refreshCurrentUser } from "../utils/auth";

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
  const [sending, setSending] = useState(false);
  const [groupUnreadCount, setGroupUnreadCount] = useState(0);

  const inputRef = useRef(null);
  const bottomRef = useRef(null);
  const msgListRef = useRef(null);

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
  const loadChat = useCallback(async () => {
    const { data } = await supabase
      .from("group_messages")
      .select("*")
      .order("created_at", { ascending: true });

    const safeData = data || [];
    const ids = safeData.map((m) => m.id);

    let imgs = [];
    if (ids.length > 0) {
      const { data: imgData } = await supabase
        .from("group_message_images")
        .select("*")
        .in("message_id", ids);

      imgs = imgData || [];
    }

    const merged = safeData.map((m) => ({
      ...m,
      images: imgs
        .filter((i) => i.message_id === m.id)
        .map((i) => i.image_url)
    }));

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
    const channel = supabase
      .channel("group-chat")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_messages" },
        async () => {
          await loadChat();
          await loadUnread();
          setTimeout(() => scrollToBottom(true), 50);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_message_images" },
        async () => {
          await loadChat();
          setTimeout(() => scrollToBottom(true), 50);
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [loadChat, loadUnread, scrollToBottom]);

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
    if (sending) return;
    if (!text.trim() && attachments.length === 0) return;

    const me = getCurrentUser();
    if (!me) return;

    setSending(true);

    const sendingText = text;
    const sendingAttachments = [...attachments];

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

        for (let i = 0; i < sendingAttachments.length; i++) {
      const blob = await (await fetch(sendingAttachments[i])).blob();
      const name = `group_${msg.id}_${i}_${Date.now()}.png`;

      await supabase.storage.from("order-images").upload(name, blob);

      const { data } = supabase.storage
        .from("order-images")
        .getPublicUrl(name);

      await supabase.from("group_message_images").insert({
        message_id: msg.id,
        image_url: data.publicUrl
      });
    }

    await notifyGroupChat({
      text: sendingText,
      imageCount: sendingAttachments.length,
    });

    setSending(false);

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
        CHAT NỘI BỘ
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
          rows={2}
          placeholder="Nhập tin nhắn..."
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setTimeout(() => scrollToBottom(true), 100)}
          onClick={() => setTimeout(() => scrollToBottom(true), 100)}
          onKeyDown={handleKeyDown}
        />

        <div className="composerRow">
          <input
            type="file"
            multiple
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

          <button onClick={send} disabled={sending}>
            {sending ? "..." : "Gửi"}
          </button>
        </div>
      </div>

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