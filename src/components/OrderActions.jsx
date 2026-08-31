import { supabase } from "../supabaseClient";
import { useNavigate } from "react-router-dom";
import { hasPermission, PERMISSIONS } from "../utils/permissions";
import { getCurrentUser } from "../utils/auth";
import { publishSyncEvent, putLocal } from "../utils/localSync";

export default function OrderActions({ order, onUpdated }) {
  const navigate = useNavigate();
  const me = getCurrentUser();

  const actorId = me?.id;
  const actorName = me?.name || me?.username || "Không rõ";

  async function updateStatus(updateData) {
    const now = new Date().toISOString();
    const timedUpdate = { ...updateData };
    if (updateData.status === "done" && updateData.done_by_name) timedUpdate.done_at = now;
    if (updateData.delivered_by_name) timedUpdate.delivered_at = now;
    if (updateData.status === "completed" && updateData.completed_by_name) timedUpdate.completed_at = now;

    const { data, error } = await supabase
      .from("orders")
      .update(timedUpdate)
      .eq("id", order.id)
      .select()
      .single();

    if (error) {
      console.log("UPDATE ORDER ERROR:", error);
      return;
    }

    const { error: historyError } = await supabase.from("order_edit_history").insert({
      order_id: order.id,
      editor_id: actorId || null,
      editor_name: actorName,
      action: "status",
      before_data: {
        status: order.status || "",
        done_by_name: order.done_by_name || "",
        delivered_by_name: order.delivered_by_name || "",
        completed_by_name: order.completed_by_name || "",
      },
      after_data: {
        status: data.status || timedUpdate.status || "",
        done_by_name: data.done_by_name || timedUpdate.done_by_name || "",
        delivered_by_name: data.delivered_by_name || timedUpdate.delivered_by_name || "",
        completed_by_name: data.completed_by_name || timedUpdate.completed_by_name || "",
      },
    });
    if (historyError) console.log("SAVE STATUS HISTORY ERROR:", historyError);

    onUpdated?.(data);
    await putLocal("orders", data);
    void publishSyncEvent({ entityType: "order", entityId: order.id, payload: data });

    const statusTab = data.status === "new"
      ? "new"
      : data.status === "done"
      ? "done"
      : data.status === "delivered"
      ? "delivered"
      : "completed";
    navigate("/", {
      replace: true,
      state: { focusOrderId: order.id, statusTab },
    });

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

    await publishSyncEvent({ entityType: "order", entityId: order.id, operation: "delete" });

    navigate("/", { replace: true });
  }

  async function handleReset() {
    await updateStatus(
      {
        status: "new",
        done_by_name: "",
        delivered_by_name: "",
        completed_by_name: "",
        done_at: null,
        delivered_at: null,
        completed_at: null,
        needs_rework: true,
        understood_by: [],
      }
    );
  }

  async function handleSystemMessageAck() {
    const oldUnderstood = Array.isArray(order.understood_by)
      ? order.understood_by
      : Array.isArray(order.understoodBy)
      ? order.understoodBy
      : [];

    const requiredUsers = (Array.isArray(order.required_users)
      ? order.required_users
      : Array.isArray(order.requiredUsers)
      ? order.requiredUsers
      : []).filter((userId) => userId !== order.created_by);

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
      updateData.needs_rework = false;
    }

    await updateStatus(updateData);
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
            {order.status === "new" && actorId !== order.created_by &&
              hasPermission(PERMISSIONS.MARK_DONE) && (
                <button
                  style={S.btn}
                  onClick={() =>
                    updateStatus({
                      status: "done",
                      done_by_name: actorName,
                      needs_rework: false,
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
                      needs_rework: false,
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
        {hasPermission(PERMISSIONS.EDIT_ORDER) &&
          !(isNormal && order.status === "completed" && order.delivered_by_name) && (
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
    background: "#fff3d6",
    color: "#4d3218",
    border: "1px solid #d1aa62",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 14,
    height: 34,
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
    padding: "6px 10px",
    fontSize: 14,
    height: 34,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
};
