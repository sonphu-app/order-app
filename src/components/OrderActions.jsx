import { updateOrderById } from "../utils/ordersAdapter";
import { useNavigate } from "react-router-dom";
import { hasPermission, PERMISSIONS } from "../utils/permissions";
import { getCurrentUser } from "../utils/auth";
export default function OrderActions({ order, onUpdated }) {
const navigate = useNavigate();
const me = getCurrentUser();
  function updateStatus(patch) {
  const updated = {
    ...order,
    ...patch,
    lastActionAt: new Date().toISOString() // 👈 thêm thời gian thực
  };

  updateOrderById(order.id, updated);
  onUpdated(updated);

  navigate("/");   // 👈 về home ngay
}
function handleEdit() {
  const ok = window.confirm("Bạn muốn sửa đơn này?");
  if (!ok) return;

  navigate("/create", { state: { editing: order } });
}
function handleDelete() {
  if (!window.confirm("Bạn muốn xóa đơn này?")) return;

  const orders = JSON.parse(localStorage.getItem("orders") || "[]")
    .filter(o => o.id !== order.id);

  localStorage.setItem("orders", JSON.stringify(orders));

  window.location.href = "/";
}
  return (
  <div style={S.actionRow}>

    {/* ===== BÊN TRÁI: TRẠNG THÁI ===== */}
<div style={{ display: "flex", gap: 6 }}>

  {/* ========== SYSTEM TASK ========== */}
  {order.type === "system-task" && (
    <>
      {/* Bước 1: Đã xong */}
      {!order.done && (
        <button style={S.btn} onClick={() => updateStatus({ done: true })}>
          ✓ Đã xong
        </button>
      )}

      {/* Bước 2: Hoàn thành */}
      {order.done && !order.completed && (
        <button style={S.btn} onClick={() => updateStatus({ completed: true })}>
          🏁 Hoàn thành
        </button>
      )}

      {/* Xong hẳn */}
      {order.done && order.completed && (
        <div style={{ fontWeight: 700 }}>✅ Đã hoàn thành</div>
      )}
    </>
  )}

  {/* ========== SYSTEM MESSAGE ========== */}
  {order.type === "system-message" && (
    <>
      {/* Bước 1: Đã hiểu */}
      {!order.done && (
        <button style={S.btn} onClick={() => updateStatus({ done: true })}>
          👁 Đã hiểu
        </button>
      )}

      {/* Bước 2: Hoàn thành */}
      {order.done && !order.completed && (
        <button style={S.btn} onClick={() => updateStatus({ completed: true })}>
          🏁 Hoàn thành
        </button>
      )}

      {/* Xong hẳn */}
      {order.done && order.completed && (
        <div style={{ fontWeight: 700 }}>✅ Đã hoàn thành</div>
      )}
    </>
  )}

  {/* ========== ĐƠN THƯỜNG (normal) ========== */}
  {(!order.type || order.type === "normal") && (
    <>
      {/* Đã hoàn thành (xong hết) */}
      {order.done && order.shipped && order.completed && (
        <div style={{ fontWeight: 700 }}>✅ Đã hoàn thành</div>
      )}

      {/* Chưa làm gì -> Đã xong */}
      {!order.done && !order.shipped && !order.completed &&
        hasPermission(PERMISSIONS.MARK_DONE) && (
          <button style={S.btn} onClick={() => updateStatus({ done: true })}>
            Đã xong
          </button>
      )}

      {/* Đã xong -> Giao / Hoàn thành */}
      {order.done && !order.shipped && !order.completed && (
        <>
          {hasPermission(PERMISSIONS.MARK_DELIVERED) && (
            <button style={S.btn} onClick={() => updateStatus({ shipped: true })}>
              🚚 Giao
            </button>
          )}

          {hasPermission(PERMISSIONS.COMPLETE_ORDER) && (
            <button style={S.btn} onClick={() => updateStatus({ completed: true })}>
              🏁 Hoàn thành
            </button>
          )}
        </>
      )}

      {/* Đã giao -> Hoàn thành */}
      {order.shipped && !order.completed &&
        hasPermission(PERMISSIONS.COMPLETE_ORDER) && (
          <button style={S.btn} onClick={() => updateStatus({ completed: true })}>
            🏁 Hoàn thành
          </button>
      )}

      {/* Đã hoàn thành nhưng chưa giao -> Giao */}
      {order.completed && !order.shipped &&
        hasPermission(PERMISSIONS.MARK_DELIVERED) && (
<button style={S.btn} onClick={() => updateStatus({ shipped: true })}>
            🚚 Giao
          </button>
      )}
    </>
  )}

</div>
    {/* ===== BÊN PHẢI: HÀNH ĐỘNG ===== */}
    <div style={{ display: "flex", gap: 6 }}>

      {/* LÀM LẠI */}
      {hasPermission(PERMISSIONS.EDIT_ORDER) && (
  <button
    style={S.btn}
    onClick={() => {
      updateStatus({
        done: false,
        shipped: false,
        completed: false
      });
      navigate("/");
    }}
  >
    Làm lại
  </button>
)}

      {hasPermission(PERMISSIONS.EDIT_ORDER) && (
  <button style={S.btn} onClick={handleEdit}>
    Sửa đơn
  </button>
)}

      {hasPermission(PERMISSIONS.DELETE_ORDER) && (
  <button style={S.btnDanger} onClick={handleDelete}>
    Xoá
  </button>
)}

    </div>

  </div>
);
}
const S = {
  actionRow: {
  display: "flex",
  justifyContent: "space-between",   // 👈 thêm dòng này
  alignItems: "center",
  marginTop: 6
},

  btn: {
    background: "#2c2c2c",
    color: "#e0e0e0",
    border: "1px solid #3a3a3a",
    borderRadius: 6,
    padding: "4px 8px",
    fontSize: 12,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    whiteSpace: "nowrap",
    cursor: "pointer"
  },

  btnDanger: {
    background: "#b91c1c",
    color: "#fff",
    border: "1px solid #b91c1c",
    borderRadius: 6,
    padding: "4px 8px",
    fontSize: 12,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    whiteSpace: "nowrap",
    cursor: "pointer"
  },

  btnActive: {
    background: "#166534",
    color: "#fff",
    border: "1px solid #166534",
    borderRadius: 6,
    padding: "4px 8px",
    fontSize: 12,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    whiteSpace: "nowrap",
    cursor: "pointer"
  }
};
