import { supabase } from "../supabaseClient";
import { getCurrentUser } from "./auth";

const VAPID_PUBLIC_KEY = "BPrMZ79NcpeFTx5oYrWeGGe5d-mUPDsnkyJ3gV6gKZQrCmdxFSkJy6zuWCdI9HlUPHha3AUVfvVkTkg_gfC4Eeg";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.register("/sw.js");
  return reg;
}

export function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

export async function enablePushNotifications() {
  const me = getCurrentUser();
  if (!me?.id) {
    alert("Chưa có người dùng hiện tại");
    return { ok: false, reason: "no_user" };
  }

  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    alert("Máy này chưa hỗ trợ thông báo đẩy");
    return { ok: false, reason: "unsupported" };
  }

  if (isIos() && !isStandalone()) {
    alert("Trên iPhone, hãy thêm app ra màn hình chính rồi mở lại từ icon ngoài màn hình trước khi bật thông báo.");
    return { ok: false, reason: "ios_not_standalone" };
  }

  const reg = await registerServiceWorker();

  let permission = Notification.permission;
  if (permission !== "granted") {
    permission = await Notification.requestPermission();
  }

  if (permission !== "granted") {
    alert("Bạn chưa cho phép thông báo");
    return { ok: false, reason: "permission_denied" };
  }

  let subscription = await reg.pushManager.getSubscription();

  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = subscription.toJSON();

  const payload = {
    user_id: me.id,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh || "",
    auth: json.keys?.auth || "",
    user_agent: navigator.userAgent || "",
    platform: isIos() ? "ios" : /android/i.test(navigator.userAgent) ? "android" : "other",
    device_label: isIos() ? "iPhone/iPad" : /android/i.test(navigator.userAgent) ? "Android" : "Web",
    is_active: true,
    last_seen_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(payload, { onConflict: "endpoint" });

    if (error) {
    console.log("SAVE PUSH SUBSCRIPTION ERROR:", error);
    alert("Lưu thiết bị nhận thông báo lỗi: " + (error.message || "unknown"));
    return { ok: false, reason: "save_failed", error };
  }

  console.log("SAVE PUSH SUBSCRIPTION OK");
  return { ok: true };
}

export async function syncPushHeartbeat() {
  const me = getCurrentUser();
  if (!me?.id) return;

  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    const sub = await reg?.pushManager?.getSubscription?.();
    if (!sub) return;

    const json = sub.toJSON();
    await supabase
      .from("push_subscriptions")
      .update({
        is_active: true,
        last_seen_at: new Date().toISOString(),
      })
      .eq("endpoint", json.endpoint);
  } catch (e) {
    console.log("PUSH HEARTBEAT ERROR:", e);
  }
}

function trimText(s = "", max = 90) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function compactOrderLabel(order = {}) {
  const parts = [order.title, order.content].filter(Boolean).map((x) => trimText(x, 40));
  return parts.join(" | ") || "Đơn mới";
}

export async function sendPushEvent(payload) {
  console.log("sendPushEvent START =", payload);

  const { data, error } = await supabase.functions.invoke("push", {
    body: payload,
  });

  console.log("sendPushEvent DATA =", data);
  console.log("sendPushEvent ERROR =", error);

  if (error) {
    console.log("SEND PUSH EVENT ERROR:", error);
    return null;
  }

  return data;
}

export async function notifyNewOrder(order) {
  const me = getCurrentUser();

  console.log("notifyNewOrder me =", me);
  console.log("notifyNewOrder order =", order);

  if (!me?.id || !order?.id) {
    console.log("notifyNewOrder STOP: missing me.id or order.id");
    return null;
  }

  const payload = {
    type: "new_order",
    actorId: me.id,
    actorName: me.name || me.username || "Không rõ",
    title: `📦 Đơn mới - ${me.name || me.username || "Không rõ"}`,
    body: compactOrderLabel(order),
    url: `/order/${order.id}`,
    orderId: order.id,
  };

  console.log("notifyNewOrder PAYLOAD =", payload);

  return sendPushEvent(payload);
}

export async function notifyOrderChat({ order, text, imageCount = 0 }) {
  const me = getCurrentUser();
  if (!me?.id || !order?.id) return;

  let bodyText = "";
  if (text?.trim()) {
    bodyText = `${trimText(order?.title || order?.content || "Đơn")} | ${trimText(text, 70)}`;
  } else if (imageCount > 0) {
    bodyText = `${trimText(order?.title || order?.content || "Đơn")} | Đã gửi ${imageCount} ảnh`;
  } else {
    bodyText = `${trimText(order?.title || order?.content || "Đơn")} | Tin nhắn mới`;
  }

  return sendPushEvent({
    type: "order_chat",
    actorId: me.id,
    actorName: me.name || me.username || "Không rõ",
    title: `💬 Chat đơn - ${me.name || me.username || "Không rõ"}`,
    body: bodyText,
    url: `/order/${order.id}`,
    orderId: order.id,
  });
}

export async function notifyGroupChat({ text, imageCount = 0 }) {
  const me = getCurrentUser();
  if (!me?.id) return;

  const body = text?.trim()
    ? trimText(text, 100)
    : imageCount > 0
    ? `Đã gửi ${imageCount} ảnh`
    : "Tin nhắn mới";

  return sendPushEvent({
    type: "group_chat",
    actorId: me.id,
    actorName: me.name || me.username || "Không rõ",
    title: `💬 Chat nhóm - ${me.name || me.username || "Không rõ"}`,
    body,
    url: `/chat`,
  });
}