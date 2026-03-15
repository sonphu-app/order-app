// src/utils/ordersAdapter.js

const KEY = "orders";

// ===== LOAD =====
export function loadOrders() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

// ===== SAVE =====
export function saveOrders(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

// ===== ADD ORDER =====
export function addOrder(order) {
  const orders = loadOrders();
  const next = [order, ...orders];
  saveOrders(next);
  return next;
}

// ===== UPDATE ORDER =====
export function updateOrderById(id, patch) {
  const orders = loadOrders();
  const next = orders.map(o =>
    o.id === id ? { ...o, ...patch } : o
  );
  saveOrders(next);
  return next;
}

// ===== DELETE ORDER =====
export function deleteOrder(id) {
  const orders = loadOrders();
  const next = orders.filter(o => o.id !== id);
  saveOrders(next);
  return next;
}

// ====== THỐNG KÊ HÔM NAY ======
const toDate = (val) => {
  if (!val) return null;
  if (typeof val === "string") {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
};

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const normalizeStatus = (o) => {
  if (o.completed) return "completed";
  if (o.shipped) return "delivered";
  if (o.done) return "done";
  return "new";
};

export function computeTodayStats() {
  const orders = loadOrders();
  const today = new Date();

  let newCount = 0;
  let completedCount = 0;
  let deliveredCount = 0;

  for (const o of orders) {
    const d = toDate(o.createdAt);
    if (!d || !sameDay(d, today)) continue;

    const st = normalizeStatus(o);
    if (st === "new") newCount++;
    if (st === "completed") completedCount++;
    if (st === "delivered") deliveredCount++;
  }

  return {
    totalToday: newCount + completedCount + deliveredCount,
    newCount,
    completedCount,
    deliveredCount,
  };
}