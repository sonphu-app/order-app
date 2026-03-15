const KEY = "chatMessages";

export function saveMessages(messages) {
  try {
    const data = JSON.stringify(messages);
    localStorage.setItem(KEY, data);
  } catch (err) {
    console.error("SAVE CHAT ERROR:", err);
  }
}

export function loadMessages() {
  try {
    const data = localStorage.getItem(KEY);
    if (!data) return [];

    const parsed = JSON.parse(data);

    // 🔥 bảo vệ images luôn là mảng
    return parsed.map(m => ({
      ...m,
      images: Array.isArray(m.images) ? m.images : []
    }));
  } catch (err) {
    console.error("LOAD CHAT ERROR:", err);
    return [];
  }
}