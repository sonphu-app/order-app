// src/utils/systemTasks.js
import { supabase } from "../supabaseClient";

function getThisWeekTuesday7AM(now = new Date()) {
  const d = new Date(now);
  const day = d.getDay(); // 0 CN, 1 T2, 2 T3...
  const diff = 2 - day; // tới Thứ 3
  d.setDate(d.getDate() + diff);
  d.setHours(7, 0, 0, 0);
  return d;
}

function shouldCreateWeeklyTask(now = new Date()) {
  const n = new Date(now); // ⭐ ép về Date cho chắc
  const tue7 = getThisWeekTuesday7AM(n);
  return n.getTime() >= tue7.getTime();
}

function getWeekKey(now = new Date()) {
  const tue = getThisWeekTuesday7AM(now);
  const y = tue.getFullYear();
  const m = String(tue.getMonth() + 1).padStart(2, "0");
  const d = String(tue.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ✅ tạo 1 order hệ thống dạng "nhiệm vụ"
export function makeSystemTaskOrder(text, createdAt = new Date(), extra = {}) {
  return {
    id: `sys-task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: "system_task",
    text: text || "NHIỆM VỤ HỆ THỐNG",
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    pinned: false,

    // trạng thái
    done: false,
    shipped: false,
    completed: false,

    ...extra,
  };
}

// ✅ tạo 1 "tin nhắn hệ thống" dạng loa + ai đã hiểu
export function makeSystemMessageOrder(text, requiredUsers = [], createdAt = new Date(), extra = {}) {
  return {
    id: `sys-msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: "system_message",
    text: text || "THÔNG BÁO HỆ THỐNG",
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    pinned: true,

    acknowledgements: [],
    requiredUsers: Array.isArray(requiredUsers) ? requiredUsers : [],

    // trạng thái
    done: false,
    shipped: false,
    completed: false,

    ...extra,
  };
}

// ✅ tự tạo nhiệm vụ "KIỂM TRA CÂN ĐIỆN TỬ" lúc 7h Thứ 3
export async function ensureWeeklySystemTask(rows = []) {
  const now = new Date();

  // chỉ thứ 3 lúc 7:00
  if (!shouldCreateWeeklyTask(now)) return null;

  // key theo tuần (giữ logic cũ của bạn)
  const weekKey = getWeekKey(now);

  // nếu Home đã load rows từ DB thì check ngay trên rows cho nhanh
  const existsLocal = Array.isArray(rows) && rows.some(
    (o) =>
      o.type === "system_task" &&
      o.kind === "weekly-scale-check" &&
      o.system_key === weekKey
  );
  if (existsLocal) return null;

  // check DB để chắc chắn không tạo trùng (phòng nhiều máy)
  const { data: existing, error: findErr } = await supabase
    .from("orders")
    .select("id")
    .eq("type", "system_task")
    .eq("kind", "weekly-scale-check")
    .eq("system_key", weekKey)
    .limit(1);

if (findErr) {
  console.log("ensureWeeklySystemTask find error:", findErr);
  return null;
}

if (existing && existing.length > 0) return null;const nowIso = new Date().toISOString();
  const { error: insErr } = await supabase.from("orders").insert({
    type: "system_task",
    title: "KIỂM TRA CÂN ĐIỆN TỬ",
    content: "",
    status: "new",
    pinned: false,
    has_image: false,
    understood_by: [],
    // 2 field này bạn chưa ghi trong schema, nhưng Home/systemTasks đang dùng.
    // Nếu DB chưa có thì BỎ 2 dòng dưới (xem ghi chú ngay dưới)
    system_key: weekKey,
    kind: "weekly-scale-check",
created_at: nowIso,
updated_at: nowIso,
  });

  if (insErr) console.log("ensureWeeklySystemTask insert error:", insErr);

  return true;
}