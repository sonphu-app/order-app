import { useNavigate } from "react-router-dom";
export default function BottomNav({
  active = "home",
  chatBadge = 0,
  logBadge = 0
}) {
  const navigate = useNavigate();
  return (
    <div style={s.bar}>
      {/* nhóm 4 nút chính */}
      <div style={s.mainGroup}>
        <Item icon="⚖️" text="Cân xe" />
        <Item
  icon="💬"
  text="Chat nhóm"
  badge={chatBadge}
  onClick={() => navigate("/chat")}
/>

        <Item 
  icon="➕" 
  text="Tạo đơn" 
  onClick={() => navigate("/create")} 
/>
        <Item
  icon="👤"
  text="Tài khoản"
  onClick={() => navigate("/account")}
/>
      </div>

      {/* ô loa nhỏ riêng */}
      <div style={s.logBox}>
        <div style={{position:"relative"}}>
          <span style={{fontSize:18}}>🔊</span>
          {logBadge > 0 && <span style={s.badge}>{logBadge}</span>}
        </div>
      </div>
    </div>
  );
}

function Item({ icon, text, badge, onClick }) {
  return (
    <div style={s.item} onClick={onClick}>
      <div style={{position:"relative"}}>
        <span style={{fontSize:22}}>{icon}</span>
        {badge > 0 && <span style={s.badge}>{badge}</span>}
      </div>
      <div style={s.text}>{text}</div>
    </div>
  );
}

const s = {
  bar:{
    position:"fixed",
    bottom:0,
    left:0,
    right:0,
    width:"100%",
    zIndex: 20,
    height:68,
    background:"#1a1a1a",
    borderTop:"1px solid #2c2c2c",
    display:"flex",
    alignItems:"center",
    padding:"0 10px"
  },

  mainGroup:{
    flex:1,
    display:"flex",
    justifyContent:"space-around"
  },

  item:{
    textAlign:"center",
    color:"#ccc",
    fontSize:12
  },

  text:{ marginTop:4 },

  logBox:{
    width:40,                 // 👈 ô loa rất nhỏ
    display:"flex",
    justifyContent:"center",
    alignItems:"center"
  },

  badge:{
    position:"absolute",
    top:-6,
    right:-10,
    background:"red",
    color:"white",
    borderRadius:"50%",
    padding:"2px 6px",
    fontSize:10
  }
};
