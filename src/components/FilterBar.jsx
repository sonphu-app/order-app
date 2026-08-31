import { useState } from "react";

export default function FilterBar({ value, onChange }) {
  const [showPicker, setShowPicker] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // ⭐ DANH SÁCH FILTER
  const items = [
    { key: "all", label: "Tất cả" },
    { key: "today", label: "Hôm nay" },
    { key: "yesterday", label: "Hôm qua" },
    { key: "7days", label: "7 ngày qua" },
    { key: "custom", label: "Thêm" },
  ];

  // ⭐ CLICK FILTER
  const clickItem = (key) => {
    if (key === "custom") {
      setShowPicker(!showPicker);
      return;
    }

    setShowPicker(false);
    onChange(key);
  };

  // ⭐ ÁP DỤNG CUSTOM DATE
  const applyCustom = () => {
    if (!from || !to) return;
    onChange({ type: "custom", from, to });
    setShowPicker(false);
  };

  return (
    <div>
      <div style={styles.wrap}>
        {items.map((it) => {
          const active =
            value === it.key ||
            (it.key === "custom" &&
              value &&
              typeof value === "object" &&
              value.type === "custom");

          return (
            <button
              key={it.key}
              onClick={() => clickItem(it.key)}
              style={{
                ...styles.btn,
                ...(active ? styles.active : {}),
              }}
            >
              {it.label}
            </button>
          );
        })}
      </div>

      {showPicker && (
        <div style={styles.popup}>
          <div>Từ ngày</div>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />

          <div style={{ marginTop: 8 }}>Đến ngày</div>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />

          <button style={styles.apply} onClick={applyCustom}>
            Áp dụng
          </button>
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: {
    display: "flex",
    gap: 6,
    marginBottom: 10,
    overflowX: "auto",
    scrollbarWidth: "none",
  },

  btn: {
    background: "#fffaf0",
    color: "#4d3218",
    border: "1px solid #d5b477",
    padding: "8px 11px",
    borderRadius: 8,
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontSize: 15,
  },

  active: {
    background: "#d3a13f",
    color: "#3d260d",
    borderColor: "#a8731f",
  },

  popup: {
    background: "#fffaf0",
    color: "#3d2b1b",
    border: "1px solid #d8b36a",
    boxShadow: "0 4px 12px rgba(91,55,22,.12)",
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
  },

  apply: {
    marginTop: 10,
    padding: "6px 12px",
    background: "#d3a13f",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
  },
};
