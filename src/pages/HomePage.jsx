import { syncPushHeartbeat } from "../utils/push";
import { refreshCurrentUser } from "../utils/auth";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { ensureWeeklySystemTask } from "../utils/systemTasks";
import { useEffect, useMemo, useState, useRef } from "react";
import Header from "../components/Header";
import FilterBar from "../components/FilterBar";
import BottomNav from "../components/BottomNav";
import { hasPermission, PERMISSIONS } from "../utils/permissions";
import { getCurrentUser } from "../utils/auth";
import { deleteLocal, getAllLocal, publishSyncEvent, putLocal, putManyLocal } from "../utils/localSync";
import { notifyNewOrder } from "../utils/push";
function formatTime(date) {
  const d = new Date(date);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${MM} ${hh}:${mm}`;
}

const HOME_VIEW_KEY = "sonphu-home-view";
let homeMemory = {
  orders: [],
  orderUnreadMap: {},
  groupUnreadCount: 0,
  loadedAt: 0,
};

function readHomeView() {
  try {
    return JSON.parse(sessionStorage.getItem(HOME_VIEW_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveHomeView(next) {
  try {
    sessionStorage.setItem(HOME_VIEW_KEY, JSON.stringify(next));
  } catch {
    // Trình duyệt chặn sessionStorage thì app vẫn hoạt động bằng bộ nhớ tạm.
  }
}

const defaultFilterForStatus = (status) => status === "completed" ? "today" : "all";

// Thẻ dùng một màu trung tính; trạng thái đã được tách thành từng tab riêng.
const getCardColor = () => "#202020";
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
    paddingBottom: 176,
    color: "white",
  },
  section: { fontSize: 26, fontWeight: 800, margin: "20px 0 10px" },
  card: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    maxWidth: "100%",
    overflow: "hidden",
    border: "1px solid #3b3b3b",
    boxShadow: "0 5px 12px rgba(0,0,0,.3)",
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
  statusBar: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: "calc(56px + env(safe-area-inset-bottom))",
    zIndex: 19,
    height: 50,
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    background: "#161616",
    borderTop: "1px solid #343434",
    padding: "4px 6px",
    gap: 4,
  },
  quickBar: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: "calc(106px + env(safe-area-inset-bottom))",
    zIndex: 19,
    minHeight: 48,
    display: "flex",
    gap: 8,
    alignItems: "center",
    background: "#161616",
    borderTop: "1px solid #343434",
    padding: "5px 10px",
    boxSizing: "border-box",
  },
  quickInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    maxHeight: 64,
    borderRadius: 10,
    border: "1px solid #444",
    background: "#242424",
    color: "#fff",
    padding: "8px 11px",
    resize: "none",
    lineHeight: 1.25,
    fontFamily: "inherit",
  },
  quickButton: {
    height: 36,
    border: 0,
    borderRadius: 10,
    background: "#2ecc71",
    color: "#111",
    fontWeight: 800,
    padding: "0 14px",
  },
  statusTab: (active) => ({
    minWidth: 0,
    border: active ? "1px solid #d9d9d9" : "1px solid transparent",
    borderRadius: 10,
    background: active ? "#f1f1f1" : "transparent",
    color: active ? "#111" : "#bcbcbc",
    fontSize: 12,
    fontWeight: 750,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    padding: "5px 3px",
    cursor: "pointer",
  }),
  statusCount: {
    minWidth: 18,
    height: 18,
    padding: "0 4px",
    borderRadius: 999,
    background: "#d83a3a",
    color: "white",
    fontSize: 10,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  unreadCount: {
    minWidth: 18,
    height: 18,
    padding: "0 4px",
    borderRadius: 999,
    background: "#2589d8",
    color: "white",
    fontSize: 10,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 0 0 2px rgba(37,137,216,.18)",
  },
};

export default function Home() {
const navigate = useNavigate();
const location = useLocation();
  const savedView = useMemo(() => readHomeView(), []);
  const [orders, setOrders] = useState(() => homeMemory.orders);
  const [q, setQ] = useState(() => savedView.q || "");
  const [quickText, setQuickText] = useState("");
  const [quickSubmitting, setQuickSubmitting] = useState(false);
  const [statusTab, setStatusTab] = useState(() => savedView.statusTab || "new");
  const [filter, setFilter] = useState(() => defaultFilterForStatus(savedView.statusTab || "new"));
const [users, setUsers] = useState([]);
const [orderUnreadMap, setOrderUnreadMap] = useState(() => homeMemory.orderUnreadMap);
const [groupUnreadCount, setGroupUnreadCount] = useState(() => homeMemory.groupUnreadCount);
const [focusOrderId, setFocusOrderId] = useState(() => location.state?.focusOrderId || null);
const restoredScrollRef = useRef(false);
const handledNavigationRef = useRef(false);
const realtimeReadyRef = useRef(false);

useEffect(() => {
  homeMemory = { ...homeMemory, orders, orderUnreadMap, groupUnreadCount };
}, [orders, orderUnreadMap, groupUnreadCount]);

useEffect(() => {
  saveHomeView({ q, filter, statusTab, scrollY: window.scrollY });
}, [q, filter, statusTab]);

useEffect(() => {
  setFilter(defaultFilterForStatus(statusTab));
}, [statusTab]);

useEffect(() => {
  if (restoredScrollRef.current || orders.length === 0) return;
  restoredScrollRef.current = true;
  requestAnimationFrame(() => window.scrollTo({ top: Number(savedView.scrollY) || 0, behavior: "auto" }));
}, [orders.length, savedView.scrollY]);

useEffect(() => () => {
  saveHomeView({ q, filter, statusTab, scrollY: window.scrollY });
}, [q, filter, statusTab]);

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
  doneAt: row.done_at || null,
  deliveredAt: row.delivered_at || null,
  completedAt: row.completed_at || null,
});

useEffect(() => {
  if (handledNavigationRef.current || !location.state) return;
  handledNavigationRef.current = true;
  const incoming = location.state.createdOrder;
  const nextTab = location.state.statusTab || "new";
  setStatusTab(nextTab);
  setQ("");
  if (incoming?.id) {
    const normalized = normalizeOrder(incoming);
    setOrders((current) => [normalized, ...current.filter((item) => item.id !== normalized.id)]);
    setFocusOrderId(incoming.id);
  } else if (location.state.focusOrderId) {
    setFocusOrderId(location.state.focusOrderId);
  }
  navigate("/", { replace: true, state: null });
}, [location.state, navigate]);
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
    const cached = await getAllLocal("orders");
    if (cached.length > 0) {
      setOrders(cached.map(normalizeOrder));
    }

    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      console.log("LOAD ORDERS ERROR:", error);
      return;
    }

    const cachedById = new Map(cached.map((row) => [row.id, row]));
    (data || []).forEach((row) => cachedById.set(row.id, row));
    let rows = [...cachedById.values()].map(normalizeOrder);
    await putManyLocal("orders", data || []);

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

  (reloadData || []).forEach((row) => cachedById.set(row.id, row));
  await putManyLocal("orders", reloadData || []);
  rows = [...cachedById.values()].map(normalizeOrder);
}

setOrders(rows);
homeMemory.loadedAt = Date.now();

  };

  useEffect(() => {
  const run = async () => {
    await refreshCurrentUser();
    if (Date.now() - homeMemory.loadedAt > 30_000) await loadOrdersSupabase();
    else {
      const cached = await getAllLocal("orders");
      if (cached.length) setOrders(cached.map(normalizeOrder));
    }
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
      async (payload) => {
        if (payload.eventType === "DELETE") {
          await deleteLocal("orders", payload.old.id);
          setOrders((current) => current.filter((order) => order.id !== payload.old.id));
          return;
        }
        await putLocal("orders", payload.new);
        const next = normalizeOrder(payload.new);
        setOrders((current) => {
          const exists = current.some((order) => order.id === next.id);
          return exists
            ? current.map((order) => order.id === next.id ? next : order)
            : [next, ...current];
        });
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
    .subscribe((status) => {
      realtimeReadyRef.current = status === "SUBSCRIBED";
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        console.log("HOME REALTIME:", status);
      }
    });

  return () => {
    realtimeReadyRef.current = false;
    supabase.removeChannel(channel);
  };
}, []);
useEffect(() => {
  const refreshFromLocal = async (event) => {
    const type = event.detail?.entity_type;
    if (type === "order" || type === "order_image") {
      const cached = await getAllLocal("orders");
      setOrders(cached.map(normalizeOrder));
    }
    if (type === "order_message") loadOrderUnreadCounts();
    if (type === "group_message") loadGroupUnreadCount();
  };
  window.addEventListener("sonphu-local-sync", refreshFromLocal);
  return () => window.removeEventListener("sonphu-local-sync", refreshFromLocal);
}, []);

// Dự phòng cho thiết bị iOS hoặc mạng chặn websocket Realtime.
useEffect(() => {
  let polling = false;
  const refresh = async (force = false) => {
    if (polling || (!force && realtimeReadyRef.current) || document.visibilityState !== "visible") return;
    polling = true;
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("updated_at", { ascending: false });
      if (!error && data) {
        await putManyLocal("orders", data);
        setOrders(data.map(normalizeOrder));
      }
      await Promise.all([loadOrderUnreadCounts(), loadGroupUnreadCount()]);
    } finally {
      polling = false;
    }
  };
  const onFocus = () => refresh(true);
  const timer = window.setInterval(refresh, 15000);
  window.addEventListener("focus", onFocus);
  return () => {
    clearInterval(timer);
    window.removeEventListener("focus", onFocus);
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

// Mỗi mục lọc theo đúng thời điểm của trạng thái đó.
const safeFilterTime = (o) => {
  const value = statusTab === "new"
    ? o.createdAt || o.created_at
    : statusTab === "done"
    ? o.doneAt || o.done_at || o.updated_at
    : statusTab === "delivered"
    ? o.deliveredAt || o.delivered_at || o.updated_at
    : o.completedAt || o.completed_at || o.updated_at;
  return new Date(value || 0);
};

// BẤM "HÔM NAY": chỉ đúng hôm nay
if (filter === "today") {
  timeFiltered = orders.filter((o) => {
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
  const searchSource = q.trim() ? orders : timeFiltered;
  const finalFiltered = searchSource.filter((o) => {
    const text = [o.title, o.content, o.phone, o.customer_name, o.createdByName]
      .filter(Boolean)
      .join(" ");
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

  const nextOrder = { ...current, pinned: !current.pinned, updated_at: new Date().toISOString() };
  await putLocal("orders", nextOrder);
  await publishSyncEvent({ entityType: "order", entityId: id, payload: nextOrder });

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
      needs_rework: true,
      done_by_name: "",
      delivered_by_name: "",
      completed_by_name: "",
      done_at: null,
      delivered_at: null,
      completed_at: null,
      updated_at: now,
    };
  }

  if (action === "done") {
    updateData = {
      status: "done",
      needs_rework: false,
      done_by_name: actorName,
      done_at: now,
      updated_at: now,
    };
  }

  if (action === "shipped") {
    updateData = {
      status: current.status === "completed" ? "completed" : "delivered",
      delivered_by_name: actorName,
      delivered_at: now,
      updated_at: now,
    };
  }

  if (action === "completed") {
    updateData = {
      status: "completed",
      completed_by_name: actorName,
      completed_at: now,
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
      updateData.done_at = now;
      updateData.needs_rework = false;
    }
  }

  const { error } = await supabase
    .from("orders")
    .update(updateData)
    .eq("id", id);

  if (error) {
    console.log("UPDATE ERROR:", error);
    return;
  }

  const nextOrder = { ...current, ...updateData };
  await putLocal("orders", nextOrder);
  setOrders((currentOrders) => currentOrders.map((item) => item.id === id ? normalizeOrder(nextOrder) : item));
  void publishSyncEvent({ entityType: "order", entityId: id, payload: nextOrder });

  const nextTab = action === "reset"
    ? "new"
    : action === "done" || (action === "ack" && updateData.status === "done")
    ? "done"
    : action === "shipped" && updateData.status !== "completed"
    ? "delivered"
    : action === "completed" || updateData.status === "completed"
    ? "completed"
    : statusTab;
  setQ("");
  setStatusTab(nextTab);
  setFocusOrderId(id);
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
        id={`order-${o.id}`}
        style={{
          ...S.card,
          background: getCardColor(o),
          ...(focusOrderId === o.id ? {
            border: "2px solid #2ecc71",
            boxShadow: "0 0 0 3px rgba(46,204,113,.18), 0 6px 14px rgba(0,0,0,.35)",
          } : {}),
        }}
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

          {o.customer_name && (
            <div style={{ color: "#f1c75b", fontWeight: 800, fontSize: 15 }}>
              👤 {o.customer_name}
            </div>
          )}

          {o.needs_rework && (
            <div style={{ color: "#ffcf5a", fontWeight: 900, fontSize: 13 }}>
              🔁 CẦN LÀM LẠI
            </div>
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
  const actionTime = section === "done"
    ? (o.doneAt || o.lastActionAt)
    : section === "delivered"
    ? (o.deliveredAt || o.lastActionAt)
    : section === "completed"
    ? (o.completedAt || o.lastActionAt)
    : (o.createdAt || o.lastActionAt);

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

const createQuickOrder = async () => {
  const lines = quickText.trim().split("\n");
  const title = (lines.shift() || "").trim();
  const content = lines.join("\n").trim();
  if (!title || quickSubmitting || !hasPermission(PERMISSIONS.CREATE_ORDER)) return;
  setQuickSubmitting(true);
  const me = getCurrentUser() || {};
  const { data, error } = await supabase.from("orders").insert({
    type: "normal",
    title,
    content,
    status: "new",
    needs_rework: false,
    pinned: false,
    created_by: me.id || null,
    created_by_name: me.name || me.username || "Không rõ",
    has_image: false,
    understood_by: [],
    required_users: [],
  }).select().single();
  setQuickSubmitting(false);
  if (error || !data) {
    alert("Chưa tạo được đơn. Vui lòng thử lại.");
    return;
  }
  setQuickText("");
  await putLocal("orders", data);
  setOrders((current) => [normalizeOrder(data), ...current.filter((item) => item.id !== data.id)]);
  setStatusTab("new");
  setFocusOrderId(data.id);
  void publishSyncEvent({ entityType: "order", entityId: data.id, payload: data });
  void notifyNewOrder({ id: data.id, title, content });
};

const unreadIn = (list) => list.reduce(
  (total, orderItem) => total + (orderUnreadMap[orderItem.id] || 0),
  0
);
const newOrders = sorted.filter((o) => o.status === "new");
const doneOrders = sorted.filter(showInDone);
const deliveredOrders = sorted.filter(showInDelivered);
const completedOrders = sorted.filter(showInCompleted);
const statusTabs = [
  { key: "new", label: "Đơn mới", count: newOrders.length, unread: unreadIn(newOrders) },
  { key: "done", label: "Đã xong", count: doneOrders.length, unread: unreadIn(doneOrders) },
  { key: "delivered", label: "Đã giao", count: deliveredOrders.length, unread: unreadIn(deliveredOrders) },
  { key: "completed", label: "Hoàn thành", count: completedOrders.length, unread: unreadIn(completedOrders) },
];

const visibleOrders = q.trim() ? sorted : sorted.filter((o) => {
  if (statusTab === "new") return o.status === "new";
  if (statusTab === "done") return showInDone(o);
  if (statusTab === "delivered") return showInDelivered(o);
  return showInCompleted(o);
});

useEffect(() => {
  if (!focusOrderId || !visibleOrders.some((item) => item.id === focusOrderId)) return;
  const timer = setTimeout(() => {
    document.getElementById(`order-${focusOrderId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 80);
  const clearTimer = setTimeout(() => setFocusOrderId(null), 3500);
  return () => {
    clearTimeout(timer);
    clearTimeout(clearTimer);
  };
}, [focusOrderId, visibleOrders]);

const sectionForOrder = (orderItem) => {
  if (orderItem.status === "new") return "new";
  if (orderItem.status === "done") return "done";
  if (orderItem.status === "delivered") return "delivered";
  return "completed";
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
      <Header searchValue={q} onSearchChange={setQ} />
      <FilterBar value={filter} onChange={setFilter} />

      <div style={S.section}>{q.trim() ? "Kết quả tìm kiếm" : statusTabs.find((tab) => tab.key === statusTab)?.label}</div>
      {visibleOrders.map((o) => {
        const cardSection = q.trim() ? sectionForOrder(o) : statusTab;
        return (
        <Card key={o.id} o={o} metaText={getMetaText(o, cardSection)}>
          <>
            {cardSection === "new" && o.type === "system_message" && (
              <>
                {hasPermission(PERMISSIONS.MARK_DONE) && o.created_by !== getCurrentUser()?.id && (
                  <Btn onClick={() => updateOrder(o.id, "ack")}>👁 Đã hiểu</Btn>
                )}
                {o.requiredUsers?.length > 0 && (
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    Chưa hiểu: {o.requiredUsers
                      .filter((u) => u !== o.created_by && !(o.understoodBy || []).includes(u))
                      .map(getUserName)
                      .join(", ") || "Không còn ai"}
                  </div>
                )}
              </>
            )}

            {cardSection === "new" && o.type === "system_task" && (
              <Btn onClick={() => updateOrder(o.id, "done")}>✓ Đã xong</Btn>
            )}

            {cardSection === "new" && isNormal(o) && (
              <>
                {hasPermission(PERMISSIONS.EDIT_ORDER) && (
                  <Btn onClick={() => togglePin(o.id)} active={o.pinned}>
                    📌 {o.pinned ? "Ưu tiên" : "Ghim"}
                  </Btn>
                )}
                {hasPermission(PERMISSIONS.MARK_DONE) && (
                  <Btn onClick={() => updateOrder(o.id, "done")}>✔ Đã xong</Btn>
                )}
              </>
            )}

            {cardSection === "done" && isNormal(o) && (
              <>
                {hasPermission(PERMISSIONS.MARK_DELIVERED) && (
                  <Btn onClick={() => updateOrder(o.id, "shipped")}>🚚 Giao</Btn>
                )}
                {hasPermission(PERMISSIONS.COMPLETE_ORDER) && o.status !== "completed" && (
                  <Btn onClick={() => updateOrder(o.id, "completed")}>🏁 Hoàn thành</Btn>
                )}
              </>
            )}

            {cardSection === "done" && isSystem(o) && hasPermission(PERMISSIONS.COMPLETE_ORDER) && (
              <Btn onClick={() => updateOrder(o.id, "completed")}>🏁 Hoàn thành</Btn>
            )}

            {cardSection === "delivered" && hasPermission(PERMISSIONS.COMPLETE_ORDER) && (
              <Btn onClick={() => updateOrder(o.id, "completed")}>🏁 Hoàn thành</Btn>
            )}

            {(cardSection === "done" || cardSection === "delivered") &&
              !(o.status === "completed" && o.deliveredByName) &&
              hasPermission(PERMISSIONS.EDIT_ORDER) && (
                <Btn onClick={() => updateOrder(o.id, "reset")}>↩ Làm lại</Btn>
              )}
          </>
        </Card>
      );})}

      {visibleOrders.length === 0 && (
        <div style={{ color: "#888", textAlign: "center", padding: "36px 12px" }}>Chưa có đơn trong mục này.</div>
      )}

      {hasPermission(PERMISSIONS.CREATE_ORDER) && (
        <div style={S.quickBar}>
          <textarea
            style={S.quickInput}
            rows={1}
            enterKeyHint="enter"
            value={quickText}
            onChange={(event) => setQuickText(event.target.value)}
            placeholder="Nhập nhanh một đơn mới..."
          />
          <button type="button" onClick={createQuickOrder} style={S.quickButton} disabled={quickSubmitting || !quickText.trim()}>
            {quickSubmitting ? "..." : "Tạo"}
          </button>
        </div>
      )}

      <div style={S.statusBar}>
        {statusTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setStatusTab(tab.key);
              window.scrollTo({ top: 0, behavior: "auto" });
            }}
            style={S.statusTab(statusTab === tab.key)}
          >
            {tab.unread > 0
              ? <b style={S.unreadCount}>{tab.unread > 99 ? "99+" : tab.unread}</b>
              : <span style={{ width: 18, flexShrink: 0 }} />}
            <span>{tab.label}</span>
            {tab.count > 0
              ? <b style={S.statusCount}>{tab.count > 99 ? "99+" : tab.count}</b>
              : <span style={{ width: 18, flexShrink: 0 }} />}
          </button>
        ))}
      </div>

      <BottomNav active="home" chatBadge={groupUnreadCount} />
    </div>
  );
}
