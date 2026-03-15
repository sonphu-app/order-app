import { useEffect, useState } from "react";

export default function Header() {
  const [time, setTime] = useState("");

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
      <div style={s.logo}>THÉP SƠN PHÚ</div>
      <div style={s.time}>{time}</div>
    </div>
  );
}

const s = {
  wrap: {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",

  position: "sticky",
  top: 0,
  zIndex: 20,

  background: "#1e1e1e",
  padding: "12px 16px",
},
  logo: {
    color: "#caa55b", // vàng nâu đất
    fontWeight: 800,
    letterSpacing: 1,
    fontSize: 20,
  },
  time: {
    color: "#a9a9a9",
    fontSize: 14,
  },
};
