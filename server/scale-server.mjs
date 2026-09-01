import http from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { startD2008faSerial } from "./d2008fa-serial.mjs";

const serverDir = fileURLToPath(new URL(".", import.meta.url));
const projectDir = resolve(serverDir, "..");
const distDir = join(projectDir, "dist");
const defaultDataDir = process.platform === "win32" && existsSync("D:\\")
  ? "D:\\Cân Sơn Phú 2026"
  : join(projectDir, ".scale-data");
const dataDir = resolve(process.env.SCALE_DATA_DIR || defaultDataDir);
const host = process.env.SCALE_HOST || "0.0.0.0";
const port = Number(process.env.SCALE_PORT || 8787);
const supabaseUrl = String(process.env.SCALE_SUPABASE_URL || "https://xjcfauhswufiizkuggqx.supabase.co").trim().replace(/\/$/, "");
const supabaseAnonKey = String(process.env.SCALE_SUPABASE_ANON_KEY || "sb_publishable_y5VTtVkL45InUQ29hOQfzQ_BYk_NZaE").trim();
const syncMachineId = String(process.env.SCALE_MACHINE_ID || "scale-head-192-168-1-12").trim();
const syncEnabled = process.env.SCALE_SYNC_ENABLED !== "false" && Boolean(supabaseUrl && supabaseAnonKey);

mkdirSync(dataDir, { recursive: true });

const database = new DatabaseSync(join(dataDir, "Cân Sơn Phú 2026.sqlite"));
database.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS weighings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plate TEXT NOT NULL DEFAULT '',
    customer TEXT NOT NULL DEFAULT '',
    direction TEXT NOT NULL DEFAULT '',
    goods TEXT NOT NULL DEFAULT '',
    weigher TEXT NOT NULL DEFAULT '',
    driver TEXT NOT NULL DEFAULT '',
    gross INTEGER NOT NULL DEFAULT 0,
    tare INTEGER NOT NULL DEFAULT 0,
    net INTEGER NOT NULL DEFAULT 0,
    gross_at TEXT NOT NULL DEFAULT '',
    tare_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const existingColumns = new Set(database.prepare("PRAGMA table_info(weighings)").all().map((column) => column.name));
const ensureColumn = (name, definition) => {
  if (!existingColumns.has(name)) database.exec(`ALTER TABLE weighings ADD COLUMN ${name} ${definition}`);
};
ensureColumn("plate_note", "TEXT NOT NULL DEFAULT ''");
ensureColumn("charge", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("paid", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("no_charge", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("cancelled", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("cancelled_at", "TEXT NOT NULL DEFAULT ''");
ensureColumn("series_id", "TEXT NOT NULL DEFAULT ''");

database.exec(`
  CREATE TABLE IF NOT EXISTS scale_sync_queue (
    source_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    queued_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_scale_sync_queue_next_attempt
    ON scale_sync_queue (next_attempt_at);
`);

const listWeighings = database.prepare(`
  SELECT id, plate, plate_note AS plateNote, customer, direction, goods, weigher, driver,
         charge, paid, no_charge AS noCharge, cancelled, cancelled_at AS cancelledAt,
         series_id AS seriesId,
         gross, tare, net, gross_at AS grossAt, tare_at AS tareAt,
         created_at AS createdAt, updated_at AS updatedAt
  FROM weighings
  ORDER BY id DESC
  LIMIT 1000
`);
const listAllWeighings = database.prepare(`
  SELECT id, plate, plate_note AS plateNote, customer, direction, goods, weigher, driver,
         charge, paid, no_charge AS noCharge, cancelled, cancelled_at AS cancelledAt,
         series_id AS seriesId,
         gross, tare, net, gross_at AS grossAt, tare_at AS tareAt,
         created_at AS createdAt, updated_at AS updatedAt
  FROM weighings
  ORDER BY id DESC
`);
const getWeighing = database.prepare(`
  SELECT id, plate, plate_note AS plateNote, customer, direction, goods, weigher, driver,
         charge, paid, no_charge AS noCharge, cancelled, cancelled_at AS cancelledAt,
         series_id AS seriesId,
         gross, tare, net, gross_at AS grossAt, tare_at AS tareAt,
         created_at AS createdAt, updated_at AS updatedAt
  FROM weighings WHERE id = ?
`);
const withSourceId = (row) => ({
  ...row,
  sourceId: `${syncMachineId}:${row.id}`,
});
const listWeighingRows = () => listWeighings.all().map(withSourceId);

const queueSyncRecord = database.prepare(`
  INSERT INTO scale_sync_queue (source_id, payload, attempts, next_attempt_at, queued_at)
  VALUES (?, ?, 0, ?, ?)
  ON CONFLICT(source_id) DO UPDATE SET
    payload = excluded.payload,
    attempts = 0,
    next_attempt_at = excluded.next_attempt_at,
    queued_at = excluded.queued_at
`);
const listPendingSync = database.prepare(`
  SELECT source_id AS sourceId, payload, attempts
  FROM scale_sync_queue
  WHERE next_attempt_at <= ?
  ORDER BY queued_at ASC
  LIMIT 25
`);
const deleteSyncedRecord = database.prepare("DELETE FROM scale_sync_queue WHERE source_id = ?");
const retrySyncRecord = database.prepare("UPDATE scale_sync_queue SET attempts = ?, next_attempt_at = ? WHERE source_id = ?");
const countPendingSync = database.prepare("SELECT COUNT(*) AS count FROM scale_sync_queue");

const validTimestamp = (value, fallback = new Date().toISOString()) => {
  const text = String(value || "").trim();
  return text && !Number.isNaN(new Date(text).getTime()) ? text : fallback;
};
const nullableTimestamp = (value) => {
  const text = String(value || "").trim();
  return text && !Number.isNaN(new Date(text).getTime()) ? text : null;
};
const toRemoteWeighing = (row) => ({
  source_id: row.sourceId || `${syncMachineId}:${row.id}`,
  machine_id: syncMachineId,
  local_id: Number(row.id) || null,
  series_id: String(row.seriesId || ""),
  plate: String(row.plate || ""),
  plate_note: String(row.plateNote || ""),
  customer: String(row.customer || ""),
  direction: String(row.direction || ""),
  goods: String(row.goods || ""),
  gross: Number(row.gross) || 0,
  tare: Number(row.tare) || 0,
  net: Number(row.net) || 0,
  gross_at: nullableTimestamp(row.grossAt),
  tare_at: nullableTimestamp(row.tareAt),
  charge: Number(row.charge ?? row.weigher) || 0,
  paid: Number(row.paid ?? row.driver) || 0,
  no_charge: Boolean(row.noCharge),
  cancelled: Boolean(row.cancelled),
  cancelled_at: nullableTimestamp(row.cancelledAt),
  source_created_at: validTimestamp(row.createdAt),
  source_updated_at: validTimestamp(row.updatedAt),
});

let syncInProgress = false;
const enqueueSync = (row) => {
  if (!syncEnabled || !row?.id) return;
  const now = new Date().toISOString();
  const sourceId = row.sourceId || `${syncMachineId}:${row.id}`;
  queueSyncRecord.run(sourceId, JSON.stringify(toRemoteWeighing({ ...row, sourceId })), now, now);
  void flushSyncQueue();
};

async function pushSyncPayload(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/scale_weighings?on_conflict=source_id`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Supabase trả về HTTP ${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function flushSyncQueue() {
  if (!syncEnabled || syncInProgress) return;
  syncInProgress = true;
  try {
    const pending = listPendingSync.all(new Date().toISOString());
    for (const item of pending) {
      try {
        await pushSyncPayload(JSON.parse(item.payload));
        deleteSyncedRecord.run(item.sourceId);
      } catch {
        const attempts = Number(item.attempts || 0) + 1;
        const delayMs = Math.min(15 * 60 * 1000, 5000 * (2 ** Math.min(attempts, 7)));
        retrySyncRecord.run(attempts, new Date(Date.now() + delayMs).toISOString(), item.sourceId);
      }
    }
  } finally {
    syncInProgress = false;
  }
}

const insertWeighing = database.prepare(`
  INSERT INTO weighings (
    plate, plate_note, customer, direction, goods, weigher, driver,
    charge, paid, no_charge, cancelled, cancelled_at, series_id,
    gross, tare, net, gross_at, tare_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateWeighing = database.prepare(`
  UPDATE weighings SET
    plate = ?, plate_note = ?, customer = ?, direction = ?, goods = ?, weigher = ?, driver = ?,
    charge = ?, paid = ?, no_charge = ?, cancelled = ?, cancelled_at = ?, series_id = ?,
    gross = ?, tare = ?, net = ?, gross_at = ?, tare_at = ?, updated_at = ?
  WHERE id = ?
`);

let scaleState = {
  weight: 0,
  lockedWeight: 0,
  open: true,
  locked: false,
  headConnected: false,
  source: "waiting-for-scale-head",
  serialMessage: "Đang khởi động kết nối đầu cân",
  serialSignal: false,
  serialBytes: 0,
  serialRawHex: "",
  updatedAt: new Date().toISOString(),
};
const eventClients = new Set();

function publicState() {
  return { ...scaleState, serverTime: new Date().toISOString() };
}

function broadcastState() {
  const message = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const response of eventClients) response.write(message);
}

function applyState(changes) {
  const next = { ...scaleState };
  if (typeof changes.open === "boolean") next.open = changes.open;
  if (Number.isFinite(Number(changes.weight))) next.weight = Math.max(0, Math.round(Number(changes.weight)));
  if (typeof changes.locked === "boolean") {
    next.locked = changes.locked && next.weight > 0;
    if (next.locked) next.lockedWeight = next.weight;
  }
  if (!next.open) next.locked = false;
  next.updatedAt = new Date().toISOString();
  scaleState = next;
  broadcastState();
  return publicState();
}

const stopSerial = startD2008faSerial({
  onWeight(weight, details) {
    scaleState = {
      ...scaleState,
      weight: Math.max(0, Math.round(Number(weight) || 0)),
      headConnected: true,
      source: `d2008fa-${String(details.path).toLowerCase()}`,
      serialMessage: `Đã kết nối ${details.path} • ${details.baudRate} • 8N${details.stopBits} • ${details.protocol}`,
      updatedAt: new Date().toISOString(),
    };
    broadcastState();
  },
  onStatus(status) {
    scaleState = {
      ...scaleState,
      headConnected: Boolean(status.connected),
      serialSignal: Boolean(status.signalDetected || status.connected),
      serialBytes: Number(status.rawByteCount || scaleState.serialBytes || 0),
      serialRawHex: status.rawHex || scaleState.serialRawHex || "",
      serialMessage: status.message,
      updatedAt: new Date().toISOString(),
    };
    broadcastState();
  },
});

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Dữ liệu gửi lên quá lớn");
  }
  return body ? JSON.parse(body) : {};
}

function toInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function saveRecord(input) {
  const now = new Date().toISOString();
  const gross = toInteger(input.gross);
  const tare = toInteger(input.tare);
  const net = Number.isFinite(Number(input.net)) ? toInteger(input.net) : gross - tare;
  const charge = Math.max(0, toInteger(input.charge ?? input.weigher));
  const paid = Math.max(0, toInteger(input.paid ?? input.driver));
  const values = [
    String(input.plate || ""), String(input.plateNote || ""), String(input.customer || ""), String(input.direction || ""),
    String(input.goods || ""), String(charge), String(paid),
    charge, paid, input.noCharge ? 1 : 0, input.cancelled ? 1 : 0,
    String(input.cancelledAt || ""), String(input.seriesId || ""),
    gross, tare, net, String(input.grossAt || ""), String(input.tareAt || ""),
  ];
  const requestedId = toInteger(input.id);
  if (requestedId > 0) {
    const result = updateWeighing.run(...values, now, requestedId);
    if (result.changes > 0) {
      const saved = getWeighing.get(requestedId);
      enqueueSync(saved);
      return saved;
    }
  }
  const result = insertWeighing.run(...values, now, now);
  const saved = getWeighing.get(Number(result.lastInsertRowid));
  enqueueSync(saved);
  return saved;
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function serveApp(request, response) {
  if (!existsSync(distDir)) {
    return json(response, 503, { error: "Chưa có bản build. Hãy chạy npm run build trước." });
  }
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = resolve(distDir, requested);
  const safeFile = candidate.startsWith(distDir) && existsSync(candidate) ? candidate : join(distDir, "index.html");
  response.writeHead(200, { "Content-Type": mimeTypes[extname(safeFile)] || "application/octet-stream" });
  response.end(readFileSync(safeFile));
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    return response.end();
  }

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(response, 200, {
        ok: true,
        storage: "local-sqlite",
        sync: { enabled: syncEnabled, pending: Number(countPendingSync.get().count || 0), machineId: syncMachineId },
        dataDir,
        ...publicState(),
      });
    }
    if (request.method === "GET" && url.pathname === "/api/scale/state") {
      return json(response, 200, publicState());
    }
    if (request.method === "POST" && url.pathname === "/api/scale/state") {
      return json(response, 200, applyState(await readJson(request)));
    }
    if (request.method === "GET" && url.pathname === "/api/scale/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      response.write(`data: ${JSON.stringify(publicState())}\n\n`);
      eventClients.add(response);
      request.on("close", () => eventClients.delete(response));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/weighings") {
      return json(response, 200, listWeighingRows());
    }
    if (request.method === "POST" && url.pathname === "/api/weighings") {
      const record = saveRecord(await readJson(request));
      return json(response, 201, record);
    }
    if (url.pathname.startsWith("/api/")) return json(response, 404, { error: "Không tìm thấy chức năng" });
    return serveApp(request, response);
  } catch (error) {
    return json(response, 400, { error: error.message || "Yêu cầu không hợp lệ" });
  }
});

const heartbeat = setInterval(() => {
  for (const response of eventClients) response.write(": keep-alive\n\n");
}, 20_000);
const syncInterval = setInterval(() => void flushSyncQueue(), 15_000);

if (syncEnabled) {
  for (const row of listAllWeighings.all().map(withSourceId)) enqueueSync(row);
  setTimeout(() => void flushSyncQueue(), 0);
}

server.listen(port, host, () => {
  console.log(`Máy chủ cân đang chạy tại http://${host}:${port}`);
  console.log(`Dữ liệu cân lưu tại ${dataDir}`);
  console.log("Các máy cùng LAN mở: http://IP-MAY-DAU-CAN:8787/scale");
});

async function shutdown() {
  clearInterval(heartbeat);
  clearInterval(syncInterval);
  await stopSerial();
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
