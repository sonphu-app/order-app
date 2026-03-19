import { enablePushNotifications, syncPushHeartbeat } from "../utils/push";
import { refreshCurrentUser } from "../utils/auth";
import { useNavigate } from "react-router-dom";
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
const navigate = useNavigate();
console.log("HOME REALTIME VERSION 1");
  const [orders, setOrders] = useState([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState(null);
const [users, setUsers] = useState([]);
const [orderUnreadMap, setOrderUnreadMap] = useState({});
const [groupUnreadCount, setGroupUnreadCount] = useState(0);

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
const loadUsersSupabase = async () => {
  const { data, error } = await supabase
    .from("users")
    .select("id, name, username");

  if (error) {
    console.log("LOAD USERS ERROR:", error);
    return;
  }

  setUsers(data || []);
};
const loadOrderUnreadCounts = async () => {
  const me = getCurrentUser();
  if (!me?.id) return;

  const { data, error } = await supabase
    .from("order_messages")
    .select("id, order_id, sender_id, seen_by");

  if (error) {
    console.log("LOAD ORDER UNREAD ERROR:", error);
    return;
  }

  const map = {};

  (data || []).forEach((m) => {
    const isMine = m.sender_id === me.id;
    const seenBy = Array.isArray(m.seen_by) ? m.seen_by : [];
    const unread = !isMine && !seenBy.includes(me.id);

    if (unread) {
      map[m.order_id] = (map[m.order_id] || 0) + 1;
    }
  });

  setOrderUnreadMap(map);
};

const loadGroupUnreadCount = async () => {
  const me = getCurrentUser();
  if (!me?.id) return;

  const { data, error } = await supabase
    .from("group_messages")
    .select("id, sender_id, seen_by");

  if (error) {
    console.log("LOAD GROUP UNREAD ERROR:", error);
    return;
  }

  const count = (data || []).filter((m) => {
    const isMine = m.sender_id === me.id;
    const seenBy = Array.isArray(m.seen_by) ? m.seen_by : [];
    return !isMine && !seenBy.includes(me.id);
  }).length;

  setGroupUnreadCount(count);
};
const getUserName = (id) => {
  const u = users.find((x) => x.id === id);
  return u?.name || u?.username || id;
};
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
  const run = async () => {
    await refreshCurrentUser();
    await loadOrdersSupabase();
    await loadUsersSupabase();
    await loadOrderUnreadCounts();
    await loadGroupUnreadCount();
await syncPushHeartbeat();
  };
  run();
}, []);
useEffect(() => {
  const channel = supabase
    .channel("home-realtime")
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
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "order_messages",
      },
      () => {
        loadOrderUnreadCounts();
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "group_messages",
      },
      () => {
        loadGroupUnreadCount();
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

const threeDaysAgo = new Date(today);
threeDaysAgo.setDate(today.getDate() - 2);

const yesterday = new Date(today);
yesterday.setDate(today.getDate() - 1);

const sevenDaysAgo = new Date(today);
sevenDaysAgo.setDate(today.getDate() - 7);

let timeFiltered = orders;

// thời gian để lọc: ưu tiên lần cập nhật cuối, fallback về ngày tạo
const safeFilterTime = (o) =>
  new Date(o.lastActionAt || o.updated_at || o.createdAt || o.created_at || 0);

// MỞ APP: không nút nào sáng, nhưng hiện 3 ngày gần nhất
if (filter === null) {
  timeFiltered = orders.filter((o) => {
    const isCompletedButNotDelivered =
      o.status === "completed" && !o.deliveredByName;

    const shouldAlwaysShow = (() => {
  const isSystem = o.type === "system_task" || o.type === "system_message";

  if (isSystem) {
    return o.status !== "completed";
  }

  return o.status !== "completed" || !o.deliveredByName;
})();

    if (shouldAlwaysShow) return true;

    const t = safeFilterTime(o);
    return t >= threeDaysAgo;
  });
}

// BẤM "HÔM NAY": chỉ đúng hôm nay
if (filter === "today") {
  timeFiltered = orders.filter((o) => {
    const isCompletedButNotDelivered =
      o.status === "completed" && !o.deliveredByName;

    const shouldAlwaysShow = (() => {
  const isSystem = o.type === "system_task" || o.type === "system_message";

  if (isSystem) {
    return o.status !== "completed";
  }

  return o.status !== "completed" || !o.deliveredByName;
})();

    if (shouldAlwaysShow) return true;

    const t = safeFilterTime(o);
    return t >= today;
  });
}

if (filter === "yesterday") {
  timeFiltered = orders.filter((o) => {
    const t = safeFilterTime(o);
    return t >= yesterday && t < today;
  });
}

if (filter === "7days") {
  timeFiltered = orders.filter((o) => {
    const t = safeFilterTime(o);
    return t >= sevenDaysAgo;
  });
}

// ✅ custom date
if (filter && typeof filter === "object" && filter.type === "custom") {
  const fromDate = new Date(filter.from);
  const toDate = new Date(filter.to);
  toDate.setHours(23, 59, 59, 999);

  timeFiltered = orders.filter((o) => {
    const t = safeFilterTime(o);
    return t >= fromDate && t <= toDate;
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
  const now = new Date().toISOString();

  let updateData = {};

  if (action === "reset") {
    updateData = {
      status: "new",
      done_by_name: "",
      delivered_by_name: "",
      completed_by_name: "",
      updated_at: now,
    };
  }

  if (action === "done") {
    updateData = {
      status: "done",
      done_by_name: actorName,
      updated_at: now,
    };
  }

  if (action === "shipped") {
    updateData = {
      status: current.status === "completed" ? "completed" : "delivered",
      delivered_by_name: actorName,
      updated_at: now,
    };
  }

  if (action === "completed") {
    updateData = {
      status: "completed",
      completed_by_name: actorName,
      updated_at: now,
    };
  }

  if (action === "ack" && current.type === "system_message") {
    const old = Array.isArray(current.understoodBy)
      ? current.understoodBy
      : Array.isArray(current.understood_by)
      ? current.understood_by
      : [];

    const nextUnderstood =
      me?.id && !old.includes(me.id) ? [...old, me.id] : old;

    updateData.understood_by = nextUnderstood;
    updateData.updated_at = now;

    const required = Array.isArray(current.requiredUsers)
      ? current.requiredUsers
      : Array.isArray(current.required_users)
      ? current.required_users
      : [];

    const allUnderstood =
      required.length > 0 &&
      required.every((userId) => nextUnderstood.includes(userId));

    if (allUnderstood) {
      updateData.status = "done";
      updateData.done_by_name = actorName;
    }
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
        onClick={() => navigate(`/order/${o.id}`)}
      >
        <div style={{ ...S.cardContent, position: "relative" }}>
{(orderUnreadMap[o.id] || 0) > 0 && (
  <div
    style={{
      position: "absolute",
      top: -6,
      right: -6,
      minWidth: 26,
      height: 26,
      borderRadius: 999,
      background: "#ff3b30",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 12,
      fontWeight: 700,
      padding: "0 8px",
      boxShadow: "0 0 0 3px rgba(255,255,255,0.08)",
      animation: "pulseBadge 1s infinite",
    }}
  >
    {orderUnreadMap[o.id]}
  </div>
)}
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
  const actionTime = o.lastActionAt || o.updated_at || o.createdAt || o.created_at;

  if (section === "new") {
    return `${formatTime(actionTime)} • ${o.createdByName || "Không rõ"}`;
  }
  if (section === "done") {
    return `${formatTime(actionTime)} • ${o.doneByName || "Không rõ"}`;
  }
  if (section === "delivered") {
    return `${formatTime(actionTime)} • ${o.deliveredByName || "Không rõ"}`;
  }
  if (section === "completed") {
    return `${formatTime(actionTime)} • ${o.completedByName || "Không rõ"}`;
  }
  return formatTime(actionTime);
};

  return (
    <div style={S.app}>
<style>
  {`
    @keyframes pulseBadge {
      0% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.08); opacity: 0.75; }
      100% { transform: scale(1); opacity: 1; }
    }
  `}
</style>
      <Header />
      <SearchBar value={q} onChange={setQ} />
      <FilterBar value={filter} onChange={setFilter} />

<div
  onClick={() => navigate("/chat")}
  style={{
    margin: "10px 0 16px",
    padding: "10px 14px",
    borderRadius: 12,
    background: groupUnreadCount > 0 ? "#7a1f1f" : "#1f1f1f",
    border: "1px solid #444",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    cursor: "pointer",
    animation: groupUnreadCount > 0 ? "pulseBadge 1s infinite" : "none",
  }}
>
  <div style={{ fontWeight: 700 }}>💬 Chat nhóm</div>
  <div
    style={{
      minWidth: 28,
      height: 28,
      borderRadius: 999,
      background: groupUnreadCount > 0 ? "#ff3b30" : "#333",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 700,
      padding: "0 8px",
    }}
  >
    {groupUnreadCount}
  </div>
</div>

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
  .map(getUserName)
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