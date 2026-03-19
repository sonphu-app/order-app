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
  const [attachments, setAttachments] = useState([]); // dataURL[]
  const [editingIndex, setEditingIndex] = useState(null);
  const [viewer, setViewer] = useState(null); // { imgs: [], i: number } | null
  const [sending, setSending] = useState(false);

  const inputRef = useRef(null);
  const bottomRef = useRef(null);

  // ===== VIEWER ZOOM =====
  const [vScale, setVScale] = useState(1);
  const [vPos, setVPos] = useState({ x: 0, y: 0 });
  const pinchRef = useRef({
    mode: null,
    startDist: 0,
    startScale: 1,
    startMid: { x: 0, y: 0 },
    startPos: { x: 0, y: 0 },
    startPan: { x: 0, y: 0 },
  });

  const me = getCurrentUser();

  const getName = (id) => {
    const u = users.find((x) => x.id === id);
    return u ? u.name || u.username : id;
  };

  function resetViewerTransform() {
    setVScale(1);
    setVPos({ x: 0, y: 0 });
    pinchRef.current.mode = null;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function dist(t1, t2) {
    const dx = t2.clientX - t1.clientX;
    const dy = t2.clientY - t1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function mid(t1, t2) {
    return {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    };
  }

  function onViewerTouchStart(e) {
    if (!viewer) return;

    if (e.touches.length === 2) {
      const d = dist(e.touches[0], e.touches[1]);
      const m = mid(e.touches[0], e.touches[1]);
      pinchRef.current.mode = "pinch";
      pinchRef.current.startDist = d;
      pinchRef.current.startScale = vScale;
      pinchRef.current.startMid = m;
      pinchRef.current.startPos = { ...vPos };
    } else if (e.touches.length === 1) {
      pinchRef.current.mode = "pan";
      pinchRef.current.startPan = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
      pinchRef.current.startPos = { ...vPos };
    }
  }

  function onViewerTouchMove(e) {
    if (!viewer) return;

    if (pinchRef.current.mode === "pinch" && e.touches.length === 2) {
      e.preventDefault();
      const d = dist(e.touches[0], e.touches[1]);
      const ratio = d / (pinchRef.current.startDist || d);
      const nextScale = clamp(pinchRef.current.startScale * ratio, 1, 4);
      setVScale(nextScale);

      const m = mid(e.touches[0], e.touches[1]);
      const dx = m.x - pinchRef.current.startMid.x;
      const dy = m.y - pinchRef.current.startMid.y;
      setVPos({
        x: pinchRef.current.startPos.x + dx,
        y: pinchRef.current.startPos.y + dy,
      });
    } else if (pinchRef.current.mode === "pan" && e.touches.length === 1) {
      if (vScale <= 1) return;
      e.preventDefault();
      const cx = e.touches[0].clientX;
      const cy = e.touches[0].clientY;
      const dx = cx - pinchRef.current.startPan.x;
      const dy = cy - pinchRef.current.startPan.y;
      setVPos({
        x: pinchRef.current.startPos.x + dx,
        y: pinchRef.current.startPos.y + dy,
      });
    }
  }

  function onViewerTouchEnd() {
    pinchRef.current.mode = null;
    if (vScale <= 1) setVPos({ x: 0, y: 0 });
  }

  function onViewerWheel(e) {
    if (!viewer) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setVScale((s) => clamp(s + delta, 1, 4));
  }

  const loadUsersAsync = useCallback(async () => {
    const data = await getUsers();
    setUsers(data || []);
  }, []);

  const loadGroupChat = useCallback(async () => {
    const { data: msgs, error: msgErr } = await supabase
      .from("group_messages")
      .select("*")
      .order("created_at", { ascending: true });

    if (msgErr) {
      console.log("LOAD GROUP MSG ERROR:", msgErr);
      return;
    }

    const ids = (msgs || []).map((m) => m.id);

    let imgs = [];
    if (ids.length > 0) {
      const { data: imgRows, error: imgErr } = await supabase
        .from("group_message_images")
        .select("*")
        .in("message_id", ids);

      if (imgErr) {
        console.log("LOAD GROUP IMG ERROR:", imgErr);
        return;
      }

      imgs = imgRows || [];
    }

    const merged = (msgs || []).map((m) => ({
      ...m,
      images: imgs
        .filter((img) => img.message_id === m.id)
        .map((img) => img.image_url),
    }));

    setMessages(merged);
  }, []);

  useEffect(() => {
    const run = async () => {
      await refreshCurrentUser();
      await loadUsersAsync();
      await loadGroupChat();
    };
    run();
  }, [loadUsersAsync, loadGroupChat]);

  useEffect(() => {
    const channel = supabase
      .channel("group-chat-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_messages" },
        () => loadGroupChat()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_message_images" },
        () => loadGroupChat()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadGroupChat]);

  useEffect(() => {
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  }, [messages]);

  // mark seen
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
          .from("group_messages")
          .update({
            seen_by: [...(m.seen_by || []), me.id],
          })
          .eq("id", m.id);
      }
    };

    markSeen();
  }, [messages, me?.id]);

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function addNewLine() {
    const el = inputRef.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const newValue = text.substring(0, start) + "\n" + text.substring(end);
    setText(newValue);

    setTimeout(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + 1;
    }, 0);
  }

  function pickFiles(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => setAttachments((a) => [...a, reader.result]);
      reader.readAsDataURL(file);
    });

    e.target.value = "";
  }

  function removeAttachment(i) {
    setAttachments((a) => a.filter((_, idx) => idx !== i));
  }

  function saveEdited(newUrl) {
    setAttachments((a) => a.map((url, i) => (i === editingIndex ? newUrl : url)));
    setEditingIndex(null);
  }

  async function send() {
    if (sending) return;
    if (!text.trim() && attachments.length === 0) return;

    const current = getCurrentUser();
    if (!current?.id) return;

    setSending(true);

    try {
      const { data: msgData, error: msgErr } = await supabase
        .from("group_messages")
        .insert({
          sender_id: current.id,
          sender_name: current.name || current.username || "Không rõ",
          text: text.trim(),
          seen_by: [current.id],
        })
        .select()
        .single();

      if (msgErr || !msgData) {
        console.log("SEND GROUP MSG ERROR:", msgErr);
        return;
      }

      for (let i = 0; i < attachments.length; i++) {
        const base64 = attachments[i];
        const blob = await (await fetch(base64)).blob();
        const fileName = `group_${msgData.id}_${Date.now()}_${i}.png`;

        const { error: uploadError } = await supabase.storage
          .from("order-images")
          .upload(fileName, blob);

        if (uploadError) {
          console.log("UPLOAD GROUP IMG ERROR:", uploadError);
          continue;
        }

        const { data: publicUrlData } = supabase.storage
          .from("order-images")
          .getPublicUrl(fileName);

        await supabase.from("group_message_images").insert({
          message_id: msgData.id,
          image_url: publicUrlData.publicUrl,
        });
      }

      setText("");
      setAttachments([]);
    } finally {
      setSending(false);
    }
  }

  async function deleteMessage(messageId, senderId) {
    const current = getCurrentUser();
    const isAdmin = current?.role === "admin";
    const isOwner = current?.id === senderId;

    if (!isAdmin && !isOwner) return;
    if (!window.confirm("Xóa tin nhắn này?")) return;

    const { error } = await supabase
      .from("group_messages")
      .delete()
      .eq("id", messageId);

    if (error) {
      console.log("DELETE GROUP MSG ERROR:", error);
    }
  }

  function prevImg(e) {
    e.stopPropagation();
    setViewer((v) => ({
      ...v,
      i: v.i === 0 ? v.imgs.length - 1 : v.i - 1,
    }));
    resetViewerTransform();
  }

  function nextImg(e) {
    e.stopPropagation();
    setViewer((v) => ({
      ...v,
      i: v.i === v.imgs.length - 1 ? 0 : v.i + 1,
    }));
    resetViewerTransform();
  }

  function openViewer(imgs, i) {
    setViewer({ imgs, i });
    resetViewerTransform();
  }

  return (
    <div className="chatPage">
      <div className="chatHeader">CHAT NỘI BỘ SƠN PHÚ</div>

      <div className="msgList">
        {messages.map((m) => {
          const current = getCurrentUser();
          const isMine = m.sender_id === current?.id;

          return (
            <div key={m.id} className={`msgRow ${isMine ? "msgMine" : "msgOther"}`}>
              <div className="msgBubble">
                <div className="msgHeader">
                  {m.sender_name || "Không rõ"} • {format(m.created_at)}
                  <span
                    className="msgAction"
                    onClick={() => deleteMessage(m.id, m.sender_id)}
                  >
                    Xoá
                  </span>
                </div>

                <div className="msgText">{m.text}</div>

                {m.images?.length > 0 && (
                  <div className="msgImages">
                    {m.images.map((src, i) => (
                      <img
                        key={i}
                        src={src}
                        className="chatImg"
                        onClick={() => openViewer(m.images, i)}
                        alt=""
                      />
                    ))}
                  </div>
                )}

                <div className="msgSeen">
                  Đã xem: {(m.seen_by || []).map(getName).join(", ") || "Chưa ai xem"}
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
              <img src={img} onClick={() => setEditingIndex(i)} alt="" />
              <button className="previewRemove" onClick={() => removeAttachment(i)}>
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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div className="composerRow">
          <input
            id="chatPick"
            type="file"
            accept="image/*"
            multiple
            onChange={pickFiles}
            style={{ position: "absolute", left: -9999 }}
          />
          <label
            htmlFor="chatPick"
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              background: "#2a2a2a",
              color: "#fff",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            🖼️
          </label>

          <button type="button" onClick={addNewLine}>
            ↵
          </button>
          <button onClick={send} disabled={sending}>
            {sending ? "..." : "Gửi"}
          </button>
        </div>
      </div>

      {editingIndex !== null && (
        <ImageEditor
          src={attachments[editingIndex]}
          onSave={saveEdited}
          onClose={() => setEditingIndex(null)}
        />
      )}

      {viewer && (
        <div
          className="viewer"
          onClick={() => {
            setViewer(null);
            resetViewerTransform();
          }}
          onWheel={onViewerWheel}
          onTouchStart={onViewerTouchStart}
          onTouchMove={onViewerTouchMove}
          onTouchEnd={onViewerTouchEnd}
        >
          <button
            className="viewerClose"
            onClick={(e) => {
              e.stopPropagation();
              setViewer(null);
              resetViewerTransform();
            }}
          >
            ✕
          </button>

          {viewer.imgs.length > 1 && (
            <button className="navBtn left" onClick={prevImg}>
              ‹
            </button>
          )}

          <img
            src={viewer.imgs[viewer.i]}
            onClick={(e) => e.stopPropagation()}
            className="viewerImg"
            alt=""
            style={{
              transform: `translate(${vPos.x}px, ${vPos.y}px) scale(${vScale})`,
              transition: pinchRef.current.mode ? "none" : "transform 120ms ease-out",
              touchAction: "none",
            }}
          />

          {viewer.imgs.length > 1 && (
            <button className="navBtn right" onClick={nextImg}>
              ›
            </button>
          )}
        </div>
      )}
    </div>
  );
}