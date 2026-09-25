import { supabase } from "../supabaseClient";

const SESSION_KEY = "sonphu-session-token";

export function getSessionToken() {
  return localStorage.getItem(SESSION_KEY) || "";
}

export function clearSessionToken() {
  localStorage.removeItem(SESSION_KEY);
}

export async function loginWithSession(username, password) {
  try {
    const { data, error } = await supabase.functions.invoke("auth-session", { body: { action: "login", username, password } });
    if (error || !data?.ok || !data?.token || !data?.user) return null;
    localStorage.setItem(SESSION_KEY, data.token);
    return data.user;
  } catch {
    return null;
  }
}

export async function verifySession() {
  const token = getSessionToken();
  if (!token) return null;
  try {
    const { data, error } = await supabase.functions.invoke("auth-session", { body: { action: "verify", token } });
    if (error || !data?.ok) { clearSessionToken(); return null; }
    return data.user || null;
  } catch { return null; }
}
