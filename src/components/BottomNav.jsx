import { useNavigate } from "react-router-dom";
import { hasPermission, PERMISSIONS } from "../utils/permissions";

export default function BottomNav({
  active = "home",
  chatBadge = 0,
  logBadge = 0
}) {
  const navigate = useNavigate();

  return (
    <div style={s.bar}>
      {/* animation */}
      <style>
        {`
        @keyframes pulseBadge {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.15); opacity: 0.7; }
          100% { transform: scale(1); opacity: 1; }
        }
        `}
      </style>

      {/* nhóm 4 nút */}
      <div style={s.mainGroup}>
        {hasPermission(PERMISSIONS.WEIGHING) && (
          <Item icon="⚖️" text="Cân xe" active={active === "scale"} />
        )}

        {hasPermission(PERMISSIONS.CHAT) && (
          <Item
            icon="💬"
            text="Chat nhóm"
            badge={chatBadge}
            active={active === "chat"}
            onClick={() => navigate("/chat")}
          />
        )}

        {hasPermission(PERMISSIONS.CREATE_ORDER) && (
          <Item
            icon="➕"
            text="Tạo đơn"
            active={active === "create"}
            onClick={() => navigate("/create")}
          />
        )}

        <Item
          icon="👤"
          text="Tài khoản"
          active={active === "account"}
          onClick={() => navigate("/account")}
        />
      </div>

      {/* loa */}
      <div style={s.logBox}>
        <div style={{ position: "relative" }}>
          <span style={{ fontSize: 18 }}>🔊</span>
          {logBadge > 0 && (
            <span style={s.badge(logBadge)}>
              {formatBadge(logBadge)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function formatBadge(n) {
  if (n > 99) return "99+";
  return n;
}

function Item({ icon, text, badge, active, onClick }) {
  return (
    <div style={{ ...s.item, ...(active ? s.itemActive : {}) }} onClick={onClick}>
      <div style={{ position: "relative" }}>
        <span style={{ fontSize: 22 }}>{icon}</span>

        {badge > 0 && (
          <span style={s.badge(badge)}>
            {formatBadge(badge)}
          </span>
        )}
      </div>
      <div style={s.text}>{text}</div>
    </div>
  );
}

const s = {
  bar: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    width: "100%",
    zIndex: 20,
    height: 68,
    background: "#1a1a1a",
    borderTop: "1px solid #2c2c2c",
    display: "flex",
    alignItems: "center",
    padding: "0 10px"
  },

  mainGroup: {
    flex: 1,
    display: "flex",
    justifyContent: "space-around"
  },

  item: {
    textAlign: "center",
    color: "#ccc",
    fontSize: 12,
    cursor: "pointer"
  },

  itemActive: { color: "#fff" },

  text: { marginTop: 4 },

  logBox: {
    width: 40,
    display: "flex",
    justifyContent: "center",
    alignItems: "center"
  },

  badge: (count) => ({
    position: "absolute",
    top: -6,
    right: -10,
    background: "#ff3b30",
    color: "white",
    borderRadius: "50%",
    padding: "2px 6px",
    fontSize: 10,
    fontWeight: 700,
    minWidth: 18,
    textAlign: "center",
    animation: count > 0 ? "pulseBadge 1s infinite" : "none"
  })
};
