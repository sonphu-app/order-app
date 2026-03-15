import React, { useEffect, useRef, useState } from "react";
import { loadMessages, saveMessages } from "../utils/chatStorage";
import ImageEditor from "../components/ImageEditor";
import "../styles/chat.css";
import { saveImage, loadImage } from "../utils/imageDB";
import { getCurrentUser, getUsers } from "../utils/auth";

function format(ts) {
  return new Date(ts).toLocaleString();
}

export default function Chat() {
const users = getUsers();

const getName = (id) => {
  const u = users.find(x => x.id === id);
  return u ? u.name : id;
};
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]); // dataURL[]
  const [editingIndex, setEditingIndex] = useState(null); // number|null
  const [viewer, setViewer] = useState(null); // {imgs:[], i:number}|null

  const inputRef = useRef(null);
  const bottomRef = useRef(null);

  // ===== VIEWER ZOOM (PINCH) =====
  const [vScale, setVScale] = useState(1);
  const [vPos, setVPos] = useState({ x: 0, y: 0 });
  const pinchRef = useRef({
    mode: null, // "pinch" | "pan" | null
    startDist: 0,
    startScale: 1,
    startMid: { x: 0, y: 0 },
    startPos: { x: 0, y: 0 },
    startPan: { x: 0, y: 0 },
    lastTouch: { x: 0, y: 0 },
  });

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
    return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
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
      // pan only when zoomed
      pinchRef.current.mode = "pan";
      pinchRef.current.startPan = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      pinchRef.current.startPos = { ...vPos };
      pinchRef.current.lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
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

      // giữ ảnh "đi theo" điểm giữa pinch (nhẹ nhàng, đủ dùng)
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
    // nếu scale về 1 thì reset pos cho gọn
    if (vScale <= 1) setVPos({ x: 0, y: 0 });
  }

  function onViewerWheel(e) {
    // desktop zoom
    if (!viewer) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setVScale((s) => clamp(s + delta, 1, 4));
  }

  // LOAD CHAT (FIX MOBILE MẤT ẢNH)
useEffect(() => {
  async function loadAll() {
    const msgs = loadMessages() || [];

    for (const msg of msgs) {
      if (msg.imageIds && msg.imageIds.length) {
        const imgs = [];

        for (const id of msg.imageIds) {
          try {
            const img = await loadImage(id);
            if (img) imgs.push(img);   // CHỈ push khi có ảnh
          } catch (err) {
            console.log("LOAD IMAGE ERROR:", err);
          }
        }

        msg.images = imgs; // chỉ gán khi load xong
      }
    }

    setMessages([...msgs]); // clone để React render lại chắc chắn
  }

  loadAll();
}, []);

  // SAVE + AUTO SCROLL
  useEffect(() => {
    saveMessages(messages);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, [messages]);

  // ENTER / SHIFT ENTER
  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // NÚT ↵ XUỐNG DÒNG
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

  // ===== CHỌN ẢNH (MOBILE OK) =====
  function pickFiles(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => setAttachments((a) => [...a, reader.result]);
      reader.readAsDataURL(file);
    });

    // quan trọng cho mobile
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
  if (!text.trim() && attachments.length === 0) return;

  const me = getCurrentUser();
  if (!me) return;

  const imageIds = attachments.map(() => Date.now() + Math.random());

  const msg = {
    id: Date.now(),
    userId: me.id,        // ⭐ quan trọng
    name: me.name,        // ⭐ tên hiển thị
    text,
    imageIds,
    ts: Date.now(),
    delivered: [me.id],
    seen: [],
    images: [...attachments],
  };

  attachments.forEach((img, i) => {
    saveImage(imageIds[i], img);
  });

  setMessages((m) => [...m, msg]);
  setText("");
  setAttachments([]);
}

  // VIEWER NAV
  function prevImg(e) {
  e.stopPropagation();
  setViewer(v => ({
    ...v,
    i: v.i === 0 ? v.imgs.length - 1 : v.i - 1
  }));
}

function nextImg(e) {
  e.stopPropagation();
  setViewer(v => ({
    ...v,
    i: v.i === v.imgs.length - 1 ? 0 : v.i + 1
  }));
}
  function nextImg(e) {
    e.stopPropagation();
    setViewer((v) => ({ ...v, i: Math.min(v.imgs.length - 1, v.i + 1) }));
    resetViewerTransform();
  }

  function openViewer(imgs, i) {
    setViewer({ imgs, i });
    resetViewerTransform();
  }

  return (
    <div className="chatPage">
      <div className="chatHeader">CHAT NỘI BỘ SƠN PHÚ</div>

      {/* LIST */}
      <div className="msgList">
        {messages.map((m) => {
  const me = getCurrentUser();
  const isMine = m.userId === me?.id;

  return (
    <div key={m.id} className={`msgRow ${isMine ? "msgMine" : "msgOther"}`}>
            <div className="msgBubble">
              <div className="msgHeader">
                {m.name} • {format(m.ts)}
                <span
                  className="msgAction"
                  onClick={() => setMessages((ms) => ms.filter((x) => x.id !== m.id))}
                >
                  Xoá
                </span>
              </div>

              <div className="msgText">{m.text}</div>

              {/* ẢNH TRONG TIN NHẮN: dùng m.images để có full list => lướt được */}
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
  Đã nhận: {m.delivered?.map(getName).join(", ")} • 
  Đã xem: {m.seen?.map(getName).join(", ")}
</div>
            </div>
          </div>
);
        })}
        <div ref={bottomRef} />
      </div>

      {/* PREVIEW BAR */}
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

      {/* COMPOSER */}
      <div className="composer">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div className="composerRow">
          {/* MOBILE OK: dùng label mở file picker */}
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
          <button onClick={send}>Gửi</button>
        </div>
      </div>

      {/* IMAGE EDITOR */}
      {editingIndex !== null && (
        <ImageEditor
          src={attachments[editingIndex]}
          onSave={saveEdited}
          onClose={() => setEditingIndex(null)}
        />
      )}

      {/* VIEWER */}
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
          {/* nút đóng */}
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

          {/* nút trái */}
          {viewer.i > 0 && (
            <button className="navBtn left" onClick={prevImg}>
              ‹
            </button>
          )}

          {/* ảnh + zoom */}
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

          {/* nút phải */}
          {viewer.i < viewer.imgs.length - 1 && (
            <button className="navBtn right" onClick={nextImg}>
              ›
            </button>
          )}
        </div>
      )}
    </div>
  );
}
