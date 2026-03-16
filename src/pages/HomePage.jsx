import { supabase } from "../supabaseClient";
import { ensureWeeklySystemTask } from "../utils/systemTasks";
import { useEffect, useMemo, useState, useRef } from "react";
import Header from "../components/Header";
import SearchBar from "../components/SearchBar";
import FilterBar from "../components/FilterBar";
import BottomNav from "../components/BottomNav";
import { hasPermission, PERMISSIONS } from "../utils/permissions";
import { getCurrentUser } from "../utils/auth";
function formatTime(date) {
  const d = new Date(date);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${MM} ${hh}:${mm}`;
}

// 🎨 màu theo trạng thái
const getCardColor = (o) => {
  if (o.status === "completed") return "#3a3a3a";
  if (o.status === "delivered") return "#1f7a4d";
  if (o.status === "done") return "#cc7a00";
  return "#6f5a1a";
};
// 🔘 BUTTON
const Btn = ({ children, onClick, active }) => (
  <button
    onClick={(e) => {
      e.stopPropagation();
      if (onClick) onClick();
    }}
    style={{
      background: active ? "#2ecc71" : "#2a2a2a",
      border: "1px solid #444",
      color: active ? "white" : "#f1f1f1",
      fontSize: 13,
      padding: "4px 8px",
      borderRadius: 20,
      cursor: "pointer",
      fontWeight: 600,
    }}
  >
    {children}
  </button>
);

// 🎨 STYLE
const S = {
  cardContent: { display: "flex", flexDirection: "column", gap: 8 },
  attachmentNote: { marginTop: 6, fontSize: 12, opacity: 0.9 },

  app: {
    minHeight: "100dvh",
    background: "#121212",
    padding: 14,
    paddingBottom: 90,
    color: "white",
  },
  section: { fontSize: 26, fontWeight: 800, margin: "20px 0 10px" },
  card: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    maxWidth: "100%",
    overflow: "hidden",
  },
  systemHeader: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#ffcc00",
    marginBottom: 6,
    textTransform: "uppercase",
  },
  title: { fontSize: 22, fontWeight: 800 },
  time: { fontSize: 14, color: "#ddd" },
  text: {
    fontSize: 14,
    lineHeight: 1.4,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflowWrap: "anywhere",
  },
};

export default function Home() {
console.log("HOME REALTIME VERSION 1");
  const [orders, setOrders] = useState([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("today");

  // map snake_case -> camelCase cho UI
  const normalizeOrder = (row) => ({
  ...row,
  createdAt: row.created_at,
  lastActionAt: row.updated_at,
  requiredUsers: row.required_users || [],
  understoodBy: row.understood_by || [],
  doneByName: row.done_by_name || "",
  deliveredByName: row.delivered_by_name || "",
  completedByName: row.completed_by_name || "",
  createdByName: row.created_by_name || "",
});

  // ✅ LOAD từ Supabase (CHỈ SELECT, KHÔNG UPDATE Ở ĐÂY)
  const loadOrdersSupabase = async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      console.log("LOAD ORDERS ERROR:", error);
      return;
    }

    let rows = (data || []).map(normalizeOrder);

// tạo weekly task ở client nếu đã qua mốc và chưa có
const created = await ensureWeeklySystemTask(rows);

if (created) {
  const { data: reloadData, error: reloadError } = await supabase
    .from("orders")
    .select("*")
    .order("updated_at", { ascending: false });

  if (reloadError) {
    console.log("RELOAD ORDERS ERROR:", reloadError);
    return;
  }

  rows = (reloadData || []).map(normalizeOrder);
}

setOrders(rows);

  };

  useEffect(() => {
    loadOrdersSupabase();
  }, []);
useEffect(() => {
  const channel = supabase
    .channel("orders-realtime")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "orders",
      },
      () => {
        loadOrdersSupabase();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, []);
  // ===== LỌC THEO THỜI GIAN =====
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);

  let timeFiltered = orders;

  const safeCreated = (o) => new Date(o.createdAt || o.created_at || 0);

  if (filter === "today") {
    timeFiltered = orders.filter((o) => safeCreated(o) >= today);
  }

  if (filter === "yesterday") {
    timeFiltered = orders.filter((o) => {
      const created = safeCreated(o);
      return created >= yesterday && created < today;
    });
  }

  if (filter === "7days") {
    timeFiltered = orders.filter((o) => safeCreated(o) >= sevenDaysAgo);
  }

  // ✅ custom date
  if (typeof filter === "object" && filter.type === "custom") {
    const fromDate = new Date(filter.from);
    const toDate = new Date(filter.to);
    toDate.setHours(23, 59, 59, 999);

    timeFiltered = orders.filter((o) => {
      const created = safeCreated(o);
      return created >= fromDate && created <= toDate;
    });
  }

  // ===== LỌC THEO TÌM KIẾM =====
  const finalFiltered = timeFiltered.filter((o) => {
    const text = (o.title || "") + " " + (o.content || "") + " " + (o.phone || "");
    return text.toLowerCase().includes(q.toLowerCase());
  });

  // ✅ GHIM (UPDATE lên Supabase)

  // ✅ UPDATE ORDER (UPDATE lên Supabase)

    // ✅ GHIM
const togglePin = async (id) => {
  const current = orders.find((o) => o.id === id);
  if (!current) return;

  const { error } = await supabase
    .from("orders")
    .update({ pinned: !current.pinned })
    .eq("id", id);

  if (error) console.log("PIN ERROR:", error);

  await loadOrdersSupabase();
};

// ✅ UPDATE ORDER STATUS
const updateOrder = async (id, action) => {
  const current = orders.find((o) => o.id === id);
  if (!current) return;

  const me = getCurrentUser() || {};
  const actorName = me?.name || me?.username || "Không rõ";

  let updateData = {};

  if (action === "reset") {
    updateData = {
      status: "new",
      done_by_name: "",
      delivered_by_name: "",
      completed_by_name: "",
    };
  }

  if (action === "done") {
    updateData = {
      status: "done",
      done_by_name: actorName,
    };
  }

  if (action === "shipped") {
    updateData = {
      status: "delivered",
      delivered_by_name: actorName,
    };
  }

  if (action === "completed") {
    updateData = {
      status: "completed",
      completed_by_name: actorName,
    };
  }

  if (action === "ack" && current.type === "system_message") {
    const old = Array.isArray(current.understoodBy)
      ? current.understoodBy
      : Array.isArray(current.understood_by)
      ? current.understood_by
      : [];

    if (me?.id && !old.includes(me.id)) {
      updateData.understood_by = [...old, me.id];
    }

    updateData.status = "done";
    updateData.done_by_name = actorName;
  }

  const { error } = await supabase
    .from("orders")
    .update(updateData)
    .eq("id", id);

  if (error) console.log("UPDATE ERROR:", error);

  await loadOrdersSupabase();
};

  // sort ghim lên đầu
  const sorted = useMemo(() => {
    return [...finalFiltered].sort((a, b) => {
      if (!a.pinned && b.pinned) return 1;
      if (a.pinned && !b.pinned) return -1;

      return (
        new Date(b.lastActionAt || b.createdAt).getTime() -
        new Date(a.lastActionAt || a.createdAt).getTime()
      );
    });
  }, [finalFiltered]);

  // ⭐ CARD COMPONENT
  const Card = ({ o, children, metaText }) => {
    const [expanded, setExpanded] = useState(false);
    const [showToggle, setShowToggle] = useState(false);
    const textRef = useRef(null);

    const fullText = (o.title ? o.title + "\n" : "") + (o.content || "");

    useEffect(() => {
      const el = textRef.current;
      if (!el) return;

      const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
      const maxHeight = lineHeight * 5;

      if (el.scrollHeight > maxHeight + 2) setShowToggle(true);
      else setShowToggle(false);
    }, [o.title, o.content]);

    return (
      <div
        style={{ ...S.card, background: getCardColor(o) }}
        onClick={() => (window.location.href = `/order/${o.id}`)}
      >
        <div style={S.cardContent}>
          {o.type === "system_message" && (
            <div style={S.systemHeader}>📢 TIN NHẮN HỆ THỐNG</div>
          )}

          {o.type === "system_task" && (
            <div style={S.systemHeader}>🛠 NHIỆM VỤ HỆ THỐNG</div>
          )}

          <div
            ref={textRef}
            style={{
              ...S.text,
              display: expanded ? "block" : "-webkit-box",
              WebkitLineClamp: expanded ? "none" : 5,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {fullText}
          </div>

          {showToggle && !expanded && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
              }}
              style={{
                fontSize: 12,
                color: "#4da6ff",
                marginTop: 6,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Xem thêm
            </div>
          )}

          {showToggle && expanded && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(false);
              }}
              style={{ fontSize: 12, color: "#aaa", marginTop: 6, cursor: "pointer" }}
            >
              Thu gọn
            </div>
          )}

          {o.has_image && (
  <div style={S.attachmentNote}>📎 Có ảnh đính kèm</div>
)}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 10,
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.7 }}>
  {metaText || formatTime(o.lastActionAt || o.createdAt)}
</div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{children}</div>
        </div>
      </div>
    );
  };

  const isNormal = (o) => !o.type || o.type === "normal";
  const isSystem = (o) => o.type === "system_task" || o.type === "system_message";
const showInDone = (o) => {
  if (!isNormal(o)) return o.status === "done";
  return o.status === "done" || (o.status === "completed" && !o.deliveredByName);
};

const showInDelivered = (o) => {
  if (!isNormal(o)) return false;
  return o.status === "delivered";
};

const showInCompleted = (o) => {
  return o.status === "completed";
};

const getMetaText = (o, section) => {
  if (section === "new") {
    return `${formatTime(o.createdAt || o.created_at)} • ${o.createdByName || "Không rõ"}`;
  }
  if (section === "done") {
    return `${formatTime(o.lastActionAt || o.updated_at || o.createdAt)} • ${o.doneByName || "Không rõ"}`;
  }
  if (section === "delivered") {
    return `${formatTime(o.lastActionAt || o.updated_at || o.createdAt)} • ${o.deliveredByName || "Không rõ"}`;
  }
  if (section === "completed") {
    return `${formatTime(o.lastActionAt || o.updated_at || o.createdAt)} • ${o.completedByName || "Không rõ"}`;
  }
  return formatTime(o.lastActionAt || o.createdAt);
};

  return (
    <div style={S.app}>
      <Header />
      <SearchBar value={q} onChange={setQ} />
      <FilterBar value={filter} onChange={setFilter} />

      {/* 🔴 ĐƠN MỚI */}
      <div style={S.section}>Đơn mới</div>
      {sorted
  .filter((o) => o.status === "new")
  .map((o) => (
    <Card key={o.id} o={o} metaText={getMetaText(o, "new")}>
            <>
              {o.type === "system_message" && (
                <>
                  {hasPermission(PERMISSIONS.MARK_DONE) && (
                    <Btn onClick={() => updateOrder(o.id, "ack")}>👁 Đã hiểu</Btn>
                  )}

                  {o.requiredUsers?.length > 0 && (
  <div style={{ fontSize: 12, opacity: 0.8 }}>
    Chưa hiểu:{" "}
    {o.requiredUsers
      .filter((u) => !(o.understoodBy || []).includes(u))
      .join(", ")}
  </div>
)}
                </>
              )}

              {o.type === "system_task" && (
                <Btn onClick={() => updateOrder(o.id, "done")}>✓ Đã xong</Btn>
              )}

              {isNormal(o) && (
                <>
                  {hasPermission(PERMISSIONS.EDIT_ORDER) && (
                    <Btn onClick={() => togglePin(o.id)} active={o.pinned}>
                      📌 Ghim
                    </Btn>
                  )}

                  {hasPermission(PERMISSIONS.MARK_DONE) && (
                    <Btn onClick={() => updateOrder(o.id, "done")}>✔ Đã xong</Btn>
                  )}
                </>
              )}
            </>
          </Card>
        ))}

      {/* 🟠 ĐÃ XONG */}
      <div style={S.section}>Đã xong</div>
      {sorted
  .filter((o) => showInDone(o))
  .map((o) => (
    <Card key={o.id} o={o} metaText={getMetaText(o, "done")}>
            <>
              {isNormal(o) && (
                <>
                  {hasPermission(PERMISSIONS.MARK_DELIVERED) && (
                    <Btn onClick={() => updateOrder(o.id, "shipped")}>🚚 Giao</Btn>
                  )}

                  {hasPermission(PERMISSIONS.COMPLETE_ORDER) && o.status !== "completed" && (
  <Btn onClick={() => updateOrder(o.id, "completed")}>🏁 Hoàn thành</Btn>
)}
                </>
              )}

              {hasPermission(PERMISSIONS.EDIT_ORDER) && (
                <Btn onClick={() => updateOrder(o.id, "reset")}>↩ Đưa lên</Btn>
              )}

              {isSystem(o) && hasPermission(PERMISSIONS.COMPLETE_ORDER) && (
                <Btn onClick={() => updateOrder(o.id, "completed")}>🏁 Hoàn thành</Btn>
              )}
            </>
          </Card>
        ))}

      {/* 🟢 ĐÃ GIAO */}
      <div style={S.section}>Đã giao</div>
      {sorted
  .filter((o) => showInDelivered(o))
  .map((o) => (
    <Card key={o.id} o={o} metaText={getMetaText(o, "delivered")}>
            <>
              {hasPermission(PERMISSIONS.COMPLETE_ORDER) && (
                <Btn onClick={() => updateOrder(o.id, "completed")}>🏁 Hoàn thành</Btn>
              )}
              {hasPermission(PERMISSIONS.EDIT_ORDER) && (
                <Btn onClick={() => updateOrder(o.id, "reset")}>↩ Đưa lên</Btn>
              )}
            </>
          </Card>
        ))}

      {/* ⚫ HOÀN THÀNH */}
      <div style={S.section}>Hoàn thành</div>
      {sorted.filter((o) => showInCompleted(o)).map((o) => (
  <Card key={o.id} o={o} metaText={getMetaText(o, "completed")}>
          {hasPermission(PERMISSIONS.EDIT_ORDER) && (
            <Btn onClick={() => updateOrder(o.id, "reset")}>↩ Đưa lên</Btn>
          )}
        </Card>
      ))}

      <BottomNav active="home" />
    </div>
  );
}