import { enablePushNotifications } from "../utils/push";
import { useEffect, useState } from "react";

export default function Header({ searchValue = "", onSearchChange }) {
  const [time, setTime] = useState("");
  const [searchOpen, setSearchOpen] = useState(() => Boolean(searchValue));

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, "0");
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const hh = String(now.getHours()).padStart(2, "0");
      const mi = String(now.getMinutes()).padStart(2, "0");
      setTime(`${dd}/${mm} ${hh}:${mi}`);
    };
    update();
    const t = setInterval(update, 1000 * 30);
    return () => clearInterval(t);
  }, []);

  return (
  <div style={s.wrap}>
    <div style={s.topRow}>
      <div>
        <div style={s.logo}>THÉP SƠN PHÚ</div>
        <div style={s.time}>{time}</div>
      </div>
      <div style={s.actions}>
        <button
          onClick={async () => {
            const rs = await enablePushNotifications();
            if (rs?.ok) alert("Đã bật thông báo cho máy này");
          }}
          style={s.btn}
        >
          Bật thông báo 🔔
        </button>
        <button
          type="button"
          aria-label="Tìm kiếm đơn"
          title="Tìm kiếm đơn"
          onClick={() => setSearchOpen((current) => !current)}
          style={{ ...s.searchBtn, ...(searchOpen || searchValue ? s.searchBtnActive : {}) }}
        >
          🔍
        </button>
      </div>
    </div>

    {searchOpen && (
      <div style={s.searchRow}>
        <input
          autoFocus
          value={searchValue}
          onChange={(event) => onSearchChange?.(event.target.value)}
          placeholder="Tìm tiêu đề / nội dung / SĐT"
          style={s.searchInput}
        />
        {searchValue && (
          <button
            type="button"
            aria-label="Xóa nội dung tìm kiếm"
            onClick={() => onSearchChange?.("")}
            style={s.clearBtn}
          >
            ✕
          </button>
        )}
      </div>
    )}
  </div>
);
}

const s = {
  wrap: {
  position: "sticky",
  top: 0,
  zIndex: 20,
  background: "#1e1e1e",
  padding: "10px 12px",
  borderBottom: "1px solid #303030",
},
  topRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    minWidth: 0,
},
  logo: {
    color: "#caa55b", // vàng nâu đất
    fontWeight: 800,
    letterSpacing: 1,
    fontSize: 18,
    whiteSpace: "nowrap",
  },
  time: {
    color: "#a9a9a9",
    fontSize: 14,
  },
btn: {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid #444",
  background: "#2ecc71",
  color: "#111",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 13,
  whiteSpace: "nowrap",
},
searchBtn: {
  width: 34,
  height: 34,
  padding: 0,
  borderRadius: "50%",
  border: "1px solid #444",
  background: "#2a2a2a",
  color: "#fff",
  cursor: "pointer",
  flexShrink: 0,
},
searchBtnActive: {
  borderColor: "#2ecc71",
  background: "#24452f",
},
searchRow: {
  display: "flex",
  gap: 6,
  marginTop: 9,
},
searchInput: {
  flex: 1,
  minWidth: 0,
  height: 38,
  borderRadius: 10,
  border: "1px solid #444",
  outline: "none",
  background: "#151515",
  color: "#fff",
  padding: "0 11px",
  boxSizing: "border-box",
},
clearBtn: {
  width: 38,
  height: 38,
  borderRadius: 10,
  border: "1px solid #444",
  background: "#2a2a2a",
  color: "#fff",
},
};
