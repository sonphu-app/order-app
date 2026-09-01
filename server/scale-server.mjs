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

const listWeighings = database.prepare(`
  SELECT id, plate, customer, direction, goods, weigher, driver,
         gross, tare, net, gross_at AS grossAt, tare_at AS tareAt,
         created_at AS createdAt, updated_at AS updatedAt
  FROM weighings
  ORDER BY id DESC
  LIMIT 1000
`);

const insertWeighing = database.prepare(`
  INSERT INTO weighings (
    plate, customer, direction, goods, weigher, driver,
    gross, tare, net, gross_at, tare_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateWeighing = database.prepare(`
  UPDATE weighings SET
    plate = ?, customer = ?, direction = ?, goods = ?, weigher = ?, driver = ?,
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
  const values = [
    String(input.plate || ""), String(input.customer || ""), String(input.direction || ""),
    String(input.goods || ""), String(input.weigher || ""), String(input.driver || ""),
    gross, tare, net, String(input.grossAt || ""), String(input.tareAt || ""),
  ];
  const requestedId = toInteger(input.id);
  if (requestedId > 0) {
    const result = updateWeighing.run(...values, now, requestedId);
    if (result.changes > 0) return listWeighings.all().find((row) => row.id === requestedId);
  }
  const result = insertWeighing.run(...values, now, now);
  return listWeighings.all().find((row) => row.id === Number(result.lastInsertRowid));
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
      return json(response, 200, { ok: true, storage: "local-sqlite", dataDir, ...publicState() });
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
      return json(response, 200, listWeighings.all());
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

server.listen(port, host, () => {
  console.log(`Máy chủ cân đang chạy tại http://${host}:${port}`);
  console.log(`Dữ liệu cân lưu tại ${dataDir}`);
  console.log("Các máy cùng LAN mở: http://IP-MAY-DAU-CAN:8787/scale");
});

async function shutdown() {
  clearInterval(heartbeat);
  await stopSerial();
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
