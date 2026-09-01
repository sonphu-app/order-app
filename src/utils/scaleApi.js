import { supabase } from "../supabaseClient";

const configuredOnlineUrl = String(import.meta.env.VITE_SCALE_SERVER_URL || "").trim();
const configuredLanUrl = String(import.meta.env.VITE_SCALE_LAN_URL || "").trim();
const DEFAULT_LAN_URL = "http://192.168.1.12:8787";

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

const endpointCandidates = () => {
  const candidates = [configuredOnlineUrl, configuredLanUrl, DEFAULT_LAN_URL, sameOriginScaleUrl()];
  return [...new Set(candidates.map(trimUrl).filter(Boolean))];
};

let preferredEndpoint = trimUrl(configuredOnlineUrl) || null;

export const SCALE_SERVER_URL = preferredEndpoint || trimUrl(configuredLanUrl) || DEFAULT_LAN_URL;
export const SCALE_ONLINE_URL = trimUrl(configuredOnlineUrl);
export const SCALE_LAN_URL = trimUrl(configuredLanUrl) || DEFAULT_LAN_URL;

const scaleUrl = (base, path) => `${base}${path}`;

async function requestFromEndpoint(base, path, options = {}) {
  const controller = options.signal ? null : new AbortController();
  const timeout = controller ? window.setTimeout(() => controller.abort(), 4500) : null;
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
  const candidates = endpointCandidates();
  if (preferredEndpoint && candidates.includes(preferredEndpoint)) {
    candidates.splice(candidates.indexOf(preferredEndpoint), 1);
    candidates.unshift(preferredEndpoint);
  }

  let lastError = null;
  for (const endpoint of candidates) {
    try {
      const result = await requestFromEndpoint(endpoint, path, options);
      preferredEndpoint = endpoint;
      return result;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Không tìm thấy máy chủ cân");
}

const remoteToLocal = (row) => ({
  id: row.local_id ?? row.source_id,
  sourceId: row.source_id || "",
  seriesId: row.series_id || "",
  plate: row.plate || "",
  plateNote: row.plate_note || "",
  customer: row.customer || "",
  direction: row.direction || "",
  goods: row.goods || "",
  weigher: String(Number(row.charge) || 0),
  driver: String(Number(row.paid) || 0),
  gross: Number(row.gross) || 0,
  tare: Number(row.tare) || 0,
  net: Number(row.net) || 0,
  grossAt: row.gross_at || "",
  tareAt: row.tare_at || "",
  charge: Number(row.charge) || 0,
  paid: Number(row.paid) || 0,
  noCharge: Boolean(row.no_charge),
  cancelled: Boolean(row.cancelled),
  cancelledAt: row.cancelled_at || "",
  createdAt: row.source_created_at || row.created_at || "",
  updatedAt: row.source_updated_at || row.updated_at || "",
});

const toRemote = (weighing) => {
  const fallbackSourceId = weighing.sourceId
    || (weighing.id ? `scale-head-192-168-1-12:${weighing.id}` : `browser:${crypto.randomUUID()}`);
  const charge = Math.max(0, Math.round(Number(weighing.charge ?? weighing.weigher) || 0));
  const paid = Math.max(0, Math.round(Number(weighing.paid ?? weighing.driver) || 0));
  return {
    source_id: fallbackSourceId,
    machine_id: fallbackSourceId.split(":")[0] || "browser",
    local_id: Number.isFinite(Number(weighing.id)) ? Number(weighing.id) : null,
    series_id: String(weighing.seriesId || ""),
    plate: String(weighing.plate || ""),
    plate_note: String(weighing.plateNote || ""),
    customer: String(weighing.customer || ""),
    direction: String(weighing.direction || ""),
    goods: String(weighing.goods || ""),
    gross: Math.round(Number(weighing.gross) || 0),
    tare: Math.round(Number(weighing.tare) || 0),
    net: Math.round(Number(weighing.net) || 0),
    gross_at: weighing.grossAt || null,
    tare_at: weighing.tareAt || null,
    charge,
    paid,
    no_charge: Boolean(weighing.noCharge),
    cancelled: Boolean(weighing.cancelled),
    cancelled_at: weighing.cancelledAt || null,
    source_created_at: weighing.createdAt || new Date().toISOString(),
    source_updated_at: weighing.updatedAt || new Date().toISOString(),
  };
};

export const getScaleState = () => scaleRequest("/api/scale/state");
export const getWeighings = async () => {
  try {
    return await scaleRequest("/api/weighings");
  } catch (localError) {
    const { data, error } = await supabase
      .from("scale_weighings")
      .select("*")
      .order("source_updated_at", { ascending: false })
      .limit(1000);
    if (error) throw localError;
    return (data || []).map(remoteToLocal);
  }
};
export const updateScaleState = (changes) => scaleRequest("/api/scale/state", {
  method: "POST",
  body: JSON.stringify(changes),
});

export const saveWeighing = async (weighing) => {
  try {
    return await scaleRequest("/api/weighings", {
      method: "POST",
      body: JSON.stringify(weighing),
    });
  } catch (localError) {
    const payload = toRemote(weighing);
    const { data, error } = await supabase
      .from("scale_weighings")
      .upsert(payload, { onConflict: "source_id" })
      .select()
      .single();
    if (error) throw localError;
    return remoteToLocal(data || payload);
  }
};

export function subscribeToScale(onState, onConnectionChange) {
  let stopped = false;
  let source = null;
  let retryTimer = null;
  let candidateIndex = 0;

  const candidates = endpointCandidates();
  if (preferredEndpoint && candidates.includes(preferredEndpoint)) {
    candidates.splice(candidates.indexOf(preferredEndpoint), 1);
    candidates.unshift(preferredEndpoint);
  }

  const connect = () => {
    if (stopped || !candidates.length) return;
    const endpoint = candidates[candidateIndex % candidates.length];
    candidateIndex += 1;
    source = new EventSource(scaleUrl(endpoint, "/api/scale/events"));

    source.onopen = () => {
      preferredEndpoint = endpoint;
      onConnectionChange?.(true, endpoint);
    };
    source.onmessage = (event) => {
      try {
        onState(JSON.parse(event.data), endpoint);
      } catch {
        // Ignore malformed readings and keep the live connection open.
      }
    };
    source.onerror = () => {
      onConnectionChange?.(false, endpoint);
      source?.close();
      source = null;
      if (!stopped) retryTimer = window.setTimeout(connect, 1200);
    };
  };

  connect();

  return () => {
    stopped = true;
    if (retryTimer) window.clearTimeout(retryTimer);
    source?.close();
    source = null;
  };
}
