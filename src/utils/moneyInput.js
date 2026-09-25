export const parseMoneyInput = (value) => Number(String(value ?? "").replace(/[^0-9-]/g, "")) || 0;

export const formatMoneyInput = (value) => {
  const text = String(value ?? "").replace(/[^0-9]/g, "");
  return text ? Number(text).toLocaleString("vi-VN") : "";
};

export const cleanMoneyInput = (value) => String(value ?? "").replace(/[^0-9]/g, "");
