import { syncPushHeartbeat } from "../utils/push";
import { refreshCurrentUser } from "../utils/auth";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { ensureRecurringSystemTasks, ensureWeeklySystemTask } from "../utils/systemTasks";
import { Fragment, useEffect, useMemo, useState, useRef } from "react";
import Header from "../components/Header";
import FilterBar from "../components/FilterBar";
import BottomNav from "../components/BottomNav";
import { hasPermission, PERMISSIONS } from "../utils/permissions";
import MentionTextarea from "../components/MentionTextarea";
import { notifyMention } from "../utils/mentions";
import { getCurrentUser } from "../utils/auth";
import { cacheImage, deleteLocal, getAllLocal, getLocalOrderImages, publishSyncEvent, putLocal, putManyLocal } from "../utils/localSync";
import { notifyNewOrder } from "../utils/push";
import CachedImage from "../components/CachedImage";
import { cleanMoneyInput, formatMoneyInput, parseMoneyInput } from "../utils/moneyInput";
import { createUuid } from "../utils/uuid";
function formatTime(date) {
  const d = new Date(date);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${MM} ${hh}:${mm}`;
}

const HOME_VIEW_KEY = "sonphu-home-view";
const HOME_RETURN_KEY = "sonphu-home-return";
let homeMemory = {
  orders: [],
  orderUnreadMap: {},
  orderActivityMap: {},
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

function getHomeScrollY() {
  const root = document.getElementById("root");
  return root ? root.scrollTop : window.scrollY;
}

function restoreHomeScrollY(scrollY) {
  const top = Number(scrollY) || 0;
  const root = document.getElementById("root");
  if (root) {
    root.scrollTo({ top, behavior: "auto" });
    return;
  }
  window.scrollTo({ top, behavior: "auto" });
}

function readHomeReturn() {
  try {
    return JSON.parse(sessionStorage.getItem(HOME_RETURN_KEY) || "null");
  } catch {
    return null;
  }
}

function saveHomeReturn(next) {
  try {
    sessionStorage.setItem(HOME_RETURN_KEY, JSON.stringify({ ...next, source: "order-detail" }));
  } catch {
    // Trình duyệt chặn sessionStorage thì app vẫn hoạt động bằng history state.
  }
}

function clearHomeReturn() {
  try {
    sessionStorage.removeItem(HOME_RETURN_KEY);
  } catch {
    // Ignore storage errors.
  }
}

const defaultFilterForStatus = (status) => status === "completed" ? "today" : "all";
const scaleOperatorFromSeries = (value) => {
  const text = String(value || "");
  const marker = text.lastIndexOf("::op:");
  if (marker < 0) return "";
  try { return decodeURIComponent(text.slice(marker + 5)); } catch { return text.slice(marker + 5); }
};
// Thẻ dùng một màu trung tính; trạng thái đã được tách thành từng tab riêng.
const getCardColor = () => "#fffaf0";
// 🔘 BUTTON
const Btn = ({ children, onClick, active, disabled = false }) => (
  <button
    onClick={(e) => {
      e.stopPropagation();
      if (!disabled && onClick) onClick(e);
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
  homeThumbnails: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 },
  homeThumbnail: { width: 112, height: 84, objectFit: "cover", borderRadius: 8, border: "1px solid #d1aa62", cursor: "default", userSelect: "none" },

  app: {
    minHeight: "100dvh",
    background: "#f5efe3",
    padding: 14,
    paddingBottom: 176,
    color: "#3d2b1b",
  },
  section: { fontSize: 28, fontWeight: 850, margin: "20px 0 12px", color: "#5b3716" },
  scaleNotice: {
    position: "fixed",
    top: 12,
    left: "50%",
    zIndex: 1000,
    width: "min(440px, calc(100vw - 24px))",
    transform: "translateX(-50%)",
    boxSizing: "border-box",
    padding: "12px 15px",
    border: "2px solid #138254",
    borderRadius: 12,
    background: "#eafff4",
    color: "#075b3a",
    boxShadow: "0 8px 24px rgba(0,0,0,.25)",
    fontSize: 16,
    fontWeight: 850,
    textAlign: "center",
  },
  card: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    maxWidth: "100%",
    overflow: "hidden",
    border: "1px solid #d8b36a",
    boxShadow: "0 4px 14px rgba(91,55,22,.13)",
  },
  cancelledCard: {
    width: "min(100%, 430px)",
    minHeight: 46,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    justifySelf: "center",
    cursor: "pointer",
    border: "2px solid #c0392b",
    boxShadow: "0 3px 10px rgba(140,35,25,.16)",
  },
  cancelledCardContent: {
    display: "grid",
    gap: 3,
    justifyItems: "center",
    textAlign: "center",
  },
  cancelledOrderLabel: {
    color: "#b42318",
    fontSize: 17,
    fontWeight: 950,
    letterSpacing: ".04em",
    textAlign: "center",
  },
  cancelledOrderTitle: {
    color: "#5b3716",
    fontSize: 16,
    fontWeight: 750,
    overflowWrap: "anywhere",
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
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    alignItems: "stretch",
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
    width: "100%",
    minWidth: 0,
    height: 34,
    minHeight: 34,
    maxHeight: 140,
    boxSizing: "border-box",
    borderRadius: 10,
    border: "1px solid #d1aa62",
    background: "#fffaf0",
    color: "#3d2b1b",
    padding: "4px 11px",
    resize: "none",
    overflowX: "hidden",
    overflowY: "auto",
    whiteSpace: "pre-wrap",
    lineHeight: "22px",
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
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
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
  quickPaymentOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1200,
    display: "grid",
    placeItems: "center",
    padding: 16,
    background: "rgba(30,20,10,.45)",
  },
  quickPaymentBox: {
    width: "min(520px, 100%)",
    boxSizing: "border-box",
    padding: 16,
    borderRadius: 14,
    background: "#fffaf0",
    boxShadow: "0 12px 36px rgba(0,0,0,.28)",
  },
  quickPaymentGrid: { display: "grid", gridTemplateColumns: "1fr", gap: 10 },
  quickPaymentInput: { display: "block", width: "100%", boxSizing: "border-box", marginTop: 5, minHeight: 46, padding: "9px 11px", border: "1px solid #d1aa62", borderRadius: 9, background: "#fff", color: "#3d2b1b", fontSize: 20, fontWeight: 700 },
  secondaryButton: { padding: "8px 14px", borderRadius: 8, border: "1px solid #d1aa62", background: "#fff3d6", color: "#4d3218", fontWeight: 700 },
  primaryButton: { padding: "8px 16px", borderRadius: 8, border: "1px solid #b27c1e", background: "#d3a13f", color: "#3d260d", fontWeight: 800 },
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
  quickPaymentButton: {
    width: 78,
    minHeight: 42,
    borderRadius: 9,
    border: "1px solid #b88934",
    background: "#fff3d6",
    color: "#5b3716",
    fontSize: 24,
    lineHeight: 1,
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 2px 5px rgba(91,55,22,.14)",
  },
};

export default function Home() {
const navigate = useNavigate();
const location = useLocation();
const navigationType = useNavigationType();
  const savedView = useMemo(() => readHomeView(), []);
const pendingHomeReturn = useMemo(() => readHomeReturn(), []);
const restoreFromHistory = navigationType === "POP" && pendingHomeReturn?.source === "order-detail";
const initialRestore = location.state?.restoreHomeView || (restoreFromHistory ? pendingHomeReturn : null);
const [orders, setOrders] = useState(() => homeMemory.orders);
const [orderImageMap, setOrderImageMap] = useState({});
const thumbnailLoadedOrderIdsRef = useRef(new Set());
const [visibleOrderIds, setVisibleOrderIds] = useState([]);
  const [q, setQ] = useState(() => initialRestore?.q ?? savedView.q ?? "");
const [quickText, setQuickText] = useState("");
const [quickSubmitting, setQuickSubmitting] = useState(false);
const [quickPaymentOrder, setQuickPaymentOrder] = useState(null);
  const [quickPayment, setQuickPayment] = useState({ cash: "", bank: "" });
  const [closeBookOpen, setCloseBookOpen] = useState(false);
  const quickInputRef = useRef(null);
  const [statusTab, setStatusTab] = useState(() => initialRestore?.statusTab || "new");
  const [filter, setFilter] = useState(() => initialRestore?.filter ?? "all");
  const [users, setUsers] = useState([]);
const [orderUnreadMap, setOrderUnreadMap] = useState(() => homeMemory.orderUnreadMap);
const [orderActivityMap, setOrderActivityMap] = useState(() => homeMemory.orderActivityMap);
const [groupUnreadCount, setGroupUnreadCount] = useState(() => homeMemory.groupUnreadCount);
const [warehouseLane, setWarehouseLane] = useState(() => {
  try { return sessionStorage.getItem("sonphu-warehouse-lane") || ""; } catch { return ""; }
});
const [warehouseHold, setWarehouseHold] = useState({});
const warehouseHoldTimersRef = useRef(new Map());
const [focusOrderId, setFocusOrderId] = useState(() => location.state?.focusOrderId || null);
const [scaleNotice, setScaleNotice] = useState("");
const restoredScrollRef = useRef(false);
const restoredInitialViewRef = useRef(Boolean(initialRestore));
const handledNavigationRef = useRef(false);
  const realtimeReadyRef = useRef(false);

  useEffect(() => {
    const input = quickInputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  }, [quickText]);

useEffect(() => {
homeMemory = { ...homeMemory, orders, orderUnreadMap, orderActivityMap, groupUnreadCount };
}, [orders, orderUnreadMap, orderActivityMap, groupUnreadCount]);

useEffect(() => {
  saveHomeView({ q, filter, statusTab, scrollY: getHomeScrollY() });
}, [q, filter, statusTab]);

useEffect(() => {
  if (restoredInitialViewRef.current) {
    restoredInitialViewRef.current = false;
    return;
  }
  setFilter(defaultFilterForStatus(statusTab));
}, [statusTab]);

useEffect(() => {
  if (restoredScrollRef.current || !initialRestore) return;
  if (orders.length === 0) return;
  restoredScrollRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
      restoreHomeScrollY(initialRestore.scrollY);
      clearHomeReturn();
      });
    });
}, [orders.length, initialRestore]);

useEffect(() => () => {
  saveHomeView({ q, filter, statusTab, scrollY: getHomeScrollY() });
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
  orderNumber: row.order_number || null,
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
  const restoreHomeView = location.state.restoreHomeView;
  if (restoreHomeView) {
    const restored = {
      q: restoreHomeView.q || "",
      filter: restoreHomeView.filter || defaultFilterForStatus(restoreHomeView.statusTab || "new"),
      statusTab: restoreHomeView.statusTab || "new",
      scrollY: Number(restoreHomeView.scrollY) || 0,
    };
    setQ(restored.q);
    setFilter(restored.filter);
    setStatusTab(restored.statusTab);
    saveHomeView(restored);
    clearHomeReturn();
    navigate("/", { replace: true, state: null });
    return;
  }
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
    .select("id, order_id, sender_id, seen_by, created_at");
  if (orderId) unreadQuery = unreadQuery.eq("order_id", orderId);
  const { data, error } = await unreadQuery;

  if (error) {
    console.log("LOAD ORDER UNREAD ERROR:", error);
    return;
  }

  const map = {};
  const activityMap = {};

  (data || []).forEach((m) => {
    const isMine = m.sender_id === me.id;
    const seenBy = Array.isArray(m.seen_by) ? m.seen_by : [];
    const unread = !isMine && !seenBy.includes(me.id);

    if (unread) {
      map[m.order_id] = (map[m.order_id] || 0) + 1;
      const previous = activityMap[m.order_id] || "";
      if (!previous || new Date(m.created_at || 0) > new Date(previous)) activityMap[m.order_id] = m.created_at;
    }
  });

  if (orderId) {
    setOrderUnreadMap((current) => {
      const next = { ...current };
      if (map[orderId]) next[orderId] = map[orderId];
      else delete next[orderId];
      return next;
    });
    if (activityMap[orderId]) {
      setOrderActivityMap((current) => ({ ...current, [orderId]: activityMap[orderId] }));
    }
  } else {
    setOrderUnreadMap(map);
    setOrderActivityMap((current) => ({ ...current, ...activityMap }));
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

    const remoteRows = data || [];
    const remoteIds = new Set(remoteRows.map((row) => row.id));
    await Promise.all(cached.filter((row) => !remoteIds.has(row.id)).map((row) => deleteLocal("orders", row.id)));
    let rows = remoteRows.map(normalizeOrder);
    await putManyLocal("orders", remoteRows);

// tạo weekly task ở client nếu đã qua mốc và chưa có
const weeklyCreated = await ensureWeeklySystemTask(rows);
const recurringCreated = await ensureRecurringSystemTasks(rows);
const created = weeklyCreated || recurringCreated;

if (created) {
  const { data: reloadData, error: reloadError } = await supabase
    .from("orders")
    .select("*")
    .order("updated_at", { ascending: false });

  if (reloadError) {
    console.log("RELOAD ORDERS ERROR:", reloadError);
    return;
  }

  const refreshedRows = reloadData || [];
  const refreshedIds = new Set(refreshedRows.map((row) => row.id));
  await Promise.all(rows.filter((row) => !refreshedIds.has(row.id)).map((row) => deleteLocal("orders", row.id)));
  await putManyLocal("orders", refreshedRows);
  rows = refreshedRows.map(normalizeOrder);
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
      void loadOrdersSupabase();
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
        if (payload.eventType === "INSERT") {
          setOrderActivityMap((current) => ({ ...current, [next.id]: next.createdAt || new Date().toISOString() }));
          notifyMention({ id: `order-${next.id}`, text: `${next.title || ""}\n${next.content || ""}`, title: "Đơn hàng có tag bạn", body: `${next.createdByName || "Có người"} vừa tạo đơn nhắc đến bạn` });
        }
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
        const orderId = payload.new?.order_id || payload.old?.order_id || null;
        loadOrderUnreadCounts(orderId);
        if (payload.eventType === "INSERT" && payload.new?.sender_id !== getCurrentUser()?.id && orderId) {
          notifyMention({ id: `order-message-${payload.new.id}`, text: payload.new.text, title: "Tin nhắn đơn có tag bạn", body: "Có tin nhắn trong đơn nhắc đến bạn" });
          setOrderActivityMap((current) => ({ ...current, [orderId]: payload.new.created_at || new Date().toISOString() }));
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "group_messages",
      },
      (payload) => {
        if (payload.eventType === "INSERT" && payload.new?.sender_id !== getCurrentUser()?.id) {
          notifyMention({ id: `group-message-${payload.new.id}`, text: payload.new.text, title: "Chat nhóm có tag bạn", body: "Có tin nhắn nhóm nhắc đến bạn" });
        }
        loadGroupUnreadCount();
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "scale_weighings" },
      (payload) => {
        if (payload.eventType !== "INSERT") return;
        const row = payload.new || {};
        if (row.source_id && (row.gross_at || row.tare_at)) {
          const operator = scaleOperatorFromSeries(row.series_id) || "Không rõ";
          const plate = row.plate || "chưa có biển số";
          const charge = Number(row.charge || 0).toLocaleString("vi-VN");
          setScaleNotice(`${operator} vừa cân xe ${plate} • ${charge}đ`);
          window.setTimeout(() => setScaleNotice(""), 7000);
        }
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
  let active = true;
  const ids = visibleOrderIds.filter((id) => id && !thumbnailLoadedOrderIdsRef.current.has(id));
  if (!ids.length) return () => { active = false; };
  const loadVisibleOrderImages = async () => {
    const localRowsByOrder = new Map();
    await Promise.all(ids.map(async (orderId) => {
      const rows = await getLocalOrderImages(orderId);
      localRowsByOrder.set(orderId, rows);
    }));
    if (!active) return;
    setOrderImageMap((current) => {
      const next = { ...current };
      ids.forEach((orderId) => {
        next[orderId] = (localRowsByOrder.get(orderId) || [])
          .map((image) => image.local_image_url || image.image_url)
          .filter(Boolean);
      });
      return next;
    });

    const { data, error } = await supabase
      .from("order_images")
      .select("id, order_id, image_url")
      .in("order_id", ids)
      .order("created_at", { ascending: true });
    if (error || !active) return;
    const remoteByOrder = new Map(ids.map((orderId) => [orderId, []]));
    (data || []).forEach((image) => {
      if (!remoteByOrder.has(image.order_id)) remoteByOrder.set(image.order_id, []);
      remoteByOrder.get(image.order_id).push(image);
    });
    await Promise.all(ids.map(async (orderId) => {
      const localRows = localRowsByOrder.get(orderId) || [];
      const remoteRows = remoteByOrder.get(orderId) || [];
      const remoteIds = new Set(remoteRows.map((row) => String(row.id)));
      await Promise.all(localRows.filter((row) => !remoteIds.has(String(row.id))).map((row) => deleteLocal("orderImages", row.id)));
      await putManyLocal("orderImages", remoteRows.map((row) => ({
        ...row,
        local_image_url: localRows.find((local) => String(local.id) === String(row.id))?.local_image_url,
      })));
    }));
    if (!active) return;
    ids.forEach((orderId) => thumbnailLoadedOrderIdsRef.current.add(orderId));
    setOrderImageMap((current) => {
      const next = { ...current };
      ids.forEach((orderId) => {
        next[orderId] = (remoteByOrder.get(orderId) || []).map((image) => image.image_url).filter(Boolean);
      });
      return next;
    });
  };
  void loadVisibleOrderImages();
  return () => { active = false; };
}, [visibleOrderIds]);

useEffect(() => {
  const urls = visibleOrderIds.flatMap((orderId) => orderImageMap[orderId] || []).filter((url) => /^https?:/i.test(url));
  let cursor = 0;
  let active = true;
  const worker = async () => {
    while (active && cursor < urls.length) {
      const url = urls[cursor];
      cursor += 1;
      await cacheImage(url);
    }
  };
  void Promise.all([worker(), worker()]);
  return () => { active = false; };
}, [visibleOrderIds, orderImageMap]);
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
      const weeklyCreated = await ensureWeeklySystemTask(orders);
      const recurringCreated = await ensureRecurringSystemTasks(orders);
      const created = weeklyCreated || recurringCreated;
      if (created) await loadOrdersSupabase();
    } finally {
      checking = false;
    }
  };
  const timer = window.setInterval(checkScheduledTasks, 30_000);
  return () => window.clearInterval(timer);
}, [orders]);

// Thực hiện các đơn đã được chốt sổ vào 02:00 mỗi ngày.
useEffect(() => {
  let timer;
  let cancelled = false;
  const runCloseBook = async () => {
    try {
      const pending = JSON.parse(localStorage.getItem("sonphu-pending-close-book") || "null");
      if (!pending?.ids?.length || new Date(pending.runAt) > new Date()) return;
      const ids = pending.ids.filter(Boolean);
      const { error: deleteError } = await supabase.from("orders").delete().in("id", ids);
      if (deleteError || cancelled) return;
      await Promise.all(ids.map((id) => deleteLocal("orders", id)));
      setOrders((current) => current.filter((order) => !ids.includes(order.id)));
      localStorage.removeItem("sonphu-pending-close-book");
    } catch (error) {
      console.log("CLOSE BOOK CLEANUP ERROR:", error);
    }
  };
  const schedule = () => {
    const next = new Date();
    next.setHours(2, 0, 0, 0);
    if (next <= new Date()) next.setDate(next.getDate() + 1);
    timer = window.setTimeout(async () => {
      await runCloseBook();
      schedule();
    }, Math.max(1000, next.getTime() - Date.now()));
  };
  void runCloseBook();
  schedule();
  return () => { cancelled = true; window.clearTimeout(timer); };
}, []);

useEffect(() => {
  const refreshFromLocal = async (event) => {
    const type = event.detail?.entity_type;
    if (type === "order") {
      const payload = event.detail?.payload;
      if (event.detail?.operation === "delete") {
        setOrders((current) => current.filter((order) => order.id !== event.detail?.entity_id));
      } else if (payload?.id) {
        const next = normalizeOrder(payload);
        setOrders((current) => {
          const exists = current.some((order) => order.id === next.id);
          return exists ? current.map((order) => order.id === next.id ? next : order) : [next, ...current];
        });
      }
    }
    if (type === "order_image") {
      const image = event.detail?.payload;
      const source = image?.local_image_url || image?.image_url;
      if (image?.order_id && event.detail?.operation === "delete") {
        setOrderImageMap((current) => ({
          ...current,
          [image.order_id]: (current[image.order_id] || []).filter((value) => value !== source),
        }));
      } else if (image?.order_id && source) {
        setOrderImageMap((current) => ({
          ...current,
          [image.order_id]: [...(current[image.order_id] || []), source].filter((value, index, values) => values.indexOf(value) === index),
        }));
      }
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

const displayOrders = orders;
let timeFiltered = displayOrders;

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
    timeFiltered = displayOrders.filter((o) => {
    const t = safeFilterTime(o);
    return t >= today;
  });
}

if (filter === "yesterday") {
  timeFiltered = displayOrders.filter((o) => {
    const t = safeFilterTime(o);
    return t >= yesterday && t < today;
  });
}

if (filter === "7days") {
  timeFiltered = displayOrders.filter((o) => {
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
  const canViewOrder = (orderItem) => {
    if (orderItem.status === "new") return hasPermission(PERMISSIONS.VIEW_NEW_ORDERS);
    if (orderItem.status === "done") return hasPermission(PERMISSIONS.VIEW_UNDELIVERED_ORDERS) || hasPermission(PERMISSIONS.VIEW_DONE_ORDERS);
    if (orderItem.status === "delivered") return hasPermission(PERMISSIONS.VIEW_DELIVERED_ORDERS);
    if (orderItem.status === "completed") {
      return hasPermission(PERMISSIONS.VIEW_COMPLETED_ORDERS)
        || (hasPermission(PERMISSIONS.VIEW_UNDELIVERED_ORDERS) && !orderItem.deliveredByName)
        || (hasPermission(PERMISSIONS.VIEW_DONE_ORDERS) && !orderItem.deliveredByName);
    }
    return false;
  };
  const searchSource = q.trim() ? displayOrders.filter(canViewOrder) : timeFiltered;
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
  if (!hasPermission(PERMISSIONS.PIN_ORDER)) return;
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
const updateOrder = async (id, action, extraData = {}) => {
  const current = orders.find((o) => o.id === id);
  if (!current) return;
  const preservedScrollY = getHomeScrollY();

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
      accounting_checked: false,
      accounting_checked_at: null,
      accounting_checked_by_name: null,
      payment_breakdown: (() => {
        const paymentBreakdown = { ...(current.payment_breakdown || {}) };
        delete paymentBreakdown.total_amount;
        delete paymentBreakdown.total_amount_at;
        return paymentBreakdown;
      })(),
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
      ...extraData,
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
  if (action === "reset") {
    setOrderActivityMap((currentActivity) => ({ ...currentActivity, [id]: now }));
  }
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
  saveHomeView({ q, filter, statusTab, scrollY: preservedScrollY });
  [0, 80, 220].forEach((delay) => window.setTimeout(() => {
    restoreHomeScrollY(preservedScrollY);
  }, delay));
  void publishSyncEvent({ entityType: "order", entityId: id, payload: nextOrder });

  // Giữ nguyên mục và bộ lọc hiện tại sau khi đổi trạng thái.
};

const openCloseBook = () => setCloseBookOpen(true);

const confirmCloseBook = () => {
  const eligibleIds = completedTodayOrders
    .filter((order) => order.deliveredByName && order.accounting_checked)
    .map((order) => order.id)
    .filter(Boolean);
  if (!eligibleIds.length) {
    setCloseBookOpen(false);
    return;
  }
  const runAt = new Date();
  runAt.setHours(2, 0, 0, 0);
  if (runAt <= new Date()) runAt.setDate(runAt.getDate() + 1);
  localStorage.setItem("sonphu-pending-close-book", JSON.stringify({ ids: eligibleIds, runAt: runAt.toISOString() }));
  setCloseBookOpen(false);
};

const hasSavedPayment = (order) => ["cash", "bank"].some((kind) => (order.payment_breakdown?.[kind] || []).some((row) => Number(row.amount || 0) > 0));

const saveQuickPayment = async () => {
  if (!quickPaymentOrder || !hasPermission(PERMISSIONS.VIEW_ACCOUNTING)) return;
  const cash = Math.max(0, Math.round(parseMoneyInput(quickPayment.cash)));
  const bank = Math.max(0, Math.round(parseMoneyInput(quickPayment.bank)));
  if (!cash && !bank) return;
  const paymentBreakdown = {
    cash: cash ? [{ id: createUuid(), amount: String(cash), note: "Thanh toán nhanh", paid_at: new Date().toISOString() }] : [],
    bank: bank ? [{ id: createUuid(), amount: String(bank), note: "Thanh toán nhanh", paid_at: new Date().toISOString() }] : [],
    note: "Thanh toán nhanh",
  };
  const { data, error } = await supabase.from("orders").update({ payment_breakdown: paymentBreakdown }).eq("id", quickPaymentOrder.id).select("*").single();
  if (error) { window.alert(`Không thể lưu thanh toán nhanh: ${error.message}`); return; }
  const nextOrder = data || { ...quickPaymentOrder, payment_breakdown: paymentBreakdown };
  await putLocal("orders", nextOrder);
  setOrders((current) => current.map((item) => item.id === nextOrder.id ? normalizeOrder(nextOrder) : item));
  void publishSyncEvent({ entityType: "order", entityId: nextOrder.id, payload: nextOrder });
  setQuickPaymentOrder(null);
  setQuickPayment({ cash: "", bank: "" });
};

const toggleWarehouse = async (id, warehouse) => {
  const current = orders.find((o) => o.id === id);
  if (!current || current.status !== "new" || !isNormal(current)) return;

  const me = getCurrentUser() || {};
  const actorName = me.name || me.username || "Không rõ";
  const now = new Date().toISOString();
  const isA = warehouse === "a";
  setWarehouseLane(warehouse);
  try { sessionStorage.setItem("sonphu-warehouse-lane", warehouse); } catch { /* sessionStorage không bắt buộc */ }
  const wasDone = isA ? current.warehouseADone : current.warehouseBDone;
  const holdTimer = warehouseHoldTimersRef.current.get(id);
  if (holdTimer) {
    window.clearTimeout(holdTimer);
    warehouseHoldTimersRef.current.delete(id);
  }
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
  if (!wasDone) {
    setWarehouseHold((currentHold) => ({ ...currentHold, [id]: true }));
    const timer = window.setTimeout(() => {
      setWarehouseHold((currentHold) => {
        const nextHold = { ...currentHold };
        delete nextHold[id];
        return nextHold;
      });
      warehouseHoldTimersRef.current.delete(id);
    }, 10000);
    warehouseHoldTimersRef.current.set(id, timer);
  } else {
    setWarehouseHold((currentHold) => {
      const nextHold = { ...currentHold };
      delete nextHold[id];
      return nextHold;
    });
  }
  void publishSyncEvent({ entityType: "order", entityId: id, payload: data });
};

  // sort ghim lên đầu
  const sorted = useMemo(() => {
    const me = getCurrentUser() || {};
    const actorName = me.name || me.username || "";
    const inferredLane = warehouseLane || (() => {
      const laneA = finalFiltered.filter((row) => row.warehouseADoneByName === actorName).length;
      const laneB = finalFiltered.filter((row) => row.warehouseBDoneByName === actorName).length;
      return laneA > laneB ? "a" : laneB > laneA ? "b" : "";
    })();
    return [...finalFiltered].sort((a, b) => {
      const aCancelled = Boolean(a.accounting_cancelled);
      const bCancelled = Boolean(b.accounting_cancelled);
      if (aCancelled !== bCancelled) return aCancelled ? 1 : -1;
      const aIsNormal = !a.type || a.type === "normal";
      const bIsNormal = !b.type || b.type === "normal";
      if (statusTab === "new" && aIsNormal && bIsNormal && inferredLane) {
        // Chỉ đưa xuống cuối khi đã hoàn tất cả Kho A và Kho B.
        const aDone = a.warehouseADone && a.warehouseBDone;
        const bDone = b.warehouseADone && b.warehouseBDone;
        if (aDone !== bDone) return aDone ? 1 : -1;
      }
      const activityA = new Date(orderActivityMap[a.id] || a.createdAt || 0).getTime();
      const activityB = new Date(orderActivityMap[b.id] || b.createdAt || 0).getTime();
      if (activityA !== activityB) return activityB - activityA;
      const unreadA = orderUnreadMap[a.id] || 0;
      const unreadB = orderUnreadMap[b.id] || 0;
      if (unreadA !== unreadB) return unreadB - unreadA;
      if (!a.pinned && b.pinned) return 1;
      if (a.pinned && !b.pinned) return -1;

      return (
        new Date(b.lastActionAt || b.createdAt).getTime() -
        new Date(a.lastActionAt || a.createdAt).getTime()
      );
    });
  }, [finalFiltered, orderActivityMap, orderUnreadMap, statusTab, warehouseLane, warehouseHold]);

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

    if (o.accounting_cancelled) {
      return (
        <div
          id={`order-${o.id}`}
          data-order-card-id={o.id}
          style={{
            ...S.card,
            ...S.cancelledCard,
            background: getCardColor(o),
            ...(focusOrderId === o.id ? { border: "2px solid #c8952e" } : {}),
          }}
          onClick={() => {
            const fromHome = { q, filter, statusTab, scrollY: getHomeScrollY() };
            saveHomeView(fromHome);
            saveHomeReturn(fromHome);
            navigate(`/order/${o.id}`, { state: { fromHome } });
          }}
        >
          <div style={S.cancelledCardContent}>
            <span style={S.cancelledOrderLabel}>ĐÃ HỦY ĐƠN</span>
            <span style={S.cancelledOrderTitle}>{o.title || "Đơn hàng"}</span>
          </div>
        </div>
      );
    }

    return (
      <div
        id={`order-${o.id}`}
        data-order-card-id={o.id}
        style={{
          ...S.card,
          position: "relative",
          background: getCardColor(o),
          ...(focusOrderId === o.id ? {
            border: "2px solid #c8952e",
            boxShadow: "0 0 0 3px rgba(46,204,113,.18), 0 6px 14px rgba(0,0,0,.35)",
          } : {}),
        }}
        onClick={() => {
          const fromHome = { q, filter, statusTab, scrollY: getHomeScrollY() };
          saveHomeView(fromHome);
          saveHomeReturn(fromHome);
          navigate(`/order/${o.id}`, { state: { fromHome } });
        }}
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
              <span style={S.orderTitleText}>{o.orderNumber ? `Đơn số: ${o.orderNumber} · ` : ""}{displayTitle || "Đơn hàng"}</span>
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

{(o.has_image || orderImageMap[o.id]?.length > 0) && (
  <>
    <div style={S.attachmentNote}>📎 Có ảnh đính kèm</div>
    {orderImageMap[o.id]?.length > 0 && <div style={S.homeThumbnails} onClick={(event) => event.stopPropagation()}>
      {orderImageMap[o.id].slice(0, 4).map((image, index) => <CachedImage key={`${image}-${index}`} src={image} alt="Ảnh đơn hàng" style={S.homeThumbnail} draggable="false" />)}
    </div>}
  </>
)}
          {hasPermission(PERMISSIONS.VIEW_ACCOUNTING) && o.accounting_checked && Number(o.payment_breakdown?.total_amount || 0) > 0 && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #ecd4a4", fontSize: 17, fontWeight: 800, color: "#5b3716" }}>
              Tổng tiền: {Number(o.payment_breakdown.total_amount).toLocaleString("vi-VN")}đ
            </div>
          )}
        </div>

        {hasOrderPanel && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div style={{ fontSize: 16, color: "#745b3d", textAlign: "right", lineHeight: 1.3 }}>
              {metaText || formatTime(o.lastActionAt || o.createdAt)}
            </div>
            {isNormalOrder && o.status === "new" && (
              <div style={S.warehouseControls}>
                <button
                  type="button"
                  disabled={o.status !== "new"}
                  style={{ ...S.warehouseButton(o.warehouseADone), ...(o.status !== "new" ? { opacity: 0.75, cursor: "default" } : {}) }}
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
                  disabled={o.status !== "new"}
                  style={{ ...S.warehouseButton(o.warehouseBDone), ...(o.status !== "new" ? { opacity: 0.75, cursor: "default" } : {}) }}
                  title={o.warehouseBDoneByName ? `Bấm bởi ${o.warehouseBDoneByName}` : "Kho B chưa xong"}
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleWarehouse(o.id, "b");
                  }}
                >
                  {o.warehouseBDone ? "✓ B xong" : "Kho B"}
                </button>
                {isNormalOrder && hasPermission(PERMISSIONS.QUICK_PAYMENT) && !hasSavedPayment(o) && (
                  <button type="button" aria-label="Thanh toán nhanh" title="Thanh toán nhanh" onClick={(event) => { event.stopPropagation(); setQuickPaymentOrder(o); setQuickPayment({ cash: "", bank: "" }); }} style={{ ...S.warehouseButton(false), fontSize: 24 }}>$</button>
                )}
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

// Sau khi nhiệm vụ hệ thống được hoàn tất, vẫn giữ lại trong mục Chưa giao
// để người dùng còn nhìn thấy kết quả thay vì bị biến mất khỏi màn hình.
const showInUndelivered = (o) => {
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
const undeliveredOrders = sorted.filter(showInUndelivered);
const deliveredOrders = sorted.filter(showInDelivered);
const completedTodayOrders = displayOrders.filter(showInCompleted).filter((orderItem) => {
  const completedAt = new Date(orderItem.completedAt || orderItem.completed_at || orderItem.updated_at || 0);
  return completedAt >= today;
});
const statusTabs = [
  { key: "new", label: "Đơn mới", count: newOrders.length, unread: unreadIn(newOrders) },
  { key: "undelivered", label: "Chưa giao", count: undeliveredOrders.length, unread: unreadIn(undeliveredOrders) },
  { key: "delivered", label: "Đã giao", count: deliveredOrders.length, unread: unreadIn(deliveredOrders) },
      { key: "completed", label: "Hoàn thành", count: completedTodayOrders.length, unread: 0 },
].filter((tab) => ({
  new: PERMISSIONS.VIEW_NEW_ORDERS,
  done: PERMISSIONS.VIEW_DONE_ORDERS,
  undelivered: PERMISSIONS.VIEW_UNDELIVERED_ORDERS,
  delivered: PERMISSIONS.VIEW_DELIVERED_ORDERS,
  completed: PERMISSIONS.VIEW_COMPLETED_ORDERS,
}[tab.key] ? hasPermission({
  new: PERMISSIONS.VIEW_NEW_ORDERS,
  done: PERMISSIONS.VIEW_DONE_ORDERS,
  undelivered: PERMISSIONS.VIEW_UNDELIVERED_ORDERS,
  delivered: PERMISSIONS.VIEW_DELIVERED_ORDERS,
  completed: PERMISSIONS.VIEW_COMPLETED_ORDERS,
}[tab.key]) : false));
const activeStatusTab = statusTabs.some((tab) => tab.key === statusTab) ? statusTab : (statusTabs[0]?.key || "new");
const canViewAccounting = hasPermission(PERMISSIONS.VIEW_ACCOUNTING);

useEffect(() => {
  if (activeStatusTab === statusTab || !statusTabs.length) return;
  setStatusTab(activeStatusTab);
  setFilter(defaultFilterForStatus(activeStatusTab));
}, [activeStatusTab, statusTab, statusTabs.length]);

const visibleOrders = q.trim() ? sorted.filter(canViewOrder) : sorted.filter((o) => {
  if (activeStatusTab === "new") return o.status === "new";
  if (activeStatusTab === "done") return showInDone(o);
  if (activeStatusTab === "undelivered") return showInUndelivered(o);
  if (activeStatusTab === "delivered") return showInDelivered(o);
  return showInCompleted(o);
});
const visibleOrderKey = visibleOrders.map((order) => order.id).filter(Boolean).join(",");

useEffect(() => {
  const ids = visibleOrderKey ? visibleOrderKey.split(",") : [];
  if (!ids.length) {
    setVisibleOrderIds([]);
    return undefined;
  }
  if (typeof IntersectionObserver === "undefined") {
    setVisibleOrderIds(ids.slice(0, 12));
    return undefined;
  }
  const observer = new IntersectionObserver((entries) => {
    setVisibleOrderIds((current) => {
      const next = new Set(current);
      entries.forEach((entry) => {
        const id = entry.target.dataset.orderCardId;
        if (!id) return;
        if (entry.isIntersecting) next.add(id);
        else next.delete(id);
      });
      return [...next].filter((id) => ids.includes(id));
    });
  }, { rootMargin: "480px 0px" });
  document.querySelectorAll("[data-order-card-id]").forEach((card) => {
    if (ids.includes(card.dataset.orderCardId)) observer.observe(card);
  });
  return () => observer.disconnect();
}, [visibleOrderKey]);

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

  const handleSearchChange = (value) => {
    setQ(value);
    if (String(value || "").trim()) setFilter("all");
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
      <Header searchValue={q} onSearchChange={handleSearchChange} />
      <FilterBar value={filter} onChange={setFilter} />

      <div style={{ ...S.section, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}><span>{q.trim() ? "Kết quả tìm kiếm" : statusTabs.find((tab) => tab.key === activeStatusTab)?.label}</span>{activeStatusTab === "completed" && hasPermission(PERMISSIONS.VIEW_COMPLETED_ORDERS) && <Btn onClick={openCloseBook}>Chốt sổ</Btn>}</div>
      {scaleNotice && <div role="status" style={S.scaleNotice}>⚖️ {scaleNotice}</div>}
      {visibleOrders.map((o) => {
        const cardSection = q.trim() ? sectionForOrder(o) : activeStatusTab;
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
              <Btn onClick={() => void updateOrder(o.id, "done")}>✓ Đã xong</Btn>
            )}

            {cardSection === "new" && isNormal(o) && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                {hasPermission(PERMISSIONS.MARK_DONE) && (
                  <Btn
                    disabled={!o.warehouseADone || !o.warehouseBDone}
                    onClick={() => void updateOrder(o.id, "done")}
                  >
                    ✔ Đã xong
                  </Btn>
                )}
                {hasPermission(PERMISSIONS.PIN_ORDER) && (
                  <Btn onClick={() => togglePin(o.id)} active={o.pinned}>
                    📌 {o.pinned ? "Bỏ ưu tiên" : "Ghim"}
                  </Btn>
                )}
              </div>
            )}

            {(cardSection === "done" || cardSection === "undelivered") && isNormal(o) && (
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

            {(cardSection === "done" || cardSection === "undelivered" || cardSection === "delivered") &&
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
          <MentionTextarea
            inputRef={quickInputRef}
            users={users}
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

      {quickPaymentOrder && (
        <div style={S.quickPaymentOverlay} role="dialog" aria-modal="true" aria-label="Thanh toán nhanh">
          <div style={S.quickPaymentBox} onClick={(event) => event.stopPropagation()}>
            <h2 style={{ margin: "0 0 10px", color: "#5b3716" }}>Thanh toán nhanh</h2>
            <div style={{ color: "#745b3d", marginBottom: 10 }}>{quickPaymentOrder.orderNumber ? `Đơn số ${quickPaymentOrder.orderNumber} · ` : ""}{quickPaymentOrder.title || "Đơn hàng"}</div>
            <div style={S.quickPaymentGrid}>
              <label>Tiền mặt<input style={S.quickPaymentInput} inputMode="numeric" value={formatMoneyInput(quickPayment.cash)} onChange={(event) => setQuickPayment((current) => ({ ...current, cash: cleanMoneyInput(event.target.value) }))} /></label>
              <label>Tài khoản<input style={S.quickPaymentInput} inputMode="numeric" value={formatMoneyInput(quickPayment.bank)} onChange={(event) => setQuickPayment((current) => ({ ...current, bank: cleanMoneyInput(event.target.value) }))} /></label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}><button type="button" onClick={() => setQuickPaymentOrder(null)} style={S.secondaryButton}>Hủy</button><button type="button" onClick={() => void saveQuickPayment()} style={S.primaryButton}>Lưu</button></div>
          </div>
        </div>
      )}

      {closeBookOpen && (
        <div style={S.quickPaymentOverlay} role="dialog" aria-modal="true" aria-label="Chốt sổ">
          <div style={S.quickPaymentBox} onClick={(event) => event.stopPropagation()}>
            <h2 style={{ margin: "0 0 10px", color: "#5b3716" }}>Chốt sổ</h2>
            <div style={{ color: "#745b3d", marginBottom: 12 }}>Các đơn đã giao và đã kiểm tra sẽ được xóa lúc 02:00.</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" onClick={() => setCloseBookOpen(false)} style={S.secondaryButton}>Hủy</button><button type="button" onClick={confirmCloseBook} style={S.primaryButton}>Đồng ý</button></div>
          </div>
        </div>
      )}

      <div style={{ ...S.statusBar, gridTemplateColumns: `repeat(${Math.max(1, statusTabs.length + (canViewAccounting ? 1 : 0))}, minmax(0, 1fr))` }}>
        {statusTabs.map((tab, index) => (
          <Fragment key={tab.key}>
          {canViewAccounting && index === 1 && (
            <button
              type="button"
              aria-label="Kế toán"
              title="Kế toán"
              onClick={() => navigate(hasPermission(PERMISSIONS.EXPENSE_REPORT_VIEW) ? "/expenses/report" : "/expenses", hasPermission(PERMISSIONS.EXPENSE_REPORT_VIEW) ? { state: { view: "orders" } } : undefined)}
              style={{ ...S.statusTab(false), fontSize: 24, padding: "2px 3px", transform: "translateX(12px)" }}
            >
              <span aria-hidden="true">🧮</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setStatusTab(tab.key);
              window.scrollTo({ top: 0, behavior: "auto" });
            }}
            style={{ ...S.statusTab(activeStatusTab === tab.key), ...(tab.key === "done" ? { transform: "translateX(-12px)" } : {}) }}
          >
            {tab.unread > 0
              ? <b style={S.unreadCount}>{tab.unread > 99 ? "99+" : tab.unread}</b>
              : <span style={{ width: 18, flexShrink: 0 }} />}
            <span>{tab.label}</span>
            {tab.count > 0
              ? <b style={S.statusCount}>{tab.count > 99 ? "99+" : tab.count}</b>
              : <span style={{ width: 18, flexShrink: 0 }} />}
          </button>
          </Fragment>
        ))}
      </div>

      <BottomNav active="home" chatBadge={groupUnreadCount} />
    </div>
  );
}
