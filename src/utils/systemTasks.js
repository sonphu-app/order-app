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

function getThisWeekWednesday1130(now = new Date()) {
  const d = new Date(now);
  const day = d.getDay();
  d.setDate(d.getDate() + (3 - day));
  d.setHours(11, 30, 0, 0);
  return d;
}

function getTrashWeekKey(now = new Date()) {
  const wed = getThisWeekWednesday1130(now);
  const y = wed.getFullYear();
  const m = String(wed.getMonth() + 1).padStart(2, "0");
  const d = String(wed.getDate()).padStart(2, "0");
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

async function ensureOneWeeklyTask(rows, task) {
  const existsLocal = Array.isArray(rows) && rows.some(
    (o) => o.type === "system_task" && o.kind === task.kind && o.system_key === task.key
  );
  if (existsLocal) return false;

  const { data: existing, error: findErr } = await supabase
    .from("orders")
    .select("id")
    .eq("type", "system_task")
    .eq("kind", task.kind)
    .eq("system_key", task.key)
    .limit(1);

  if (findErr) {
    console.log("ensureWeeklySystemTask find error:", findErr);
    return false;
  }
  if (existing?.length) return false;

  const nowIso = new Date().toISOString();
  const { error: insErr } = await supabase.from("orders").insert({
    type: "system_task",
    title: task.title,
    content: task.content,
    status: "new",
    pinned: false,
    has_image: false,
    understood_by: [],
    system_key: task.key,
    kind: task.kind,
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (insErr) {
    console.log("ensureWeeklySystemTask insert error:", insErr);
    return false;
  }
  return true;
}

// Tự tạo các nhiệm vụ định kỳ khi một máy mở màn hình chính sau thời điểm đã đặt.
export async function ensureWeeklySystemTask(rows = []) {
  const now = new Date();
  let created = false;

  if (shouldCreateWeeklyTask(now)) {
    created = await ensureOneWeeklyTask(rows, {
      kind: "weekly-scale-check",
      key: getWeekKey(now),
      title: "KIỂM TRA CÂN ĐIỆN TỬ",
      content: "",
    }) || created;
  }

  const trashTime = getThisWeekWednesday1130(now);
  if (now.getTime() >= trashTime.getTime()) {
    created = await ensureOneWeeklyTask(rows, {
      kind: "weekly-take-out-trash",
      key: getTrashWeekKey(now),
      title: "Chiều nay nhớ đổ rác",
      content: "Thực hiện lúc 11:30 trưa thứ Tư. Xe rác thu lúc 05:00 sáng thứ Năm.",
    }) || created;
  }

  return created;
}
