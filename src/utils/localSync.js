import { supabase } from "../supabaseClient";
import { getCurrentUser } from "./auth";

const DB_NAME = "sonphu-local-data";
const DB_VERSION = 3;
const DRAFT_DB_NAME = "sonphu-order-drafts";
const DRAFT_DB_VERSION = 1;
const EVENT_TTL_MS = 24 * 60 * 60 * 1000;
const IMAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const STORE_BY_TYPE = {
  order: "orders",
  order_message: "orderMessages",
  order_image: "orderImages",
  order_message_image: "orderMessageImages",
  group_message: "groupMessages",
  group_message_image: "groupMessageImages",
  order_edit_history: "orderEditHistory",
};

let dbPromise;
let draftDbPromise;
const objectUrls = new Map();
const pendingImageCaches = new Map();

const LOCAL_STORE_NAMES = [
  "orders",
  "orderMessages",
  "orderImages",
  "orderMessageImages",
  "groupMessages",
  "groupMessageImages",
  "orderEditHistory",
  "orderDrafts",
  "imageBlobs",
  "meta",
];

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function openLocalDataDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      LOCAL_STORE_NAMES.forEach((name) => {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

export async function putLocal(storeName, value) {
  if (!value?.id) return;
  const db = await openLocalDataDB();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).put(value);
  await transactionDone(tx);
}

export async function putManyLocal(storeName, values = []) {
  if (!values.length) return;
  const db = await openLocalDataDB();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  values.forEach((value) => value?.id && store.put(value));
  await transactionDone(tx);
}

export async function getAllLocal(storeName) {
  const db = await openLocalDataDB();
  const tx = db.transaction(storeName, "readonly");
  return requestResult(tx.objectStore(storeName).getAll());
}

export async function deleteLocal(storeName, id) {
  const db = await openLocalDataDB();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).delete(id);
  await transactionDone(tx);
}

function openOrderDraftDB() {
  if (draftDbPromise) return draftDbPromise;
  draftDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DRAFT_DB_NAME, DRAFT_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("drafts")) {
        db.createObjectStore("drafts", { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        draftDbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Kho bản tạm đang bị khóa bởi một tab cũ"));
  });
  return draftDbPromise;
}

export async function putOrderDraft(value) {
  if (!value?.id) return;
  const db = await openOrderDraftDB();
  const tx = db.transaction("drafts", "readwrite");
  tx.objectStore("drafts").put(value);
  await transactionDone(tx);
}

export async function getAllOrderDrafts() {
  const db = await openOrderDraftDB();
  const tx = db.transaction("drafts", "readonly");
  return new Promise((resolve, reject) => {
    const request = tx.objectStore("drafts").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteOrderDraft(id) {
  if (!id) return;
  const db = await openOrderDraftDB();
  const tx = db.transaction("drafts", "readwrite");
  tx.objectStore("drafts").delete(id);
  await transactionDone(tx);
}

export async function clearLocalData() {
  const db = await openLocalDataDB();
  const availableStores = LOCAL_STORE_NAMES.filter((name) => db.objectStoreNames.contains(name));
  const tx = db.transaction(availableStores, "readwrite");
  availableStores.forEach((name) => tx.objectStore(name).clear());
  await transactionDone(tx);

  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
  pendingImageCaches.clear();
}

export async function cacheImage(url) {
  if (!url) return url;
  if (objectUrls.has(url)) return objectUrls.get(url);
  if (pendingImageCaches.has(url)) return pendingImageCaches.get(url);

  const pending = cacheImageOnce(url).finally(() => pendingImageCaches.delete(url));
  pendingImageCaches.set(url, pending);
  return pending;
}

async function cacheImageOnce(url) {
  const db = await openLocalDataDB();
  const readTx = db.transaction("imageBlobs", "readonly");
  const existing = await requestResult(readTx.objectStore("imageBlobs").get(url));
  if (existing?.blob && Date.now() - new Date(existing.cached_at || 0).getTime() < IMAGE_CACHE_TTL_MS) {
    return localImageUrl(url, existing.blob);
  }
  if (existing?.blob) {
    const removeTx = db.transaction("imageBlobs", "readwrite");
    removeTx.objectStore("imageBlobs").delete(url);
    await transactionDone(removeTx);
    const staleObjectUrl = objectUrls.get(url);
    if (staleObjectUrl) {
      URL.revokeObjectURL(staleObjectUrl);
      objectUrls.delete(url);
    }
  }

  try {
    const response = await fetch(url);
    if (!response.ok) return url;
    const blob = await response.blob();
    const writeTx = db.transaction("imageBlobs", "readwrite");
    writeTx.objectStore("imageBlobs").put({ id: url, blob, cached_at: new Date().toISOString() });
    await transactionDone(writeTx);
    return localImageUrl(url, blob);
  } catch {
    return url;
  }
}

function localImageUrl(key, blob) {
  if (!objectUrls.has(key)) objectUrls.set(key, URL.createObjectURL(blob));
  return objectUrls.get(key);
}

export async function resolveCachedImage(url) {
  if (!url) return url;
  const db = await openLocalDataDB();
  const tx = db.transaction("imageBlobs", "readonly");
  const row = await requestResult(tx.objectStore("imageBlobs").get(url));
  return row?.blob ? localImageUrl(url, row.blob) : url;
}

async function requiredUserIds() {
  const { data } = await supabase.from("users").select("id");
  return (data || []).map((user) => user.id);
}

export async function applySyncEvent(event) {
  const storeName = STORE_BY_TYPE[event?.entity_type];
  if (!storeName || !event?.entity_id) return false;

  if (event.operation === "delete") {
    await deleteLocal(storeName, event.entity_id);
    return true;
  }

  const payload = { ...(event.payload || {}), id: event.entity_id };
  // Keep remote image rows lightweight. Image bytes are cached by the image
  // component only when it approaches the viewport.
  if (payload.image_url && !String(payload.image_url).startsWith("data:")) {
    delete payload.local_image_url;
  }
  await putLocal(storeName, payload);
  return true;
}

export async function acknowledgeSyncEvent(eventId) {
  const me = getCurrentUser();
  if (!eventId || !me?.id) return;
  const { error } = await supabase.rpc("ack_sync_event", {
    p_event_id: eventId,
    p_user_id: me.id,
  });
  if (error && error.code !== "PGRST202") console.log("ACK SYNC EVENT ERROR:", error);
}

export async function publishSyncEvent({ entityType, entityId, operation = "upsert", payload = {}, storagePaths = [] }) {
  const me = getCurrentUser();
  if (!entityType || !entityId || !me?.id) return null;
  const required = await requiredUserIds();
  const now = new Date();
  const event = {
    entity_type: entityType,
    entity_id: String(entityId),
    operation,
    payload,
    storage_paths: storagePaths,
    required_user_ids: required,
    received_by: [me.id],
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + EVENT_TTL_MS).toISOString(),
  };
  await applySyncEvent(event);
  const { data, error } = await supabase.from("sync_events").insert(event).select().single();
  if (error) {
    if (error.code !== "42P01") console.log("PUBLISH SYNC EVENT ERROR:", error);
    return null;
  }
  return data;
}

export async function pullSyncEvents(onApplied) {
  const me = getCurrentUser();
  if (!me?.id) return [];
  const { data, error } = await supabase
    .from("sync_events")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    if (error.code !== "42P01") console.log("PULL SYNC EVENTS ERROR:", error);
    return [];
  }
  for (const event of data || []) {
    if ((event.received_by || []).includes(me.id)) continue;
    const applied = await applySyncEvent(event);
    if (applied) {
      await acknowledgeSyncEvent(event.id);
      await onApplied?.(event);
    }
  }
  return data || [];
}

export function subscribeSyncEvents(onApplied, onStatus) {
  const channel = supabase
    .channel(`local-sync-${crypto.randomUUID()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "sync_events" }, async ({ new: event }) => {
      const me = getCurrentUser();
      if (!me?.id || (event.received_by || []).includes(me.id)) return;
      const applied = await applySyncEvent(event);
      if (applied) {
        await acknowledgeSyncEvent(event.id);
        await onApplied?.(event);
      }
    })
    .subscribe((status) => onStatus?.(status));
  return () => supabase.removeChannel(channel);
}

export { STORE_BY_TYPE };
