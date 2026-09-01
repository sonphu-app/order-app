/* global __APP_BUILD_VERSION__ */
import { registerSW } from "virtual:pwa-register";

let updateServiceWorker = null;
let initialized = false;
let updateAvailable = false;

function announceUpdate() {
  updateAvailable = true;
  window.dispatchEvent(new CustomEvent("sonphu-app-update", {
    detail: { available: true },
  }));
}

export const isAppUpdateAvailable = () => updateAvailable;

export function initAppUpdate() {
  if (initialized || typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  initialized = true;
  try {
    updateServiceWorker = registerSW({
      immediate: true,
      onNeedRefresh: announceUpdate,
    });
    const checkVersion = async () => {
      try {
        const response = await fetch(`/app-version.json?ts=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) return;
        const remote = await response.json();
        if (remote.version && remote.version !== __APP_BUILD_VERSION__) announceUpdate();
      } catch {
        // Mạng chập chờn không được làm ảnh hưởng app.
      }
    };
    void checkVersion();
    window.setInterval(checkVersion, 30_000);
  } catch (error) {
    initialized = false;
    console.log("APP UPDATE CHECK ERROR:", error);
  }
}

export async function applyAppUpdate() {
  if (typeof updateServiceWorker === "function") {
    await updateServiceWorker(true);
    return;
  }
  window.location.reload();
}
