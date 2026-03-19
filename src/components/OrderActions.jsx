import { supabase } from "../supabaseClient";
import { useNavigate } from "react-router-dom";
import { hasPermission, PERMISSIONS } from "../utils/permissions";
import { getCurrentUser } from "../utils/auth";

export default function OrderActions({ order, onUpdated }) {
  const navigate = useNavigate();
  const me = getCurrentUser();

  const actorId = me?.id;
  const actorName = me?.name || me?.username || "Không rõ";

  async function updateStatus(updateData, goHome = true) {
    const { data, error } = await supabase
      .from("orders")
      .update(updateData)
      .eq("id", order.id)
      .select()
      .single();

    if (error) {
      console.log("UPDATE ORDER ERROR:", error);
      return;
    }

    onUpdated?.(data);

    if (goHome) {
      navigate("/", { replace: true });
    }
  }

  function handleEdit() {
    const ok = window.confirm("Bạn muốn sửa đơn này?");
    if (!ok) return;
    navigate("/create", { state: { editing: order } });
  }

  async function handleDelete() {
    if (!window.confirm("Bạn muốn xóa đơn này?")) return;

    const { error } = await supabase
      .from("orders")
      .delete()
      .eq("id", order.id);

    if (error) {
      console.log("DELETE ORDER ERROR:", error);
      return;
    }

    navigate("/", { replace: true });
  }

  async function handleReset() {
    await updateStatus(
      {
        status: "new",
        done_by_name: "",
        delivered_by_name: "",
        completed_by_name: "",
        understood_by: [],
      },
      true
    );
  }

  async function handleSystemMessageAck() {
    const oldUnderstood = Array.isArray(order.understood_by)
      ? order.understood_by
      : Array.isArray(order.understoodBy)
      ? order.understoodBy
      : [];

    const requiredUsers = Array.isArray(order.required_users)
      ? order.required_users
      : Array.isArray(order.requiredUsers)
      ? order.requiredUsers
      : [];

    const nextUnderstood =
      actorId && !oldUnderstood.includes(actorId)
        ? [...oldUnderstood, actorId]
        : oldUnderstood;

    const updateData = {
      understood_by: nextUnderstood,
    };

    const allUnderstood =
      requiredUsers.length > 0 &&
      requiredUsers.every((userId) => nextUnderstood.includes(userId));

    if (allUnderstood) {
      updateData.status = "done";
      updateData.done_by_name = actorName;
    }

    await updateStatus(updateData, true);
  }

  const isNormal = !order.type || order.type === "normal";
  const isSystemTask = order.type === "system_task";
  const isSystemMessage = order.type === "system_message";

  return (
    <div style={S.actionRow}>
      {/* ===== BÊN TRÁI: TRẠNG THÁI ===== */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {/* ========== SYSTEM TASK ========== */}
        {isSystemTask && (
          <>
            {order.status === "new" &&
              hasPermission(PERMISSIONS.MARK_DONE) && (
                <button
                  style={S.btn}
                  onClick={() =>
                    updateStatus({
                      status: "done",
                      done_by_name: actorName,
                    })
                  }
                >
                  ✔ Đã xong
                </button>
              )}

            {order.status === "done" &&
              hasPermission(PERMISSIONS.COMPLETE_ORDER) && (
                <button
                  style={S.btn}
                  onClick={() =>
                    updateStatus({
                      status: "completed",
                      completed_by_name: actorName,
                    })
                  }
                >
                  🏁 Hoàn thành
                </button>
              )}

            {order.status === "completed" && (
              <div style={{ fontWeight: 700 }}>✅ Đã hoàn thành</div>
            )}
          </>
        )}

        {/* ========== SYSTEM MESSAGE ========== */}
        {isSystemMessage && (
          <>
            {order.status === "new" &&
              hasPermission(PERMISSIONS.MARK_DONE) && (
                <button style={S.btn} onClick={handleSystemMessageAck}>
                  👁 Đã hiểu
                </button>
              )}

            {order.status === "done" &&
              hasPermission(PERMISSIONS.COMPLETE_ORDER) && (
                <button
                  style={S.btn}
                  onClick={() =>
                    updateStatus({
                      status: "completed",
                      completed_by_name: actorName,
                    })
                  }
                >
                  🏁 Hoàn thành
                </button>
              )}

            {order.status === "completed" && (
              <div style={{ fontWeight: 700 }}>✅ Đã hoàn thành</div>
            )}
          </>
        )}

        {/* ========== ĐƠN THƯỜNG ========== */}
        {isNormal && (
          <>
            {order.status === "completed" && order.delivered_by_name && (
              <div style={{ fontWeight: 700 }}>✅ Đã hoàn thành</div>
            )}

            {order.status === "new" &&
              hasPermission(PERMISSIONS.MARK_DONE) && (
                <button
                  style={S.btn}
                  onClick={() =>
                    updateStatus({
                      status: "done",
                      done_by_name: actorName,
                    })
                  }
                >
                  ✔ Đã xong
                </button>
              )}

            {order.status === "done" && (
              <>
                {hasPermission(PERMISSIONS.MARK_DELIVERED) && (
                  <button
                    style={S.btn}
                    onClick={() =>
                      updateStatus({
                        status: "delivered",
                        delivered_by_name: actorName,
                      })
                    }
                  >
                    🚚 Giao
                  </button>
                )}

                {hasPermission(PERMISSIONS.COMPLETE_ORDER) && (
                  <button
                    style={S.btn}
                    onClick={() =>
                      updateStatus({
                        status: "completed",
                        completed_by_name: actorName,
                      })
                    }
                  >
                    🏁 Hoàn thành
                  </button>
                )}
              </>
            )}

            {order.status === "delivered" &&
              hasPermission(PERMISSIONS.COMPLETE_ORDER) && (
                <button
                  style={S.btn}
                  onClick={() =>
                    updateStatus({
                      status: "completed",
                      completed_by_name: actorName,
                    })
                  }
                >
                  🏁 Hoàn thành
                </button>
              )}

            {order.status === "completed" &&
              !order.delivered_by_name &&
              hasPermission(PERMISSIONS.MARK_DELIVERED) && (
                <button
                  style={S.btn}
                  onClick={() =>
                    updateStatus({
                      status: "completed",
                      delivered_by_name: actorName,
                    })
                  }
                >
                  🚚 Giao
                </button>
              )}
          </>
        )}
      </div>

      {/* ===== BÊN PHẢI: HÀNH ĐỘNG ===== */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {hasPermission(PERMISSIONS.EDIT_ORDER) && (
          <button style={S.btn} onClick={handleReset}>
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
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
    gap: 8,
    flexWrap: "wrap",
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
    cursor: "pointer",
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
    cursor: "pointer",
  },
};