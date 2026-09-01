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
