export const PERMISSIONS = {
  // Account
  CHANGE_PASSWORD: "change_password",

  // Orders
  CREATE_ORDER: "create_order",
  EDIT_ORDER: "edit_order",
  MARK_DONE: "mark_done",
  MARK_DELIVERED: "mark_delivered",
  COMPLETE_ORDER: "complete_order",
  DELETE_ORDER: "delete_order",

  // Weighing
  WEIGHING: "weighing",

  // Chat
  CHAT: "chat",
  EDIT_MESSAGE: "edit_message",
  DELETE_MESSAGE: "delete_message", // xóa phía mình (hoặc xóa thường)
  UNSEND_MESSAGE: "unsend_message", // thu hồi (xóa với tất cả)

  // System
  VIEW_STATS: "view_stats",
  MANAGE_USERS: "manage_users",
  RESET_DATA: "reset_data",

  // Full access
  FULL_ACCESS: "full_access",
};

export const PERMISSION_UI = [
  {
    title: "Tài khoản",
    items: [{ code: PERMISSIONS.CHANGE_PASSWORD, label: "Đổi mật khẩu" }],
  },
  {
    title: "Quản lý đơn",
    items: [
      { code: PERMISSIONS.CREATE_ORDER, label: "Tạo đơn" },
      { code: PERMISSIONS.EDIT_ORDER, label: "Sửa đơn" },
      { code: PERMISSIONS.MARK_DONE, label: 'Bấm "Đã xong"' },
      { code: PERMISSIONS.MARK_DELIVERED, label: 'Bấm "Giao"' },
      { code: PERMISSIONS.COMPLETE_ORDER, label: 'Bấm "Hoàn thành"' },
{ code: PERMISSIONS.DELETE_ORDER, label: "Xoá đơn" },
    ],
  },
  {
    title: "Cân xe",
    items: [{ code: PERMISSIONS.WEIGHING, label: "Sử dụng màn hình cân xe" }],
  },
  {
    title: "Chat",
    items: [
      { code: PERMISSIONS.CHAT, label: "Chat nhóm" },
      { code: PERMISSIONS.EDIT_MESSAGE, label: "Sửa tin nhắn" },
      { code: PERMISSIONS.DELETE_MESSAGE, label: "Xóa tin nhắn" },
      { code: PERMISSIONS.UNSEND_MESSAGE, label: "Thu hồi tin nhắn" },
    ],
  },
  {
    title: "Hệ thống",
    items: [
      { code: PERMISSIONS.VIEW_STATS, label: "Xem thống kê" },
      { code: PERMISSIONS.MANAGE_USERS, label: "Quản lý tài khoản nhân viên" },
      { code: PERMISSIONS.RESET_DATA, label: "Reset dữ liệu hệ thống" },
    ],
  },
];

export const getCurrentUser = () => {
  try {
    return JSON.parse(localStorage.getItem("currentUser"));
  } catch {
    return null;
  }
};

export const hasPermission = (permissionCode) => {
  const u = getCurrentUser();
  if (!u) return false;
  const perms = Array.isArray(u.permissions) ? u.permissions : [];
  if (perms.includes(PERMISSIONS.FULL_ACCESS)) return true;
  return perms.includes(permissionCode);
};
