// src/utils/auth.js
import { PERMISSIONS } from "./permissions";
import { supabase } from "../supabaseClient";

const uuid = () => crypto.randomUUID();
const USERS_KEY = "users";
const CURRENT_USER_KEY = "currentUser";

const nowIso = () => new Date().toISOString();


// ===== TẠO ADMIN MẶC ĐỊNH =====
export async function initDefaultAdmin() {
  const { data } = await supabase.from("users").select("id").limit(1);
  if (data && data.length > 0) return;

  const { error } = await supabase.from("users").insert([
    {
      id: uuid(),
      name: "Quản trị",
      username: "admin",
      password: "123456",
      role: "admin",
      permissions: [PERMISSIONS.FULL_ACCESS],
      created_at: new Date().toISOString(),
    },
  ]);

  if (error) console.log("INIT ADMIN ERROR:", error);
}

// ===== USERS =====
export async function getUsers() {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .order("created_at", { ascending: true }); // 🔴 đổi đúng tên

  if (error) {
    console.log("GET USERS ERROR:", error);
    return [];
  }

  return data || [];
}

export async function saveUsers(users) {
  const normalized = users.map((u) => ({
    ...u,
    permissions: Array.isArray(u.permissions) ? u.permissions : [],
    created_at: u.created_at || new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("users")
    .upsert(normalized, { onConflict: "id" });

  if (error) console.log("SAVE USERS ERROR:", error);
}


// ===== LOGIN / LOGOUT =====
export async function login(username, password) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("username", username)
    .eq("password", password)
    .single();

  if (error || !data) return false;

  const user = {
  ...data,
  permissions: Array.isArray(data.permissions)
    ? data.permissions
    : (data.permissions ? Object.values(data.permissions) : [])
};

  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
  return true;
}

export function logout() {
  localStorage.removeItem(CURRENT_USER_KEY);
}


// ===== CURRENT USER =====
export function getCurrentUser() {
  try {
    const raw = localStorage.getItem(CURRENT_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCurrentUser(user) {
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
}


// ===== HỖ TRỢ SYSTEM MESSAGE =====
export async function getAllUserIds() {
  const users = await getUsers();
  return users.map((u) => u.id);
}
export async function deleteUserById(userId) {
  const { error } = await supabase
    .from("users")
    .delete()
    .eq("id", userId);

  if (error) {
    console.log("DELETE USER ERROR:", error);
    return false;
  }

  return true;
}
export async function refreshCurrentUser() {
  const current = getCurrentUser();
  if (!current?.id) return null;

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", current.id)
    .single();

  if (error || !data) {
    logout();
    return null;
  }

  const freshUser = {
    ...data,
    permissions: Array.isArray(data.permissions)
      ? data.permissions
      : (data.permissions ? Object.values(data.permissions) : []),
  };

  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(freshUser));
  return freshUser;
}