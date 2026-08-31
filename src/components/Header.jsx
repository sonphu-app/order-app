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
  background: "#fff7e6",
  padding: "10px 12px",
  borderBottom: "1px solid #d8b36a",
  boxShadow: "0 3px 12px rgba(91,55,22,.12)",
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
    color: "#6f430d",
    fontWeight: 800,
    letterSpacing: 1,
    fontSize: 21,
    whiteSpace: "nowrap",
  },
  time: {
    color: "#745b3d",
    fontSize: 16,
  },
btn: {
  padding: "7px 11px",
  borderRadius: 999,
  border: "1px solid #a8731f",
  background: "#d3a13f",
  color: "#3d260d",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 15,
  whiteSpace: "nowrap",
},
searchBtn: {
  width: 38,
  height: 38,
  padding: 0,
  borderRadius: "50%",
  border: "1px solid #d1aa62",
  background: "#fff3d6",
  color: "#4d3218",
  cursor: "pointer",
  flexShrink: 0,
},
searchBtnActive: {
  borderColor: "#a8731f",
  background: "#f3dda9",
},
searchRow: {
  display: "flex",
  gap: 6,
  marginTop: 9,
},
searchInput: {
  flex: 1,
  minWidth: 0,
  height: 42,
  borderRadius: 10,
  border: "1px solid #d1aa62",
  outline: "none",
  background: "#fffaf0",
  color: "#3d2b1b",
  padding: "0 11px",
  boxSizing: "border-box",
},
clearBtn: {
  width: 42,
  height: 42,
  borderRadius: 10,
  border: "1px solid #d1aa62",
  background: "#fff3d6",
  color: "#4d3218",
},
};
