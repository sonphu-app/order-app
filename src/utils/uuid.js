// Trình duyệt/WebView cũ có thể có crypto.getRandomValues nhưng chưa có
// crypto.randomUUID. Dùng một hàm chung để các màn hình không bị văng khi
// nhân viên đăng nhập lại hoặc tạo dữ liệu mới.
export function createUuid() {
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}
