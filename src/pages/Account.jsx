import { supabase } from "../supabaseClient";
import { useEffect, useMemo, useState } from "react";
import { PERMISSIONS, PERMISSION_UI, hasPermission } from "../utils/permissions";
import {
  getUsers,
  saveUsers,
  getCurrentUser,
  setCurrentUser,
  logout,
  initDefaultAdmin,
  deleteUserById,
} from "../utils/auth";
import { resetAllData } from "../utils/resetSystem";
import { clearLocalData } from "../utils/localSync";

// helper

const uid = () => crypto.randomUUID();

const normalizePerms = (p) => (Array.isArray(p) ? p : []);

const uniq = (arr) => Array.from(new Set(arr));

const hasFull = (perms) => normalizePerms(perms).includes(PERMISSIONS.FULL_ACCESS);

function PermissionChecklist({ value, onChange }) {
  const perms = normalizePerms(value);

  const toggle = (code) => {
    if (code === PERMISSIONS.FULL_ACCESS) {
      if (perms.includes(PERMISSIONS.FULL_ACCESS)) {
        onChange(perms.filter((x) => x !== PERMISSIONS.FULL_ACCESS));
      } else {
        onChange(uniq([PERMISSIONS.FULL_ACCESS, ...perms]));
      }
      return;
    }

    // nếu đang full_access mà tắt/bật lẻ, vẫn giữ full_access? -> không. Full quyền là chế độ riêng.
    // Người quản trị muốn tick lẻ thì bỏ full_access.
    let base = perms.filter((x) => x !== PERMISSIONS.FULL_ACCESS);

    if (base.includes(code)) base = base.filter((x) => x !== code);
    else base = uniq([...base, code]);

    onChange(base);
  };

  const allCodes = useMemo(() => {
    const codes = [];
    for (const g of PERMISSION_UI) for (const it of g.items) codes.push(it.code);
    return codes;
  }, []);

  const isChecked = (code) => (code === PERMISSIONS.FULL_ACCESS ? hasFull(perms) : perms.includes(code));

  const selectAll = () => onChange(uniq([...allCodes]));
  const clearAll = () => onChange([]);

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
          <input
            type="checkbox"
            checked={isChecked(PERMISSIONS.FULL_ACCESS)}
            onChange={() => toggle(PERMISSIONS.FULL_ACCESS)}
          />
          Cấp toàn quyền (Full quyền)
        </label>

        <button type="button" onClick={selectAll} style={btnMini()}>
          Tick tất cả
        </button>
        <button type="button" onClick={clearAll} style={btnMini()}>
          Bỏ tick tất cả
        </button>

        {hasFull(perms) && (
          <span style={{ fontSize: 15, color: "#b00" }}>
            Đang bật Full quyền. Nếu tick lẻ, Full quyền sẽ tự tắt.
          </span>
        )}
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
        {PERMISSION_UI.map((group) => (
          <div key={group.title} style={{ padding: 10, borderRadius: 10, background: "#fff7e6" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{group.title}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
              {group.items.map((it) => (
                <label key={it.code} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={hasFull(perms) ? true : isChecked(it.code)}
                    disabled={hasFull(perms)}
                    onChange={() => toggle(it.code)}
                  />
                  {it.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function btnMini() {
  return {
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid #d1aa62",
    background: "#fffaf0",
    cursor: "pointer",
    fontSize: 15,
  };
}

function btnPrimary() {
  return {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #8a560f",
    background: "#b98224",
    color: "#fffaf0",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 16,
  };
}

function btnDangerMini() {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid #b00",
    background: "white",
    color: "#b00",
    cursor: "pointer",
    fontSize: 15,
    fontWeight: 700,
  };
}

function cardStyle() {
  return {
    border: "1px solid #d8b36a",
    borderRadius: 14,
    padding: 14,
    background: "#fffaf0",
    boxShadow: "0 3px 12px rgba(91,55,22,.1)",
  };
}

export default function Account() {
  // init admin default (chạy 1 lần)
  useEffect(() => {
  (async () => {
    await initDefaultAdmin();
  })();
}, []);

  const [currentUser, setCurrentUserState] = useState(() => getCurrentUser());
  const [users, setUsers] = useState([]);
useEffect(() => {
  (async () => {
    const u = await getUsers();
    setUsers(u);
  })();
}, []);
useEffect(() => {
  const channel = supabase
    .channel("users-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "users" },
      async () => {
        const u = await getUsers();
        setUsers(u);
      }
    )
    .subscribe();

  return () => {
    channel.unsubscribe(); // 👈 sửa ở đây
  };
}, []);
  // My account form
  const [myName, setMyName] = useState(currentUser?.name || "");
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");

  // Create staff
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffUsername, setNewStaffUsername] = useState("");
  const [newStaffPassword, setNewStaffPassword] = useState("");

  // Selected user for permission edit
  const [selectedUserId, setSelectedUserId] = useState(null);
  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) || null,
    [users, selectedUserId]
  );
  const [editPerms, setEditPerms] = useState([]);

  // Stats
  const [stats, setStats] = useState({
  newCount: 0,
  doneCount: 0,
  deliveredCount: 0,
  completedCount: 0,
});

  // Reset confirm
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const canManageUsers = hasPermission(PERMISSIONS.MANAGE_USERS) || hasPermission(PERMISSIONS.FULL_ACCESS);
  const canViewStats = hasPermission(PERMISSIONS.VIEW_STATS) || hasPermission(PERMISSIONS.FULL_ACCESS);
  const canReset = hasPermission(PERMISSIONS.RESET_DATA) || hasPermission(PERMISSIONS.FULL_ACCESS);

  const refreshUsers = async () => {
  const u = await getUsers();
  setUsers(u);
};
const loadOrderStats = async () => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const { data, error } = await supabase
      .from("orders")
      .select("status, created_at")
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString());

    if (error) {
      console.error(error);
      return;
    }

    const nextStats = {
      newCount: 0,
      doneCount: 0,
      deliveredCount: 0,
      completedCount: 0,
    };

    data.forEach((o) => {
      if (o.status === "new") nextStats.newCount++;
      if (o.status === "done" || o.status === "da_xong") nextStats.doneCount++;
      if (o.status === "delivered" || o.status === "giao") nextStats.deliveredCount++;
      if (o.status === "completed" || o.status === "hoan_thanh") nextStats.completedCount++;
    });

    setStats(nextStats);
  } catch (err) {
    console.error(err);
  }
};

  useEffect(() => {
    const timer = window.setTimeout(loadOrderStats, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const persistUsers = async (nextUsers) => {
  await saveUsers(nextUsers);
  setUsers(nextUsers);

  const cu = getCurrentUser();
  if (cu) {
    const newer = nextUsers.find((x) => x.id === cu.id);
    if (newer) {
      setCurrentUser(newer);
      setCurrentUserState(newer);
    }
  }
};

  const onSaveMyAccount = async () => {
    const cu = getCurrentUser();
    if (!cu) {
      alert("Chưa đăng nhập.");
      return;
    }

    // update name
    const nextUsers = users.map((u) => (u.id === cu.id ? { ...u, name: myName || u.name } : u));
await persistUsers(nextUsers);
    alert("Đã lưu tên hiển thị.");
  };

  const onChangePassword = async () => {
    const cu = getCurrentUser();
    if (!cu) return alert("Chưa đăng nhập.");

    if (!hasPermission(PERMISSIONS.CHANGE_PASSWORD) && !hasPermission(PERMISSIONS.FULL_ACCESS)) {
      return alert("Tài khoản của bạn chưa được cấp quyền đổi mật khẩu.");
    }

    if (!oldPass || !newPass || !newPass2) return alert("Nhập đủ mật khẩu cũ/mới.");
    if (newPass !== newPass2) return alert("Mật khẩu mới nhập lại không khớp.");
    if (oldPass !== cu.password) return alert("Mật khẩu cũ không đúng.");

    const nextUsers = users.map((u) => (u.id === cu.id ? { ...u, password: newPass } : u));
await persistUsers(nextUsers);

    setOldPass("");
    setNewPass("");
    setNewPass2("");
    alert("Đổi mật khẩu thành công.");
  };

  const onCreateStaff = async () => {
    if (!canManageUsers) return alert("Bạn không có quyền quản lý tài khoản nhân viên.");
    if (!newStaffName.trim()) return alert("Nhập tên nhân viên.");
    if (!newStaffUsername.trim()) return alert("Nhập username.");
    if (!newStaffPassword.trim()) return alert("Nhập mật khẩu.");

    const existing = users.find((u) => u.username === newStaffUsername.trim());
    if (existing) return alert("Username đã tồn tại.");

    const newUser = {
id: uid(),
  name: newStaffName.trim(),
  username: newStaffUsername.trim(),
  password: newStaffPassword,
role: "staff",
  permissions: [],
  created_at: new Date().toISOString(),
};

    const nextUsers = [newUser, ...users];
await persistUsers(nextUsers);   // 👈 thêm dòng này
    

    setNewStaffName("");
    setNewStaffUsername("");
    setNewStaffPassword("");
    alert("Đã tạo tài khoản nhân viên. Hãy chọn nhân viên và tick quyền.");
  };

  const onSavePermissions = async () => {
    if (!canManageUsers) return alert("Bạn không có quyền quản lý tài khoản nhân viên.");
    if (!selectedUser) return alert("Chọn 1 nhân viên để phân quyền.");

    const nextUsers = users.map((u) => (u.id === selectedUser.id ? { ...u, permissions: uniq(editPerms) } : u));
    await persistUsers(nextUsers);
    alert("Đã lưu phân quyền.");
  };

 const onDeleteUser = async () => {
  if (!canManageUsers) return alert("Bạn không có quyền quản lý tài khoản nhân viên.");
  if (!selectedUser) return alert("Chọn 1 nhân viên để xoá.");

  const cu = getCurrentUser();

  // ❌ Không cho xoá chính mình
  if (cu && selectedUser.id === cu.id)
    return alert("Không thể xoá chính bạn đang đăng nhập.");

  // ❌ Không cho xoá tài khoản có full_access (admin)
  if (selectedUser.permissions?.includes("full_access"))
    return alert("Không thể xoá tài khoản Quản trị.");

  if (!confirm(`Xoá tài khoản "${selectedUser.name}"?`)) return;

  const ok = await deleteUserById(selectedUser.id);
if (!ok) return alert("Xóa tài khoản thất bại.");

setSelectedUserId(null);
setEditPerms([]);
await refreshUsers();
alert("Đã xóa tài khoản.");
};

  const onLogout = () => {
    logout();
    // nếu bạn có router: navigate("/login") ở đây
    window.location.reload();
  };

  const onClearThisDevice = async () => {
    const accepted = confirm(
      "Xóa các đơn, tin nhắn và ảnh đã lưu trên thiết bị này? Dữ liệu trên Supabase và tài khoản đăng nhập không bị xóa."
    );
    if (!accepted) return;

    try {
      await clearLocalData();
      alert("Đã xóa dữ liệu cũ trên thiết bị này. App sẽ tải lại dữ liệu còn có trên Supabase.");
      window.location.reload();
    } catch (error) {
      console.error("CLEAR LOCAL DATA ERROR:", error);
      alert("Chưa xóa được dữ liệu trên thiết bị. Hãy đóng app, mở lại rồi thử lần nữa.");
    }
  };

  const openResetConfirm = () => {
    if (!canReset) return alert("Bạn không có quyền reset dữ liệu.");
    setResetConfirmText("");
    setShowResetConfirm(true);
  };

  const doReset = () => {
    // bắt buộc gõ chữ để tránh bấm nhầm
    if (resetConfirmText.trim().toUpperCase() !== "XOA") {
      alert('Bạn phải gõ đúng chữ "XOA" để xác nhận.');
      return;
    }
    resetAllData();
  };

  return (
    <div style={{ minHeight: "100dvh", padding: 16, paddingBottom: 80, maxWidth: 980, margin: "0 auto", background: "#f5efe3", color: "#3d2b1b", fontSize: 17 }}>
      <h2 style={{ margin: "8px 0 14px", fontSize: 30 }}>Tài khoản</h2>

      {/* 1) My account */}
      <div style={cardStyle()}>
        <h3 style={{ marginTop: 0 }}>1) Tài khoản của tôi</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>Tên hiển thị</div>
            <input
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              placeholder="Nhập tên hiển thị"
              style={inputStyle()}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>Username</div>
            <div style={{ padding: "10px 12px", border: "1px solid #dec38d", borderRadius: 12, background: "#fff7e6" }}>
              {currentUser?.username || "(chưa đăng nhập)"}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={onSaveMyAccount} style={btnPrimary()}>
              Lưu tên
            </button>
          </div>

          <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "8px 0" }} />

          <h4 style={{ margin: "6px 0" }}>Đổi mật khẩu</h4>
          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>Mật khẩu cũ</div>
            <input
              type="password"
              value={oldPass}
              onChange={(e) => setOldPass(e.target.value)}
              style={inputStyle()}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>Mật khẩu mới</div>
            <input
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              style={inputStyle()}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>Nhập lại</div>
            <input
              type="password"
              value={newPass2}
              onChange={(e) => setNewPass2(e.target.value)}
              style={inputStyle()}
            />
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={onChangePassword} style={btnPrimary()}>
              Đổi mật khẩu
            </button>
            <span style={{ fontSize: 15, color: "#745b3d", alignSelf: "center" }}>
              * Quyền đổi mật khẩu được cấp bằng checkbox “Đổi mật khẩu”.
            </span>
          </div>
        </div>
      </div>

      {/* 2) Create staff */}
      <div style={{ ...cardStyle(), marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>2) Tạo tài khoản nhân viên</h3>
        {!canManageUsers ? (
          <div style={{ color: "#999" }}>Bạn chưa được cấp quyền “Quản lý tài khoản nhân viên”.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
            <input
              value={newStaffName}
              onChange={(e) => setNewStaffName(e.target.value)}
              placeholder="Tên nhân viên"
              style={inputStyle()}
            />
            <input
              value={newStaffUsername}
              onChange={(e) => setNewStaffUsername(e.target.value)}
              placeholder="Username"
              style={inputStyle()}
            />
            <input
              value={newStaffPassword}
              onChange={(e) => setNewStaffPassword(e.target.value)}
              placeholder="Mật khẩu"
              style={inputStyle()}
              type="password"
            />
            <div>
              <button type="button" onClick={onCreateStaff} style={btnPrimary()}>
                Tạo tài khoản
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3) Permissions */}
      <div style={{ ...cardStyle(), marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>3) Phân quyền nhân viên (tick quyền)</h3>

        {!canManageUsers ? (
          <div style={{ color: "#999" }}>Bạn chưa được cấp quyền “Quản lý tài khoản nhân viên”.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
            {/* user list */}
            <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Danh sách nhân viên</div>
              <div style={{ display: "grid", gap: 6, maxHeight: 360, overflow: "auto" }}>
                {users.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      setSelectedUserId(u.id);
                      setEditPerms(normalizePerms(u.permissions));
                    }}
                    style={{
                      textAlign: "left",
                      padding: "10px 10px",
                      borderRadius: 12,
                      border: u.id === selectedUserId ? "2px solid #111" : "1px solid #ddd",
                      background: u.id === selectedUserId ? "#f5f5f5" : "white",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{u.name}</div>
                    <div style={{ fontSize: 15, color: "#745b3d" }}>
                      @{u.username} • {normalizePerms(u.permissions).length} quyền
                    </div>
                  </button>
                ))}
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={refreshUsers} style={btnMini()}>
                  Tải lại
                </button>
                <button type="button" onClick={onDeleteUser} style={btnDangerMini()}>
                  Xóa tài khoản
                </button>
              </div>
            </div>

            {/* permission editor */}
            <div>
              {!selectedUser ? (
                <div style={{ color: "#999" }}>Chọn 1 nhân viên bên trái để phân quyền.</div>
              ) : (
                <>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 800, fontSize: 19 }}>{selectedUser.name}</div>
                    <div style={{ fontSize: 15, color: "#745b3d" }}>@{selectedUser.username}</div>
                  </div>

                  <PermissionChecklist value={editPerms} onChange={setEditPerms} />

                  <div style={{ marginTop: 10 }}>
                    <button type="button" onClick={onSavePermissions} style={btnPrimary()}>
                      Lưu phân quyền
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 5) Stats */}
<div style={{ ...cardStyle(), marginTop: 12 }}>
  <h3 style={{ marginTop: 0 }}>Thống kê hôm nay</h3>

  {!canViewStats ? (
    <div style={{ color: "#999" }}>
      Bạn chưa được cấp quyền "Xem thống kê".
    </div>
  ) : (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <StatBox label="Đơn mới (hôm nay)" value={stats.newCount} />
        <StatBox label="Đơn đã xong (hôm nay)" value={stats.doneCount} />
        <StatBox label="Đơn giao (hôm nay)" value={stats.deliveredCount} />
        <StatBox label="Đơn hoàn thành (hôm nay)" value={stats.completedCount} />
      </div>

      <div style={{ marginTop: 10 }}>
        <button
          type="button"
          onClick={loadOrderStats}
          style={btnMini()}
        >
          Làm mới thống kê
        </button>
      </div>
    </>
  )}
</div>

      {/* 6) Logout + Reset */}
      <div style={{ ...cardStyle(), marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>6) Bộ nhớ thiết bị và đăng xuất</h3>
        <div style={{ marginBottom: 12, color: "#5f4a32", fontSize: 16 }}>
          Dùng nút này khi điện thoại còn hiện đơn, tin nhắn hoặc ảnh cũ. Nút chỉ dọn dữ liệu trên thiết bị đang dùng,
          không xóa tài khoản và không xóa trực tiếp dữ liệu Supabase.
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={onClearThisDevice} style={btnDangerMini()}>
            Xóa dữ liệu cũ trên máy này
          </button>
          <button type="button" onClick={onLogout} style={btnPrimary()}>
            Đăng xuất
          </button>

          {/* Reset nhỏ + xác nhận rõ */}
          {canReset && (
            <button type="button" onClick={openResetConfirm} style={btnDangerMini()}>
              Reset dữ liệu (nhỏ)
            </button>
          )}
        </div>

        {showResetConfirm && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid #f2c2c2", background: "#fff5f5" }}>
            <div style={{ fontWeight: 900, color: "#b00" }}>XÓA TOÀN BỘ DỮ LIỆU</div>
            <div style={{ marginTop: 6, color: "#333" }}>
              Hành động này <b>không thể hoàn tác</b>. Sẽ xóa: đơn hàng, chat, ảnh và bộ nhớ app trên thiết bị. Tài khoản nhân viên vẫn được giữ.
            </div>
            <div style={{ marginTop: 8 }}>
              Để xác nhận, hãy gõ đúng: <b>XOA</b>
            </div>
            <input
              value={resetConfirmText}
              onChange={(e) => setResetConfirmText(e.target.value)}
              placeholder='Gõ "XOA"'
              style={{ ...inputStyle(), marginTop: 8 }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setShowResetConfirm(false)} style={btnMini()}>
                Hủy
              </button>
              <button type="button" onClick={doReset} style={{ ...btnDangerMini(), padding: "10px 14px" }}>
                Xóa tất cả
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 16, fontSize: 15, color: "#745b3d" }}>
        Ghi chú: admin mặc định là <b>admin / 123456</b> (chỉ tạo khi chưa có danh sách users trong localStorage).
      </div>
    </div>
  );
}

function StatBox({ label, value }) {
  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 10,
        padding: 12,
        minWidth: 150,
        background: "#fff7e6"
      }}
    >
      <div style={{ fontSize: 22, fontWeight: "bold" }}>{value}</div>
      <div style={{ fontSize: 16, color: "#745b3d" }}>{label}</div>
    </div>
  );
}

function inputStyle() {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #d1aa62",
    background: "#fffaf0",
    color: "#3d2b1b",
    outline: "none",
    width: "100%",
    fontSize: 17,
  };
}
