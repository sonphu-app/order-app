import { supabase } from "../supabaseClient";
import { getCurrentUser } from "./auth";
import { getSessionToken } from "./sessionAuth";

const configuredOnlineUrl = String(import.meta.env.VITE_SCALE_SERVER_URL || "").trim();
const configuredLanUrl = String(import.meta.env.VITE_SCALE_LAN_URL || "").trim();
const DEFAULT_LAN_URL = "http://192.168.1.12:8787";
const DEFAULT_MACHINE_ID = "scale-head-192-168-1-12";
const SCALE_MACHINE_ID = String(import.meta.env.VITE_SCALE_MACHINE_ID || DEFAULT_MACHINE_ID).trim();
const BRIDGE_FUNCTION_URL = supabase.supabaseUrl + "/functions/v1/scale-bridge";
const BRIDGE_TOKEN_KEY = "scale-bridge-token";

const trimUrl = (value) => String(value || "").trim().replace(/\/$/, "");

const sameOriginScaleUrl = () => {
  if (typeof window === "undefined") return "";
  if (window.location.port === "8787") return window.location.origin;
  if (window.location.hostname === "192.168.1.12") return DEFAULT_LAN_URL;
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return `${window.location.protocol}//${window.location.hostname}:8787`;
  }
  return "";
};

const endpointCandidates = ({ includeOnline = true } = {}) => {
  const candidates = [
    configuredLanUrl,
    DEFAULT_LAN_URL,
    sameOriginScaleUrl(),
    ...(includeOnline ? [configuredOnlineUrl] : []),
  ];
  return [...new Set(candidates.map(trimUrl).filter(Boolean))];
};

let preferredEndpoint = trimUrl(configuredOnlineUrl) || null;

export const SCALE_SERVER_URL = preferredEndpoint || trimUrl(configuredLanUrl) || DEFAULT_LAN_URL;
export const SCALE_ONLINE_URL = trimUrl(configuredOnlineUrl);
export const SCALE_LAN_URL = trimUrl(configuredLanUrl) || DEFAULT_LAN_URL;
const preferCloudApi = () => typeof window !== "undefined" && window.location.port !== "8787";

const scaleUrl = (base, path) => `${base}${path}`;
// Một số trình duyệt/WebView trên máy đầu cân không có randomUUID dù vẫn có
// crypto.getRandomValues. Mã này chỉ dùng làm định danh bản ghi/phiên, không
// dùng làm khóa bảo mật, nên có fallback cho môi trường cũ.
export const createScaleUuid = () => {
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  const randomPart = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0");
  return `${Date.now().toString(16)}-${randomPart()}-${randomPart()}-${randomPart()}`;
};

const unpackSeriesId = (value) => {
  const text = String(value || "");
  const marker = text.lastIndexOf("::op:");
  if (marker < 0) return { seriesId: text, operatorName: "" };
  let operatorName = "";
  try { operatorName = decodeURIComponent(text.slice(marker + 5)); } catch { operatorName = text.slice(marker + 5); }
  return { seriesId: text.slice(0, marker), operatorName };
};

const normalizeWeightPair = (weighing) => {
  let gross = Math.round(Number(weighing.gross) || 0);
  let tare = Math.round(Number(weighing.tare) || 0);
  let grossAt = weighing.grossAt || null;
  let tareAt = weighing.tareAt || null;
  if (gross > 0 && tare > 0 && gross < tare) {
    [gross, tare] = [tare, gross];
    [grossAt, tareAt] = [tareAt, grossAt];
  }
  return { gross, tare, net: gross - tare, grossAt, tareAt };
};

async function requestFromEndpoint(base, path, options = {}) {
  const controller = options.signal ? null : new AbortController();
  const timeoutMs = Number(options.scaleTimeoutMs) > 0 ? Number(options.scaleTimeoutMs) : 4500;
  const timeout = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  const requestOptions = {
    ...options,
    signal: options.signal || controller.signal,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  };

  try {
  const response = await fetch(scaleUrl(base, path), {
    ...requestOptions,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Máy chủ cân trả về lỗi ${response.status}`);
  }

    return response.json();
  } finally {
    if (timeout) window.clearTimeout(timeout);
  }
}

async function scaleRequest(path, options = {}) {
  const { allowOnline = true, ...requestOptions } = options;
  const localCandidates = endpointCandidates({ includeOnline: false });
  const candidates = [
    ...localCandidates,
    ...(allowOnline ? endpointCandidates().filter((endpoint) => !localCandidates.includes(endpoint)) : []),
  ];
  const localOrigin = sameOriginScaleUrl();
  const isScaleMachinePage = typeof window !== "undefined" && window.location.port === "8787" && Boolean(localOrigin);
  if (isScaleMachinePage && candidates.includes(localOrigin)) {
    candidates.splice(candidates.indexOf(localOrigin), 1);
    candidates.unshift(localOrigin);
  } else if (preferredEndpoint && candidates.includes(preferredEndpoint) && localCandidates.includes(preferredEndpoint)) {
    candidates.splice(candidates.indexOf(preferredEndpoint), 1);
    candidates.unshift(preferredEndpoint);
  }

  let lastError = null;
  for (const endpoint of candidates) {
    try {
      const isLocalEndpoint = localCandidates.includes(endpoint);
      const result = await requestFromEndpoint(endpoint, path, {
        ...requestOptions,
        // Điện thoại ngoài LAN không cần đợi 4,5 giây cho địa chỉ nội bộ
        // trước khi chuyển sang Supabase; máy trong LAN vẫn giữ timeout đầy đủ.
        scaleTimeoutMs: isLocalEndpoint && preferCloudApi() ? 1000 : 4500,
      });
      preferredEndpoint = endpoint;
      if (!isLocalEndpoint && result && typeof result === "object" && !Array.isArray(result)) {
        return { ...result, __source: "online" };
      }
      return result;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Không tìm thấy máy chủ cân");
}

function getStoredBridgeToken() {
  try {
    const value = JSON.parse(sessionStorage.getItem(BRIDGE_TOKEN_KEY) || "null");
    if (value?.token && Number(value.expiresAt || 0) > Date.now() / 1000 + 60) return value.token;
  } catch {
    // Ignore an invalid old token.
  }
  return "";
}

async function bridgeFetch(action, body, token = "") {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  try {
    const headers = {
      "Content-Type": "application/json",
      apikey: supabase.supabaseKey || "",
    };
    if (token) headers.Authorization = "Bearer " + token;
    const response = await fetch(BRIDGE_FUNCTION_URL, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({ action, ...body }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Cầu nối cân trả về lỗi " + response.status);
    return result;
  } catch (error) {
    if (error?.name === "AbortError" || error instanceof TypeError) {
      error.scaleErrorCode = "CONNECTION_FAILURE";
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function getBridgeToken() {
  const stored = getStoredBridgeToken();
  if (stored) return stored;
  const sessionToken = getSessionToken();
  if (sessionToken) {
    const result = await bridgeFetch("authorize", { sessionToken });
    if (!result.token) throw new Error("Không cấp được phiên điều khiển cân từ xa");
    try {
      sessionStorage.setItem(BRIDGE_TOKEN_KEY, JSON.stringify({ token: result.token, expiresAt: result.expiresAt }));
    } catch {
      // Session storage có thể bị chặn trong chế độ riêng tư; vẫn dùng token trong phiên này.
    }
    return result.token;
  }
  const user = getCurrentUser();
  if (!user?.username || !user?.password) {
    throw new Error("Cần đăng nhập tài khoản có quyền cân để điều khiển từ xa");
  }
  const result = await bridgeFetch("authorize", { username: user.username, password: user.password });
  if (!result.token) throw new Error("Không cấp được phiên điều khiển cân từ xa");
  try {
    sessionStorage.setItem(BRIDGE_TOKEN_KEY, JSON.stringify({ token: result.token, expiresAt: result.expiresAt }));
  } catch {
    // Session storage có thể bị chặn trong chế độ riêng tư; vẫn dùng token trong phiên này.
  }
  return result.token;
}

async function sendBridgeCommand(commandType, payload) {
  let token = await getBridgeToken();
  let queued;
  try {
    queued = await bridgeFetch("enqueue", { machineId: SCALE_MACHINE_ID, commandType, payload }, token);
  } catch (error) {
    if (!String(error.message || "").includes("hết hạn") && !String(error.message || "").includes("không hợp lệ")) throw error;
    try { sessionStorage.removeItem(BRIDGE_TOKEN_KEY); } catch { /* Ignore storage errors. */ }
    token = await getBridgeToken();
    queued = await bridgeFetch("enqueue", { machineId: SCALE_MACHINE_ID, commandType, payload }, token);
  }
  const commandId = queued?.command?.id;
  if (!commandId) throw new Error("Không nhận được mã lệnh cân");

  try {
    for (let attempt = 0; attempt < 36; attempt += 1) {
      const status = await bridgeFetch("status", { commandId }, token);
      const command = status?.command;
      if (command?.status === "completed") return command.result || {};
      if (command?.status === "expired") {
        const expiredError = new Error(command.error_message || "Lệnh đã hết hạn");
        expiredError.scaleErrorCode = "CONNECTION_FAILURE";
        throw expiredError;
      }
      if (command?.status === "failed") {
        throw new Error(command.error_message || "Máy đầu cân không thực hiện lệnh");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    const timeoutError = new Error("Máy đầu cân chưa hoàn tất lệnh trong thời gian chờ");
    timeoutError.scaleErrorCode = "CONNECTION_FAILURE";
    throw timeoutError;
  } catch (error) {
    error.commandAccepted = true;
    throw error;
  }
}

// One-shot phone snapshot. This intentionally does not read scale_machine_states
// and does not start a live scale subscription: the scale-server waits for a
// serial frame newer than this request and completes this row exactly once.
export async function requestScaleSnapshot({ machineId = SCALE_MACHINE_ID, timeoutMs = 5_000 } = {}) {
  const requestId = createScaleUuid();
  const requestedAt = new Date().toISOString();
  const channelName = `scale-snapshot-request:${requestId}`;
  let channel;
  let timeout;
  let settled = false;
  let resolveUpdate;
  let rejectUpdate;
  const updatePromise = new Promise((resolve, reject) => {
    resolveUpdate = resolve;
    rejectUpdate = reject;
  });
  const cleanup = async () => {
    if (timeout) window.clearTimeout(timeout);
    if (channel) await supabase.removeChannel(channel);
  };

  try {
    channel = supabase
      .channel(channelName)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "scale_snapshot_requests",
        filter: `id=eq.${requestId}`,
      }, ({ new: row }) => {
        if (!row || settled) return;
        if (["completed", "failed", "timeout"].includes(row.status)) {
          settled = true;
          resolveUpdate(row);
        }
      });
    await new Promise((resolve, reject) => {
      let done = false;
      const subscriptionTimeout = window.setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error("Không kết nối được realtime máy cân"));
      }, 2_000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED" && !done) {
          done = true;
          window.clearTimeout(subscriptionTimeout);
          resolve();
        } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status) && !done) {
          done = true;
          window.clearTimeout(subscriptionTimeout);
          reject(new Error("Không kết nối được realtime máy cân"));
        }
      });
    });
    timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      rejectUpdate(new Error("Máy cân không trả snapshot trong 5 giây"));
    }, timeoutMs);
    const { error: insertError } = await supabase.from("scale_snapshot_requests").insert({
      id: requestId,
    machine_id: String(machineId),
    status: "pending",
    requested_at: requestedAt,
    expires_at: new Date(Date.now() + timeoutMs).toISOString(),
  });
    if (insertError) throw insertError;
    const row = await updatePromise;
    if (row.status !== "completed") throw new Error(row.error_message || "Không lấy được số cân mới");
    const requestedAtMs = new Date(requestedAt).getTime();
    const frameAtMs = new Date(row.frame_at || 0).getTime();
    const weight = Math.round(Number(row.weight) || 0);
    if (!weight || !Number.isFinite(frameAtMs) || frameAtMs <= requestedAtMs || Number(row.frame_sequence) <= 0) {
      throw new Error("Snapshot không chứng minh được là frame cân mới");
    }
    return { weight, frameAt: row.frame_at, frameSequence: Number(row.frame_sequence), requestId };
  } catch (error) {
    if (!settled) {
      settled = true;
      // Client không được phép sửa status/result. expires_at và recovery của
      // scale-server sẽ đánh dấu request timeout khi cần.
    }
    throw error;
  } finally {
    await cleanup();
  }
}

const remoteToLocal = (row) => {
  const cancelled = Boolean(row.cancelled);
  const charge = cancelled ? 0 : Number(row.charge) || 0;
  const paid = cancelled ? 0 : Number(row.paid) || 0;
  return {
  id: row.local_id ?? row.source_id,
  sourceId: row.source_id || "",
  seriesId: unpackSeriesId(row.series_id).seriesId,
  plate: row.plate || "",
  plateNote: row.plate_note || "",
  customer: row.customer || "",
  direction: row.direction || "",
  goods: row.goods || "",
  operatorName: unpackSeriesId(row.series_id).operatorName,
  weigher: String(charge),
  driver: String(paid),
  gross: Number(row.gross) || 0,
  tare: Number(row.tare) || 0,
  net: Number(row.net) || 0,
  grossAt: row.gross_at || "",
  tareAt: row.tare_at || "",
  charge,
  paid,
  noCharge: Boolean(row.no_charge) || cancelled,
  cancelled,
  cancelledAt: row.cancelled_at || "",
  createdAt: row.source_created_at || row.created_at || "",
  updatedAt: row.source_updated_at || row.updated_at || "",
  };
};

const toRemote = (weighing) => {
  const fallbackSourceId = weighing.sourceId
    || (typeof weighing.id === "string" && weighing.id.includes(":")
      ? weighing.id
      : (weighing.id ? `scale-head-192-168-1-12:${weighing.id}` : `browser:${createScaleUuid()}`));
  const cancelled = Boolean(weighing.cancelled);
  const charge = cancelled ? 0 : Math.round(Number(weighing.charge ?? weighing.weigher) || 0);
  const paid = cancelled ? 0 : Math.max(0, Math.round(Number(weighing.paid ?? weighing.driver) || 0));
  const weights = normalizeWeightPair(weighing);
  return {
    source_id: fallbackSourceId,
    machine_id: fallbackSourceId.split(":")[0] || "browser",
    local_id: Number.isFinite(Number(weighing.id)) ? Number(weighing.id) : null,
    series_id: `${String(weighing.seriesId || "")}::op:${encodeURIComponent(String(weighing.operatorName || ""))}`,
    plate: String(weighing.plate || ""),
    plate_note: String(weighing.plateNote || ""),
    customer: String(weighing.customer || ""),
    direction: String(weighing.direction || ""),
    goods: String(weighing.goods || ""),
    gross: weights.gross,
    tare: weights.tare,
    net: weights.net,
    gross_at: weights.grossAt,
    tare_at: weights.tareAt,
    charge,
    paid,
    no_charge: Boolean(weighing.noCharge) || cancelled,
    cancelled,
    cancelled_at: cancelled ? (weighing.cancelledAt || new Date().toISOString()) : null,
    source_created_at: weighing.createdAt || new Date().toISOString(),
    source_updated_at: weighing.updatedAt || new Date().toISOString(),
  };
};

const readCloudScaleState = async () => {
  const { data, error } = await supabase
    .from("scale_machine_states")
    .select("state, updated_at")
    .eq("machine_id", SCALE_MACHINE_ID)
    .maybeSingle();
  if (error || !data?.state) throw error || new Error("Chưa có trạng thái đầu cân trên Supabase");
  return {
    ...data.state,
    serverTime: data.updated_at || data.state.serverTime,
    receivedAt: new Date().toISOString(),
  };
};

export const getScaleState = async ({ allowOnline = true, allowCloud = true } = {}) => {
  try {
    const state = await scaleRequest("/api/scale/state", { allowOnline });
    return { ...state, __source: state?.__source || "local" };
  } catch (localError) {
    if (!allowCloud) throw localError;
    try {
      return { ...(await readCloudScaleState()), __source: "cloud" };
    } catch {
      throw localError;
    }
  }
};
const readCloudWeighings = async () => {
  const { data, error } = await supabase
    .from("scale_weighings")
    .select("*")
    // Hủy/sửa tiền không được làm phiếu nhảy vị trí; thứ tự dựa trên lúc tạo.
    .order("source_created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data || []).map(remoteToLocal);
};

export const getCloudWeighings = async () => readCloudWeighings();

export const getWeighings = async () => {
  try {
    return await scaleRequest("/api/weighings");
  } catch (localError) {
    try {
      return await readCloudWeighings();
    } catch {
      throw localError;
    }
  }
};

export const getWeighingsForStatistics = async () => {
  try {
    // Khi đang ở cùng mạng nhà cân, thống kê cũng phải đọc bản đầy đủ từ
    // SQLite/LAN trước; chỉ dùng Supabase khi không truy cập được LAN.
    return await scaleRequest("/api/weighings?all=1");
  } catch {
    try {
    const allRows = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("scale_weighings")
        .select("*")
        .order("source_created_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      allRows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return allRows.map(remoteToLocal);
    } catch {
      return getWeighings();
    }
  }
};

export const getScaleSettings = async () => {
  const { data, error } = await supabase
    .from("scale_settings")
    .select("price_tiers,blacklist,updated_at")
    .eq("id", "main")
    .maybeSingle();
  if (error || !data) return null;
  return {
    priceTiers: Array.isArray(data.price_tiers) ? data.price_tiers : [],
    blacklist: Array.isArray(data.blacklist) ? data.blacklist : [],
    updatedAt: data.updated_at || "",
  };
};

export const saveScaleSettings = async ({ priceTiers, blacklist }) => {
  const currentUser = getCurrentUser() || {};
  const payload = {
    id: "main",
    price_tiers: Array.isArray(priceTiers) ? priceTiers : [],
    blacklist: Array.isArray(blacklist) ? blacklist : [],
    updated_by: currentUser.name || currentUser.username || "Không rõ",
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("scale_settings").upsert(payload, { onConflict: "id" });
  return !error;
};
export const updateScaleState = async (changes) => {
  try {
    return await scaleRequest("/api/scale/state", {
      method: "POST",
      body: JSON.stringify(changes),
    });
  } catch (localError) {
    try {
      const result = await sendBridgeCommand("set-state", changes);
      return result.state || result;
    } catch (bridgeError) {
      if (bridgeError?.commandAccepted) throw bridgeError;
      throw localError;
    }
  }
};

export const saveWeighing = async (weighing) => {
  // Trên web/điện thoại, phiếu cân phải được lưu ngay cả khi cầu nối lệnh
  // của máy đầu cân đang tạm mất kết nối. Cầu nối chỉ điều khiển đầu cân/in,
  // không được trở thành điều kiện để lịch sử cân tồn tại.
  try {
    return await scaleRequest("/api/weighings", {
      method: "POST",
      body: JSON.stringify(weighing),
    });
  } catch (localError) {
    if (!preferCloudApi()) throw localError;
    const payload = toRemote(weighing);
    const { data, error } = await supabase
      .from("scale_weighings")
      .upsert(payload, { onConflict: "source_id" })
      .select()
      .single();
    if (error) throw error;
    // Ghi cloud một lần, sau đó chờ máy đầu cân lưu bản sao cùng sourceId.
    // Máy đầu cân không được tạo mã mới hoặc đẩy bản sao thứ hai lên cloud.
    const bridgeRecord = { ...weighing, id: null, sourceId: payload.source_id };
    delete bridgeRecord.captureKind;
    const record = remoteToLocal(data || payload);
    try {
      await sendBridgeCommand("save-weighing", { record: bridgeRecord });
    } catch (bridgeError) {
      return { ...record, machineSyncError: bridgeError.message || "Máy đầu cân chưa xác nhận lưu dữ liệu" };
    }
    return record;
  }
};

export const updateWeighingCloudFirst = async (weighing) => {
  const sourceId = String(weighing.sourceId || "").trim();
  if (!sourceId) throw new Error("Không xác định được mã cân để cập nhật; thao tác đã dừng để tránh tạo mã mới");
  try {
    return await scaleRequest("/api/weighings", {
      method: "POST",
      body: JSON.stringify({ ...weighing, sourceId }),
    });
  } catch (localError) {
    if (!preferCloudApi()) throw localError;
  const payload = toRemote({ ...weighing, sourceId });
  const { data, error } = await supabase
    .from("scale_weighings")
    .upsert(payload, { onConflict: "source_id" })
    .select()
    .single();
  if (error) throw error;

  const bridgeRecord = { ...weighing, id: null, sourceId: payload.source_id };
  delete bridgeRecord.captureKind;
  const record = remoteToLocal(data || payload);
  try {
    await sendBridgeCommand("save-weighing", { record: bridgeRecord });
  } catch (bridgeError) {
    return { ...record, machineSyncError: bridgeError.message || "Máy đầu cân chưa xác nhận cập nhật" };
  }
  return record;
  }
};

export const requestScalePrint = async (payload) => {
  try {
    return await scaleRequest("/api/print-ticket", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (localError) {
    try {
      return await sendBridgeCommand("set-state", { printJob: payload });
    } catch (bridgeError) {
      if (bridgeError?.commandAccepted) throw bridgeError;
      throw localError;
    }
  }
};

export const requestRemoteScalePrint = async (payload) => (
  sendBridgeCommand("set-state", { printJob: payload })
);

export const requestScaleLock = async (locked) => {
  try {
    return await sendBridgeCommand("set-state", { locked: Boolean(locked) });
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("SCALE_ZERO_WEIGHT")) {
      throw new Error("Xe chưa lên bàn cân");
    }
    if (message.includes("SCALE_HEAD_UNAVAILABLE") || error?.scaleErrorCode === "CONNECTION_FAILURE") {
      throw new Error("Mất mạng");
    }
    throw error;
  }
};

export const configureLocalScaleBridge = async () => {
  if (typeof window === "undefined" || window.location.port !== "8787") throw new Error("Chỉ cấu hình trực tiếp trên máy đầu cân");
  const userToken = await getBridgeToken();
  const provisioned = await bridgeFetch("machine-token", {}, userToken);
  if (!provisioned?.machineToken) throw new Error("Supabase chưa cấp được khóa cho máy đầu cân");
  return requestFromEndpoint(window.location.origin, "/api/bridge/configure", {
    method: "POST",
    body: JSON.stringify({ machineToken: provisioned.machineToken }),
  });
};

export function subscribeToScale(onState, onConnectionChange, options = {}) {
  const cloudEnabled = options.cloudEnabled !== false;
  const onRemotePrint = typeof options.onRemotePrint === "function" ? options.onRemotePrint : null;
  let stopped = false;
  let source = null;
  let retryTimer = null;
  let candidateIndex = 0;
  let sseConnected = false;
  let cloudConnected = false;
  let cloudSnapshotConnected = false;
  let cloudChannel = null;
  let sseConnectionSource = "lan";
  const onlineSessionId = cloudEnabled ? createScaleUuid() : "";
  let onlineSessionTimer = null;
  let latestSequence = 0;
  let latestUpdatedAt = 0;
  let latestServerTime = 0;
  let latestState = null;
  let lastStateAt = 0;
  const deliverState = (state, endpoint, source) => {
    const receivedState = { ...state, receivedAt: new Date().toISOString() };
    if (state?.printJob?.id) {
      onState(receivedState, endpoint, source);
      return;
    }
    const sequence = Number(state?.sequence || 0);
    const updatedAt = new Date(state?.updatedAt || 0).getTime() || 0;
    const serverTime = new Date(state?.serverTime || 0).getTime() || 0;
    if (
      sequence > 0
      && sequence <= latestSequence
      && updatedAt <= latestUpdatedAt
      && serverTime <= latestServerTime
    ) return;
    if (sequence > 0) latestSequence = sequence;
    if (updatedAt > 0) latestUpdatedAt = updatedAt;
    if (serverTime > 0) latestServerTime = serverTime;
    latestState = receivedState;
    lastStateAt = Date.now();
    onState(receivedState, endpoint, source);
  };
  const notifyConnection = () => {
    if (sseConnected) {
      const transport = sseConnectionSource === "lan" ? "server" : "online";
      onConnectionChange?.(true, transport, sseConnectionSource);
    }
    else if (cloudConnected || cloudSnapshotConnected) onConnectionChange?.(true, "supabase", "cloud");
    else onConnectionChange?.(false, "", "offline");
  };

  // Luôn ưu tiên SSE từ đầu cân/LAN. Chỉ khi các địa chỉ LAN lỗi mới thử
  // endpoint online; trạng thái Supabase vẫn là đường dự phòng khi đi xa.
  const localCandidates = endpointCandidates({ includeOnline: false });
  const candidates = [
    ...localCandidates,
    ...endpointCandidates({ includeOnline: cloudEnabled }).filter((endpoint) => !localCandidates.includes(endpoint)),
  ];
  if (preferredEndpoint && localCandidates.includes(preferredEndpoint)) {
    candidates.splice(candidates.indexOf(preferredEndpoint), 1);
    candidates.unshift(preferredEndpoint);
  }

  const connect = () => {
    if (stopped || !candidates.length) return;
    const endpoint = candidates[candidateIndex % candidates.length];
    candidateIndex += 1;
    const printWorker = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("printWorker") === "1";
    source = new EventSource(scaleUrl(endpoint, `/api/scale/events${printWorker ? "?client=print-worker" : ""}`));

    source.onopen = () => {
      preferredEndpoint = endpoint;
      sseConnected = true;
      sseConnectionSource = localCandidates.includes(endpoint) ? "lan" : "online";
      notifyConnection();
    };
    source.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message?.type === "remote-print" && message.printJob?.id) {
          onRemotePrint?.(message.printJob, endpoint);
          return;
        }
        deliverState(message, endpoint, "server");
      } catch {
        // Ignore malformed readings and keep the live connection open.
      }
    };
    source.onerror = () => {
      sseConnected = false;
      sseConnectionSource = "lan";
      notifyConnection();
      source?.close();
      source = null;
      if (!stopped) retryTimer = window.setTimeout(connect, 1200);
    };
  };

  const sendOnlineSession = (action) => {
    if (!cloudChannel || !onlineSessionId) return;
    void cloudChannel.send({
      type: "broadcast",
      event: "online-session",
      payload: { machineId: SCALE_MACHINE_ID, sessionId: onlineSessionId, action },
    });
  };

  const readCloudSnapshot = async () => {
    if (stopped) return;
    try {
      const state = await readCloudScaleState();
      const snapshotTime = new Date(state.serverTime || 0).getTime();
      cloudSnapshotConnected = Number.isFinite(snapshotTime) && snapshotTime > 0 && Date.now() - snapshotTime <= 10_000;
      notifyConnection();
      deliverState(
        state,
        "supabase",
        "cloud-snapshot",
      );
    } catch {
      // Realtime và LAN vẫn tiếp tục nếu bản chụp đám mây tạm lỗi.
    }
  };

  if (cloudEnabled) {
    cloudChannel = supabase.channel("scale-machine:" + SCALE_MACHINE_ID);
    cloudChannel
      .on("broadcast", { event: "scale-state" }, ({ payload }) => {
        if (!payload || (payload.machineId && payload.machineId !== SCALE_MACHINE_ID)) return;
        deliverState(payload, "supabase", "cloud");
      })
      .subscribe((status) => {
        cloudConnected = status === "SUBSCRIBED";
        notifyConnection();
        if (cloudConnected) {
          sendOnlineSession("connect");
          void readCloudSnapshot();
          void cloudChannel.send({
            type: "broadcast",
            event: "request-state",
            payload: { machineId: SCALE_MACHINE_ID, sessionId: onlineSessionId, requestedAt: new Date().toISOString() },
          });
          if (onlineSessionTimer) window.clearInterval(onlineSessionTimer);
          onlineSessionTimer = window.setInterval(() => sendOnlineSession("heartbeat"), 30_000);
        }
      });
  }

  connect();
  if (cloudEnabled) void readCloudSnapshot();
  const cloudRefreshTimer = cloudEnabled
    ? window.setInterval(() => {
      if (stopped) return;
      // Broadcast là luồng live chính; snapshot chỉ là đường dự phòng nên
      // không cần đọc database liên tục.
      void readCloudSnapshot();
    }, 10_000)
    : null;
  const staleTimer = window.setInterval(() => {
    if (stopped || (!sseConnected && !cloudConnected && !cloudSnapshotConnected) || !latestState || !lastStateAt) return;
    if (Date.now() - lastStateAt <= 4_000) return;
    if (!latestState.headConnected && !Number(latestState.weight) && !latestState.locked) return;
    latestState = {
      ...latestState,
      weight: 0,
      lockedWeight: 0,
      locked: false,
      headConnected: false,
      serialMessage: "Mất tín hiệu đầu cân",
    };
    onState(latestState, "", "stale");
  }, 1_000);

  return () => {
    stopped = true;
    sseConnected = false;
    cloudConnected = false;
    cloudSnapshotConnected = false;
    if (retryTimer) window.clearTimeout(retryTimer);
    if (cloudRefreshTimer) window.clearInterval(cloudRefreshTimer);
    if (onlineSessionTimer) window.clearInterval(onlineSessionTimer);
    sendOnlineSession("disconnect");
    window.clearInterval(staleTimer);
    source?.close();
    source = null;
    if (cloudChannel) void supabase.removeChannel(cloudChannel);
  };
}
