import { getCurrentUser } from "./auth";

const notified = new Set();

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase("vi-VN");
}

export function mentionsUser(text, user = getCurrentUser()) {
  if (!user || !text) return false;
  const names = [user.name, user.username].filter(Boolean).map(normalize).filter(Boolean);
  const source = normalize(text);
  const mentionsEveryone = ["@mọi người", "@all", "@everyone"].some((mention) => source.includes(mention));
  return mentionsEveryone || names.some((name) => source.includes(`@${name}`));
}

export function notifyMention({ id, text, title = "Bạn được nhắc đến", body = "Có nội dung mới nhắc đến bạn" } = {}) {
  const me = getCurrentUser();
  if (!me?.id || !mentionsUser(text, me) || (id && notified.has(String(id)))) return false;
  if (id) notified.add(String(id));
  const clearTitle = title.replace(/^🔔\s*/u, "");
  const clearBody = `${body} · Bạn vừa được tag, hãy mở để xem.`;
  window.dispatchEvent(new CustomEvent("sonphu:mention", { detail: { id, text, title: `🔔 ${clearTitle}`, body: clearBody } }));
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(`🔔 ${clearTitle}`, { body: clearBody, tag: `sonphu-mention-${id || Date.now()}` });
  }
  return true;
}
