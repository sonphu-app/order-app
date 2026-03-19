// CHỈ DÁN - KHÔNG SỬA LINH TINH

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

  const me = getCurrentUser();

  const getName = (id) => {
    const u = users.find((x) => x.id === id);
    return u ? u.name : id;
  };

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

    const ids = data.map((m) => m.id);

    const { data: imgs } = await supabase
      .from("group_message_images")
      .select("*")
      .in("message_id", ids);

    const merged = data.map((m) => ({
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

    const count = data.filter((m) => {
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
    })();
  }, []);

  // ===== REALTIME =====
  useEffect(() => {
    const channel = supabase
      .channel("group-chat")
      .on("postgres_changes", { event: "*", schema: "public", table: "group_messages" }, () => {
        loadChat();
        loadUnread();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "group_message_images" }, () => {
        loadChat();
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
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
  }, [messages]);

  // ===== SEND =====
  async function send() {
    if (sending) return;
    if (!text.trim() && attachments.length === 0) return;

    const me = getCurrentUser();
    if (!me) return;

    setSending(true);

    const { data: msg } = await supabase
      .from("group_messages")
      .insert({
        sender_id: me.id,
        sender_name: me.name,
        text,
        seen_by: [me.id]
      })
      .select()
      .single();

    for (let i = 0; i < attachments.length; i++) {
      const blob = await (await fetch(attachments[i])).blob();
      const name = `group_${msg.id}_${i}.png`;

      await supabase.storage.from("order-images").upload(name, blob);

      const { data } = supabase.storage
        .from("order-images")
        .getPublicUrl(name);

      await supabase.from("group_message_images").insert({
        message_id: msg.id,
        image_url: data.publicUrl
      });
    }

    setText("");
    setAttachments([]);
    setSending(false);
  }

  return (
    <div className="chatPage">
      <div className="chatHeader">
        CHAT NỘI BỘ
        <span style={{
          marginLeft: 10,
          background: "#ff3b30",
          padding: "2px 8px",
          borderRadius: 999,
          animation: groupUnreadCount > 0 ? "pulseBadge 1s infinite" : "none"
        }}>
          {groupUnreadCount}
        </span>
      </div>

      <div className="msgList">
        {messages.map((m) => {
          const isMine = m.sender_id === me?.id;

          return (
            <div key={m.id} className={`msgRow ${isMine ? "msgMine" : "msgOther"}`}>
              <div className="msgBubble">
                <div className="msgHeader">
                  {m.sender_name} • {format(m.created_at)}
                </div>

                <div>{m.text}</div>

                {m.images?.map((img, i) => (
                  <img key={i} src={img} className="chatImg" />
                ))}

                <div className="msgSeen">
                  {(m.seen_by || []).map(getName).join(", ") || "Chưa ai xem"}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <input type="file" multiple onChange={(e) => {
          const files = Array.from(e.target.files);
          files.forEach(f => {
            const reader = new FileReader();
            reader.onload = () => setAttachments(a => [...a, reader.result]);
            reader.readAsDataURL(f);
          });
        }} />

        <button onClick={send} disabled={sending}>
          {sending ? "..." : "Gửi"}
        </button>
      </div>
    </div>
  );
}