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
const getCardColor = () => "#fffaf0";
// 🔘 BUTTON
const Btn = ({ children, onClick, active, disabled = false }) => (
  <button
    onClick={(e) => {
      e.stopPropagation();
      if (!disabled && onClick) onClick();
    }}
    disabled={disabled}
    style={{
      background: disabled ? "#eee7da" : active ? "#f2d58f" : "#fff3d6",
      border: "1px solid #d1aa62",
      color: disabled ? "#9a8f80" : "#4d3218",
      fontSize: 15,
      padding: "7px 11px",
      borderRadius: 20,
      cursor: disabled ? "not-allowed" : "pointer",
      fontWeight: 600,
      opacity: disabled ? 0.7 : 1,
    }}
  >
    {children}
  </button>
);

// 🎨 STYLE
const S = {
  cardContent: { display: "flex", flexDirection: "column", gap: 8 },
  attachmentNote: { marginTop: 6, fontSize: 17, color: "#5f4a32", fontWeight: 650 },

  app: {
    minHeight: "100dvh",
    background: "#f5efe3",
    padding: 14,
    paddingBottom: 176,
    color: "#3d2b1b",
  },
  section: { fontSize: 28, fontWeight: 850, margin: "20px 0 12px", color: "#5b3716" },
  card: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    maxWidth: "100%",
    overflow: "hidden",
    border: "1px solid #d8b36a",
    boxShadow: "0 4px 14px rgba(91,55,22,.13)",
  },
  systemHeader: {
    fontSize: 17,
    fontWeight: "bold",
    color: "#6f430d",
    marginBottom: 6,
    textTransform: "uppercase",
  },
  orderTitleHeader: {
    display: "flex",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: 6,
    minWidth: 0,
    lineHeight: 1.25,
    color: "#6f430d",
    marginBottom: 6,
    whiteSpace: "normal",
  },
  priorityInlineLabel: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    padding: "3px 7px",
    borderRadius: 20,
    background: "#ffd166",
    color: "#171717",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  reworkInlineLabel: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    padding: "3px 7px",
    borderRadius: 20,
    background: "#ffd166",
    color: "#171717",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  orderTitleText: {
    flex: "1 1 140px",
    minWidth: 0,
    overflow: "visible",
    whiteSpace: "normal",
    wordBreak: "break-word",
    overflowWrap: "anywhere",
    fontSize: 20,
    fontWeight: 800,
    color: "#6f430d",
  },
  title: { fontSize: 22, fontWeight: 800 },
  time: { fontSize: 17, color: "#745b3d" },
  text: {
    fontSize: 21,
    lineHeight: 1.6,
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
    background: "#fff7e6",
    borderTop: "1px solid #d8b36a",
    boxShadow: "0 -3px 12px rgba(91,55,22,.12)",
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
    background: "#fff7e6",
    borderTop: "1px solid #d8b36a",
    padding: "5px 10px",
    boxSizing: "border-box",
  },
  quickInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    maxHeight: 140,
    borderRadius: 10,
    border: "1px solid #d1aa62",
    background: "#fffaf0",
    color: "#3d2b1b",
    padding: "8px 11px",
    resize: "none",
    overflowY: "auto",
    lineHeight: 1.4,
    fontSize: 17,
    fontFamily: "inherit",
  },
  quickButton: {
    height: 40,
    border: 0,
    borderRadius: 10,
    background: "#d3a13f",
    color: "#3d260d",
    fontWeight: 800,
    padding: "0 14px",
  },
  statusTab: (active) => ({
    minWidth: 0,
    border: active ? "1px solid #a8731f" : "1px solid transparent",
    borderRadius: 10,
    background: active ? "#f2d58f" : "transparent",
    color: active ? "#5b3716" : "#745b3d",
    fontSize: 14,
    fontWeight: 750,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    padding: "5px 3px",
    cursor: "pointer",
  }),
  statusCount: {
    minWidth: 16,
    height: 16,
    padding: "0 4px",
    borderRadius: 999,
    background: "#2589d8",
    color: "white",
    fontSize: 11,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  unreadCount: {
    minWidth: 18,
    height: 18,
    padding: "0 4px",
    borderRadius: 999,
    background: "#d83a3a",
    color: "white",
    fontSize: 12,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 0 0 2px rgba(216,58,58,.18)",
  },
  warehouseControls: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    justifyContent: "flex-end",
  },
  warehouseButton: (done) => ({
    width: 78,
    minHeight: 42,
    borderRadius: 9,
    border: done ? "1px solid #167447" : "1px solid #b88934",
    background: done ? "#dff5e9" : "#fff3d6",
    color: done ? "#0f6039" : "#5b3716",
    fontSize: 14,
    lineHeight: 1.15,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: done ? "0 2px 5px rgba(22,116,71,.18)" : "0 2px 5px rgba(91,55,22,.14)",
  }),
};

export default function Home() {
const navigate = useNavigate();
const location = useLocation();
  const savedView = useMemo(() => readHomeView(), []);
  const [orders, setOrders] = useState(() => homeMemory.orders);
  const [q, setQ] = useState(() => savedView.q || "");
  const [quickText, setQuickText] = useState("");
  const [quickSubmitting, setQuickSubmitting] = useState(false);
  const quickInputRef = useRef(null);
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
    const input = quickInputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  }, [quickText]);

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
  warehouseADone: Boolean(row.warehouse_a_done),
  warehouseBDone: Boolean(row.warehouse_b_done),
  warehouseADoneByName: row.warehouse_a_done_by_name || "",
  warehouseBDoneByName: row.warehouse_b_done_by_name || "",
  warehouseADoneAt: row.warehouse_a_done_at || null,
  warehouseBDoneAt: row.warehouse_b_done_at || null,
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
const loadOrderUnreadCounts = async (orderId = null) => {
  const me = getCurrentUser();
  if (!me?.id) return;

  let unreadQuery = supabase
    .from("order_messages")
    .select("id, order_id, sender_id, seen_by");
  if (orderId) unreadQuery = unreadQuery.eq("order_id", orderId);
  const { data, error } = await unreadQuery;

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

  if (orderId) {
    setOrderUnreadMap((current) => {
      const next = { ...current };
      if (map[orderId]) next[orderId] = map[orderId];
      else delete next[orderId];
      return next;
    });
  } else {
    setOrderUnreadMap(map);
  }
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
      (payload) => {
        loadOrderUnreadCounts(payload.new?.order_id || payload.old?.order_id || null);
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
  const handleMessagesSeen = (event) => {
    const orderId = event.detail?.orderId;
    if (orderId) void loadOrderUnreadCounts(orderId);
  };
  window.addEventListener("order-messages-seen", handleMessagesSeen);
  return () => window.removeEventListener("order-messages-seen", handleMessagesSeen);
}, []);

// Giữ các nhiệm vụ định kỳ xuất hiện đúng giờ kể cả khi màn hình chính đang mở liên tục.
useEffect(() => {
  let checking = false;
  const checkScheduledTasks = async () => {
    if (checking || document.visibilityState !== "visible") return;
    checking = true;
    try {
      const created = await ensureWeeklySystemTask(orders);
      if (created) await loadOrdersSupabase();
    } finally {
      checking = false;
    }
  };
  const timer = window.setInterval(checkScheduledTasks, 30_000);
  return () => window.clearInterval(timer);
}, [orders]);

useEffect(() => {
  const refreshFromLocal = async (event) => {
    const type = event.detail?.entity_type;
    if (type === "order" || type === "order_image") {
      const cached = await getAllLocal("orders");
      setOrders(cached.map(normalizeOrder));
    }
    if (type === "order_message") loadOrderUnreadCounts(event.detail?.payload?.order_id || null);
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
      const cached = await getAllLocal("orders");
      const latestCachedAt = cached.reduce((latest, row) => {
        const value = new Date(row.updated_at || row.created_at || 0).getTime();
        return value > latest ? value : latest;
      }, 0);
      let ordersQuery = supabase
        .from("orders")
        .select("*")
        .order("updated_at", { ascending: false });
      if (!force && latestCachedAt > 0) {
        ordersQuery = ordersQuery.gt("updated_at", new Date(latestCachedAt).toISOString());
      }
      const { data, error } = await ordersQuery;
      if (!error && data?.length) {
        await putManyLocal("orders", data);
        if (force) {
          setOrders(data.map(normalizeOrder));
        } else {
          setOrders((current) => {
            const merged = new Map(current.map((row) => [row.id, row]));
            data.forEach((row) => merged.set(row.id, normalizeOrder(row)));
            return [...merged.values()].sort((a, b) =>
              new Date(b.lastActionAt || b.createdAt).getTime() - new Date(a.lastActionAt || a.createdAt).getTime()
            );
          });
        }
      }
      await Promise.all([loadOrderUnreadCounts(), loadGroupUnreadCount()]);
    } finally {
      polling = false;
    }
  };
  const onFocus = () => refresh(true);
  const timer = window.setInterval(refresh, 60000);
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
      warehouse_a_done: false,
      warehouse_a_done_by_name: "",
      warehouse_a_done_at: null,
      warehouse_b_done: false,
      warehouse_b_done_by_name: "",
      warehouse_b_done_at: null,
      updated_at: now,
    };
  }

  if (action === "done") {
    if ((!current.type || current.type === "normal") &&
        (!current.warehouseADone || !current.warehouseBDone)) {
      window.alert("Cần hoàn thành cả Kho A và Kho B trước khi bấm Đã xong.");
      return;
    }
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
  const { error: historyError } = await supabase.from("order_edit_history").insert({
    order_id: id,
    editor_id: me?.id || null,
    editor_name: actorName,
    action: "status",
    before_data: {
      status: current.status || "",
      done_by_name: current.doneByName || current.done_by_name || "",
      delivered_by_name: current.deliveredByName || current.delivered_by_name || "",
      completed_by_name: current.completedByName || current.completed_by_name || "",
    },
    after_data: {
      status: updateData.status || current.status || "",
      done_by_name: updateData.done_by_name || current.doneByName || "",
      delivered_by_name: updateData.delivered_by_name || current.deliveredByName || "",
      completed_by_name: updateData.completed_by_name || current.completedByName || "",
    },
  });
  if (historyError) console.log("SAVE STATUS HISTORY ERROR:", historyError);

  await putLocal("orders", nextOrder);
  setOrders((currentOrders) => currentOrders.map((item) => item.id === id ? normalizeOrder(nextOrder) : item));
  void publishSyncEvent({ entityType: "order", entityId: id, payload: nextOrder });

  // Giữ nguyên mục và bộ lọc hiện tại sau khi đổi trạng thái.
};

const toggleWarehouse = async (id, warehouse) => {
  const current = orders.find((o) => o.id === id);
  if (!current || current.status !== "new" || !isNormal(current)) return;

  const me = getCurrentUser() || {};
  const actorName = me.name || me.username || "Không rõ";
  const now = new Date().toISOString();
  const isA = warehouse === "a";
  const wasDone = isA ? current.warehouseADone : current.warehouseBDone;
  const updateData = isA
    ? {
        warehouse_a_done: !wasDone,
        warehouse_a_done_by_name: wasDone ? "" : actorName,
        warehouse_a_done_at: wasDone ? null : now,
        updated_at: now,
      }
    : {
        warehouse_b_done: !wasDone,
        warehouse_b_done_by_name: wasDone ? "" : actorName,
        warehouse_b_done_at: wasDone ? null : now,
        updated_at: now,
      };

  const { data, error } = await supabase
    .from("orders")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    console.log("UPDATE WAREHOUSE ERROR:", error);
    window.alert("Chưa cập nhật được trạng thái kho. Vui lòng thử lại.");
    return;
  }

  const { error: historyError } = await supabase.from("order_edit_history").insert({
    order_id: id,
    editor_id: me.id || null,
    editor_name: actorName,
    action: isA ? "warehouse_a" : "warehouse_b",
    before_data: { done: wasDone },
    after_data: { done: !wasDone },
  });
  if (historyError) console.log("SAVE WAREHOUSE HISTORY ERROR:", historyError);

  await putLocal("orders", data);
  setOrders((currentOrders) => currentOrders.map((item) => item.id === id ? normalizeOrder(data) : item));
  void publishSyncEvent({ entityType: "order", entityId: id, payload: data });
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

    const displayTitle = o.customer_name || o.title || "";
    const isNormalOrder = !o.type || o.type === "normal";
    const hasOrderPanel = isNormalOrder;
    const fullText = (isNormalOrder ? "" : (displayTitle ? displayTitle + "\n" : "")) + (o.content || "");

    useEffect(() => {
      const el = textRef.current;
      if (!el) return;

      const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
      const maxHeight = lineHeight * 5;

      if (el.scrollHeight > maxHeight + 2) setShowToggle(true);
      else setShowToggle(false);
    }, [o.title, o.customer_name, o.content]);

    return (
      <div
        id={`order-${o.id}`}
        style={{
          ...S.card,
          position: "relative",
          background: getCardColor(o),
          ...(focusOrderId === o.id ? {
            border: "2px solid #c8952e",
            boxShadow: "0 0 0 3px rgba(46,204,113,.18), 0 6px 14px rgba(0,0,0,.35)",
          } : {}),
        }}
        onClick={() => navigate(`/order/${o.id}`)}
      >
        <div style={hasOrderPanel ? { display: "grid", gridTemplateColumns: "minmax(0, 1fr) clamp(118px, 22vw, 200px)", gap: 10 } : undefined}>
        <div
          style={{
            ...S.cardContent,
            position: "relative",
          }}
        >
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

          {isNormalOrder && (
            <div style={S.orderTitleHeader}>
              {o.pinned && o.status === "new" && <span style={S.priorityInlineLabel}>⭐ ĐƠN ƯU TIÊN</span>}
              {o.needs_rework && <span style={S.reworkInlineLabel}>🔁 CẦN LÀM LẠI</span>}
              <span style={S.orderTitleText}>📦 {displayTitle || "Đơn hàng"}</span>
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
                fontSize: 15,
                color: "#1266b3",
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
              style={{ fontSize: 16, color: "#745b3d", marginTop: 6, cursor: "pointer" }}
            >
              Thu gọn
            </div>
          )}

          {o.has_image && (
  <div style={S.attachmentNote}>📎 Có ảnh đính kèm</div>
)}
        </div>

        {hasOrderPanel && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div style={{ fontSize: 16, color: "#745b3d", textAlign: "right", lineHeight: 1.3 }}>
              {metaText || formatTime(o.lastActionAt || o.createdAt)}
            </div>
            {o.status === "new" && hasPermission(PERMISSIONS.MARK_DONE) && (
              <div style={S.warehouseControls}>
                <button
                  type="button"
                  style={S.warehouseButton(o.warehouseADone)}
                  title={o.warehouseADoneByName ? `Bấm bởi ${o.warehouseADoneByName}` : "Kho A chưa xong"}
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleWarehouse(o.id, "a");
                  }}
                >
                  {o.warehouseADone ? "✓ A xong" : "Kho A"}
                </button>
                <button
                  type="button"
                  style={S.warehouseButton(o.warehouseBDone)}
                  title={o.warehouseBDoneByName ? `Bấm bởi ${o.warehouseBDoneByName}` : "Kho B chưa xong"}
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleWarehouse(o.id, "b");
                  }}
                >
                  {o.warehouseBDone ? "✓ B xong" : "Kho B"}
                </button>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, flexWrap: "wrap" }}>
              {children}
            </div>
          </div>
        )}
        </div>

        {!hasOrderPanel && <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginTop: 10,
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 16, color: "#745b3d" }}>
  {metaText || formatTime(o.lastActionAt || o.createdAt)}
</div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {children}
          </div>
        </div>
        }
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
  const content = quickText.trim();
  const title = "";
  if (!content || quickSubmitting || !hasPermission(PERMISSIONS.CREATE_ORDER)) return;
  setQuickSubmitting(true);
const me = getCurrentUser() || {};
  const now = new Date().toISOString();
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
    updated_at: now,
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
                  <div style={{ fontSize: 16, color: "#745b3d" }}>
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
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                {hasPermission(PERMISSIONS.MARK_DONE) && (
                  <Btn
                    disabled={!o.warehouseADone || !o.warehouseBDone}
                    onClick={() => updateOrder(o.id, "done")}
                  >
                    ✔ Đã xong
                  </Btn>
                )}
                {hasPermission(PERMISSIONS.EDIT_ORDER) && (
                  <Btn onClick={() => togglePin(o.id)} active={o.pinned}>
                    📌 {o.pinned ? "Bỏ ưu tiên" : "Ghim"}
                  </Btn>
                )}
              </div>
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
        <div style={{ color: "#745b3d", fontSize: 18, textAlign: "center", padding: "36px 12px" }}>Chưa có đơn trong mục này.</div>
      )}

      {hasPermission(PERMISSIONS.CREATE_ORDER) && (
        <div style={S.quickBar}>
          <textarea
            ref={quickInputRef}
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
