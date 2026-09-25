import { useEffect, useMemo, useRef, useState } from "react";
import {
  getScaleState,
  getScaleSettings,
  getWeighings,
  getCloudWeighings,
  getWeighingsForStatistics,
  createScaleUuid,
  requestScaleLock,
  requestRemoteScalePrint,
  configureLocalScaleBridge,
  saveWeighing,
  saveScaleSettings,
  subscribeToScale,
  updateScaleState,
  updateWeighingCloudFirst,
} from "../utils/scaleApi";
import { getCurrentUser } from "../utils/auth";
import { notifyScaleWeighing } from "../utils/push";
import { supabase } from "../supabaseClient";
import { SCALE_VERSION } from "../utils/scaleVersion";
import "../styles/weighing.css";

const padWeight = (value) => String(Math.max(0, Math.round(Number(value) || 0))).padStart(6, " ");
const numberText = (value) => Number(value || 0).toLocaleString("vi-VN");
const EMPTY_ROW = { id: null, gross: 0, tare: 0, net: 0, plate: "", plateNote: "", customer: "", direction: "", goods: "", operatorName: "", grossAt: "", tareAt: "", charge: 0, paid: 0, cancelled: 0, seriesId: "" };
const DEFAULT_SCALE_FORM = {
  customer: "Vãng Lai",
  plate: "",
  plateNote: "",
  direction: "Cân Dịch Vụ",
  goods: "Hàng hóa",
  weigher: "",
  driver: "",
};
const DEFAULT_PRICE_TIERS = [{ name: "Mặc định", maxTons: "", price: "" }];
const HISTORY_COLUMNS = [
  { key: "cancel", label: "Hủy", width: 5, min: 4 },
  { key: "plate", label: "Biển số", width: 8, min: 6 },
  { key: "customer", label: "Khách hàng", width: 10, min: 7 },
  { key: "gross", label: "KL tổng", width: 6, min: 5 },
  { key: "tare", label: "KL bì", width: 6, min: 5 },
  { key: "net", label: "KL hàng", width: 6, min: 5 },
  { key: "grossAt", label: "Ngày tổng", width: 9, min: 7 },
  { key: "tareAt", label: "Ngày bì", width: 9, min: 7 },
  { key: "direction", label: "Xuất/Nhập", width: 8, min: 6 },
  { key: "goods", label: "Loại hàng", width: 8, min: 6 },
  { key: "charge", label: "Thành tiền", width: 10, min: 7 },
  { key: "paid", label: "Đã TT", width: 5, min: 4 },
  { key: "debt", label: "Còn nợ", width: 10, min: 7 },
];
const DEFAULT_HISTORY_COLUMN_WIDTHS = HISTORY_COLUMNS.map((column) => column.width);
const SCALE_STATE_FRESH_MS = 5_000;
const NO_CHARGE_DIRECTIONS = new Set(["Nhập Hàng", "Xuất Hàng"]);

function isPhoneLayout() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
}

function isPhoneRemoteDevice() {
  if (typeof window === "undefined" || isScaleMachineBrowser()) return false;
  const userAgent = String(window.navigator?.userAgent || "");
  const mobileUserAgent = /Android|iPhone|iPod|Windows Phone|Mobile/i.test(userAgent);
  const coarseTouch = Number(window.navigator?.maxTouchPoints || 0) > 0
    && window.matchMedia("(pointer: coarse)").matches;
  return isPhoneLayout() || mobileUserAgent || coarseTouch;
}

function escapeSpreadsheetCell(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function directionDefaultsToNoCharge(direction) {
  return NO_CHARGE_DIRECTIONS.has(String(direction || "").trim());
}

function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function fromDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function isScaleMachineBrowser() {
  return typeof window !== "undefined" && window.location.port === "8787";
}

function getScaleConnectionSource(state) {
  if (state?.__source === "cloud") return "supabase";
  if (state?.__source === "online") return "online";
  if (state?.__source === "offline") return "offline";
  return "lan";
}

function createTicketNumber(date = new Date()) {
  const dateCode = [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getFullYear()).slice(-2),
  ].join("");
  const randomSequence = window.crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return `${dateCode}-${String(randomSequence).padStart(6, "0")}`;
}

async function acknowledgeRemotePrint(printJob, ok, error = "") {
  const response = await fetch("/api/scale/print-ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commandId: printJob.commandId,
      printJobId: printJob.id,
      ok: Boolean(ok),
      error: String(error || "").slice(0, 500),
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Không xác nhận được lệnh in (${response.status})`);
  }
}

async function claimRemotePrint(printJob) {
  const response = await fetch("/api/scale/print-claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commandId: printJob.commandId, printJobId: printJob.id }),
  });
  if (response.status === 409) return false;
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Không claim được lệnh in (${response.status})`);
  }
  return Boolean((await response.json().catch(() => ({}))).claimed);
}

function scaleHeadReady(state) {
  if (!state?.headConnected) return false;
  const updatedAt = new Date(state.receivedAt || state.serverTime || state.updatedAt || 0).getTime();
  return !Number.isFinite(updatedAt) || updatedAt <= 0 || Date.now() - updatedAt <= SCALE_STATE_FRESH_MS;
}

function normalizePlate(value) {
  const compact = String(value || "").toLocaleUpperCase("vi-VN").replace(/[^0-9A-Z]/g, "");
  const match = compact.match(/^(\d{2}[A-Z]{1,2})(\d{4,5})$/);
  return match ? `${match[1]} ${match[2]}` : String(value || "").trim().replace(/\s+/g, " ").toLocaleUpperCase("vi-VN");
}

function rowDate(row) {
  const value = row.updatedAt || row.tareAt || row.grossAt || row.createdAt;
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function buildHistorySuggestions(rows, getValue, getKey) {
  const values = new Map();
  for (const row of rows) {
    const value = String(getValue(row) || "").trim();
    if (!value) continue;
    const key = getKey(value);
    const current = values.get(key);
    const latest = rowDate(row);
    if (current) {
      current.count += 1;
      if (latest > current.latest) current.latest = latest;
    } else {
      values.set(key, { value, count: 1, latest });
    }
  }
  return [...values.values()].sort((left, right) => right.latest - left.latest || left.value.localeCompare(right.value, "vi"));
}

function filterHistorySuggestions(items, query, plateMode) {
  const normalizedQuery = plateMode
    ? normalizePlate(query).replace(/\s/g, "").toLocaleLowerCase("vi-VN")
    : String(query || "").trim().toLocaleLowerCase("vi-VN");
  return items
    .filter((item) => {
      const normalizedValue = plateMode
        ? normalizePlate(item.value).replace(/\s/g, "").toLocaleLowerCase("vi-VN")
        : item.value.toLocaleLowerCase("vi-VN");
      return !normalizedQuery || normalizedValue.includes(normalizedQuery);
    })
    .slice(0, 8);
}

function normalizeWeightPair(row) {
  let gross = Math.max(0, Math.round(Number(row?.gross) || 0));
  let tare = Math.max(0, Math.round(Number(row?.tare) || 0));
  let grossAt = row?.grossAt || "";
  let tareAt = row?.tareAt || "";
  if (gross > 0 && tare > 0 && gross < tare) {
    [gross, tare] = [tare, gross];
    [grossAt, tareAt] = [tareAt, grossAt];
  }
  return { gross, tare, net: gross - tare, grossAt, tareAt };
}

function normalizeWeighing(row) {
  const cancelled = Boolean(row.cancelled);
  const charge = cancelled ? 0 : Math.round(Number(row.charge ?? row.weigher) || 0);
  const paid = cancelled ? 0 : Math.max(0, Number(row.paid ?? row.driver) || 0);
  const weights = normalizeWeightPair(row);
  return {
    ...row,
    ...weights,
    plateNote: row.plateNote || "",
    charge,
    paid,
    noCharge: Boolean(row.noCharge) || cancelled,
    cancelled,
    cancelledAt: row.cancelledAt || "",
    seriesId: row.seriesId || (row.id ? `scale-${row.id}` : ""),
  };
}

const rowIdentity = (row) => String(row?.sourceId || row?.id || "");
const sameRow = (left, right) => rowIdentity(left) === rowIdentity(right);
const dedupeWeighings = (items) => {
  const seen = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const normalized = normalizeWeighing(item);
    const key = rowIdentity(normalized);
    if (!key) continue;
    seen.set(key, normalized);
  }
  return [...seen.values()];
};

function findAutomaticPrice(priceTiers, _goodsName, netWeight) {
  const priced = priceTiers.filter((tier) => Number(tier.price) > 0);
  if (!priced.length) return 0;
  const tons = Math.abs(Number(netWeight) || 0) / 1000;
  const configuredPrice = Number(priced
    .map((tier) => ({ ...tier, limit: Number(tier.maxTons) > 0 ? Number(tier.maxTons) : Number.POSITIVE_INFINITY }))
    .filter((tier) => tons <= tier.limit)
    .sort((left, right) => left.limit - right.limit)[0]?.price || 0);
  return configuredPrice;
}

const SEGMENTS = {
  0: ["a", "b", "c", "d", "e", "f"],
  1: ["b", "c"],
  2: ["a", "b", "g", "e", "d"],
  3: ["a", "b", "c", "d", "g"],
  4: ["f", "g", "b", "c"],
  5: ["a", "f", "g", "c", "d"],
  6: ["a", "f", "g", "e", "c", "d"],
  7: ["a", "b", "c"],
  8: ["a", "b", "c", "d", "e", "f", "g"],
  9: ["a", "b", "c", "d", "f", "g"],
};

export default function Weighing() {
  const currentUser = getCurrentUser() || {};
  const currentOperatorName = currentUser.name || currentUser.username || "Không rõ";
  const [now, setNow] = useState(new Date());
  const [lanConnected, setLanConnected] = useState(false);
  const [_lanAvailable, setLanAvailable] = useState(false);
  const [connectionSource, setConnectionSource] = useState("offline");
  const [headConnected, setHeadConnected] = useState(false);
  const [serialMessage, setSerialMessage] = useState("Chờ máy chủ cân");
  const [rows, setRows] = useState([]);
  const [scaleOpen, setScaleOpen] = useState(true);
  const [weightLocked, setWeightLocked] = useState(false);
  const [liveWeight, setLiveWeight] = useState(0);
  const [lockedWeight, setLockedWeight] = useState(0);
  const [filter, setFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("last30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [captured, setCaptured] = useState({ gross: 0, tare: 0, grossAt: "", tareAt: "" });
  const [captureLocked, setCaptureLocked] = useState({ gross: false, tare: false });
  const [newWeighingPrimed, setNewWeighingPrimed] = useState(false);
  const [additionalWeighingActive, setAdditionalWeighingActive] = useState(false);
  const [chargeInput, setChargeInput] = useState("");
  const [noExtraCharge, setNoExtraCharge] = useState(false);
  const [totalCharge, setTotalCharge] = useState(0);
  const [chargeManuallyEdited, setChargeManuallyEdited] = useState(false);
  const [paidChecked, setPaidChecked] = useState(false);
  const [paidInput, setPaidInput] = useState("");
  const [moneyMessage, setMoneyMessage] = useState("");
  const [priceTableOpen, setPriceTableOpen] = useState(false);
  const [statisticsOpen, setStatisticsOpen] = useState(false);
  const [statisticsMode, setStatisticsMode] = useState("overall");
  const [statisticsQuery, setStatisticsQuery] = useState("");
  const [statisticsDateFilter, setStatisticsDateFilter] = useState("month");
  const [statisticsPaymentFilter, setStatisticsPaymentFilter] = useState("all");
  const [statisticsCustomFrom, setStatisticsCustomFrom] = useState("");
  const [statisticsCustomTo, setStatisticsCustomTo] = useState("");
  const [statisticsRows, setStatisticsRows] = useState(null);
  const [statisticsLoading, setStatisticsLoading] = useState(false);
  const [seriesId, setSeriesId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [blacklistDialog, setBlacklistDialog] = useState(null);
  const [blacklistListOpen, setBlacklistListOpen] = useState(false);
  const [paymentDialog, setPaymentDialog] = useState(null);
  const [blacklist, setBlacklist] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("scale-plate-blacklist") || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const [priceTiers, setPriceTiers] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("scale-price-tiers") || "null");
      if (!Array.isArray(saved) || !saved.length) return DEFAULT_PRICE_TIERS;
      const normalized = saved.map((tier) => {
        const savedPrice = Number(tier.price) || 0;
        return {
          name: tier.name || "Mặc định",
          maxTons: tier.maxTons ?? "",
          price: savedPrice > 0 && savedPrice < 1000 ? String(savedPrice * 1000) : (tier.price ?? ""),
        };
      });
      return normalized.every((tier) => !tier.price) ? DEFAULT_PRICE_TIERS : normalized;
    } catch {
      return DEFAULT_PRICE_TIERS;
    }
  });
  const [historyColumnWidths, setHistoryColumnWidths] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("scale-history-column-widths") || "null");
      const savedTotal = Array.isArray(saved) ? saved.reduce((total, width) => total + Number(width || 0), 0) : 0;
      return Array.isArray(saved) && saved.length === HISTORY_COLUMNS.length && saved.every((width) => Number(width) > 0) && Math.abs(savedTotal - 100) < 0.5
        ? saved.map(Number)
        : DEFAULT_HISTORY_COLUMN_WIDTHS;
    } catch {
      return DEFAULT_HISTORY_COLUMN_WIDTHS;
    }
  });
  const [saving, setSaving] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [printCopies, setPrintCopies] = useState(1);
  const [printTicketNumber, setPrintTicketNumber] = useState("");
  const [printPayload, setPrintPayload] = useState(null);
  const [directPrintPending, setDirectPrintPending] = useState(false);
  const [remotePrintJob, setRemotePrintJob] = useState(null);
  const [printStatus, setPrintStatus] = useState("");
  const [printing, setPrinting] = useState(false);
  const [printerInfo, setPrinterInfo] = useState(null);
  const [bridgeInfo, setBridgeInfo] = useState(null);
  const bridgeProvisionAttempted = useRef(false);
  const selectedIdRef = useRef(null);
  const manualSelectionRef = useRef(false);
  const [onlineSessionActive, setOnlineSessionActive] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [printAtMachineTarget, setPrintAtMachineTarget] = useState(false);
  const [mobileScreen, setMobileScreen] = useState(() => {
    try {
      const saved = sessionStorage.getItem("sonphu-scale-mobile-screen");
      return saved === "history" || saved === "weighing" ? saved : "weighing";
    } catch {
      return "weighing";
    }
  });
  const [historyQueryType, setHistoryQueryType] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [suggestionField, setSuggestionField] = useState("");
  const [suggestionQuery, setSuggestionQuery] = useState({ customer: "", plate: "" });
  const [editDialog, setEditDialog] = useState(null);
  const lastPrintRequestAt = useRef(0);
  const printFullscreenEntered = useRef(false);
  const manualLockRef = useRef(false);
  const manualLockedWeightRef = useRef(0);
  const snapshotBusyRef = useRef(false);
  const phoneRemoteRoleRef = useRef(null);
  const directPrintPendingRef = useRef(false);
  const printingRef = useRef(false);
  const remotePrintSeenRef = useRef(new Set());
  const remotePrintHandlerRef = useRef(null);
  const [form, setForm] = useState(DEFAULT_SCALE_FORM);

  useEffect(() => {
    try { sessionStorage.setItem("sonphu-scale-mobile-screen", mobileScreen); } catch { /* storage không bắt buộc */ }
  }, [mobileScreen]);

  const selected = useMemo(
    () => selectedId
      ? rows.find((row) => rowIdentity(row) === String(selectedId)) || EMPTY_ROW
      : rows.at(0) || EMPTY_ROW,
    [rows, selectedId]
  );
  const customerSuggestions = useMemo(() => [...new Set(rows.map((row) => String(row.customer || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi")), [rows]);
  const plateSuggestions = useMemo(() => [...new Set(rows.map((row) => normalizePlate(row.plate)).filter(Boolean))].sort(), [rows]);
  const customerHistorySuggestions = useMemo(() => buildHistorySuggestions(rows, (row) => String(row.customer || "").trim(), (value) => value.toLocaleLowerCase("vi-VN")), [rows]);
  const plateHistorySuggestions = useMemo(() => buildHistorySuggestions(rows, (row) => normalizePlate(row.plate), (value) => normalizePlate(value).replace(/\s/g, "").toLocaleLowerCase("vi-VN")), [rows]);
  const filteredCustomerSuggestions = useMemo(() => filterHistorySuggestions(customerHistorySuggestions, suggestionQuery.customer, false), [customerHistorySuggestions, suggestionQuery.customer]);
  const filteredPlateSuggestions = useMemo(() => filterHistorySuggestions(plateHistorySuggestions, suggestionQuery.plate, true), [plateHistorySuggestions, suggestionQuery.plate]);
  const currentBlacklistEntry = useMemo(() => {
    const plate = normalizePlate(form.plate);
    return blacklist.find((entry) => normalizePlate(entry.plate) === plate) || null;
  }, [blacklist, form.plate]);

  if (phoneRemoteRoleRef.current === null) phoneRemoteRoleRef.current = isPhoneRemoteDevice();
  const remoteScalePage = phoneRemoteRoleRef.current;
  const phoneScalePage = remoteScalePage;

  useEffect(() => {
    if (!onlineSessionActive) return undefined;
    const timer = window.setTimeout(() => setOnlineSessionActive(false), 5 * 60 * 1000);
    return () => window.clearTimeout(timer);
  }, [onlineSessionActive]);

  useEffect(() => {
    if (!selectedId) return;
    const row = rows.find((item) => rowIdentity(item) === String(selectedId));
    if (!row) return;
    const charge = Math.round(Number(row.charge ?? row.weigher) || 0);
    const paid = Math.max(0, Number(row.paid ?? row.driver) || 0);
    setTotalCharge(charge);
    setChargeInput(charge ? String(charge) : "0");
    setPaidInput(paid ? String(paid) : "");
    setPaidChecked(charge > 0 && paid >= charge);
  }, [rows, selectedId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const refreshRows = async () => {
      try {
        const nextRows = remoteScalePage ? await getCloudWeighings() : await getWeighings();
        if (active) setRows(dedupeWeighings(nextRows));
      } catch {
        // Máy mất mạng vẫn giữ nguyên lịch sử đang có trên màn hình.
      }
    };
    if (remoteScalePage) void refreshRows();
    // Máy trong LAN đọc lịch sử từ đầu cân/local API; không mở subscription
    // cloud liên tục. Thiết bị ngoài LAN vẫn nhận phiếu đã chốt qua Realtime.
    const channel = remoteScalePage
      ? supabase
        .channel("scale-weighings-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "scale_weighings" }, refreshRows)
        .subscribe()
      : null;
    // Trên cloud, Realtime đã báo ngay khi phiếu/tiền thay đổi; không cần
    // đọc lại toàn bộ lịch sử mỗi 2 giây. Màn LAN vẫn dùng polling nội bộ.
    const refreshTimer = isScaleMachineBrowser() ? window.setInterval(refreshRows, 2_000) : null;
    return () => {
      active = false;
      if (refreshTimer) window.clearInterval(refreshTimer);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [remoteScalePage]);

  useEffect(() => {
    if (!isScaleMachineBrowser() || bridgeInfo?.configured !== false || bridgeProvisionAttempted.current) return;
    bridgeProvisionAttempted.current = true;
    setPrintStatus("Đang tự cấu hình cầu nối in online…");
    void configureLocalScaleBridge()
      .then((result) => {
        if (result?.bridge) setBridgeInfo(result.bridge);
        setPrintStatus("Cầu nối in online đã hoạt động ✓");
      })
      .catch((error) => {
        // Cho phép thử lại sau khi người dùng đăng nhập tài khoản có quyền cân
        // hoặc khi máy vừa mới có mạng; không khóa cứng cấu hình ở lần lỗi đầu.
        bridgeProvisionAttempted.current = false;
        setPrintStatus(`Chưa cấu hình được cầu nối: ${error.message || "cần tài khoản có quyền cân"}`);
      });
    const retryTimer = window.setInterval(() => {
      if (bridgeProvisionAttempted.current) return;
      bridgeProvisionAttempted.current = true;
      void configureLocalScaleBridge()
        .then((result) => {
          if (result?.bridge) setBridgeInfo(result.bridge);
          setPrintStatus("Cầu nối in online đã hoạt động ✓");
        })
        .catch((error) => {
          bridgeProvisionAttempted.current = false;
          setPrintStatus(`Chưa cấu hình được cầu nối: ${error.message || "cần tài khoản có quyền cân"}`);
        });
    }, 15_000);
    return () => window.clearInterval(retryTimer);
  }, [bridgeInfo]);

  useEffect(() => {
    window.localStorage.setItem("scale-price-tiers", JSON.stringify(priceTiers));
  }, [priceTiers]);

  useEffect(() => {
    window.localStorage.setItem("scale-history-column-widths", JSON.stringify(historyColumnWidths));
  }, [historyColumnWidths]);

  useEffect(() => {
    window.localStorage.setItem("scale-plate-blacklist", JSON.stringify(blacklist));
  }, [blacklist]);

  useEffect(() => {
    let active = true;
    const applySettings = (settings) => {
      if (!active || !settings) return;
      if (settings.priceTiers.length) setPriceTiers(settings.priceTiers);
      setBlacklist(settings.blacklist);
    };
    void getScaleSettings().then(applySettings);
    const channel = remoteScalePage
      ? supabase
        .channel("scale-settings-realtime")
        .on("postgres_changes", { event: "*", schema: "public", table: "scale_settings", filter: "id=eq.main" }, (payload) => {
          applySettings({ priceTiers: payload.new?.price_tiers || [], blacklist: payload.new?.blacklist || [] });
        })
        .subscribe()
      : null;
    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [remoteScalePage]);

  useEffect(() => {
    if (!printPreviewOpen) return undefined;

    const closePreview = () => setPrintPreviewOpen(false);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") closePreview();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("afterprint", closePreview);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("afterprint", closePreview);
      if (printFullscreenEntered.current) {
        try { window.screen.orientation?.unlock?.(); } catch { /* Trình duyệt không hỗ trợ khóa xoay. */ }
        printFullscreenEntered.current = false;
        if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
      }
    };
  }, [printPreviewOpen]);

  useEffect(() => {
    if (!directPrintPending || !printPayload) return undefined;

    let settled = false;
    let timeout;
    const activeRemotePrint = remotePrintJob;
    const finishDirectPrint = (ok, error = "") => {
      if (settled) return;
      settled = true;
      if (timeout) window.clearTimeout(timeout);
      window.removeEventListener("afterprint", handleAfterPrint);
      if (!activeRemotePrint) {
        directPrintPendingRef.current = false;
        setDirectPrintPending(false);
        return;
      }
      void acknowledgeRemotePrint(activeRemotePrint, ok, error)
        .then(() => setPrintStatus(ok ? "Đã in xong" : "In không thành công"))
        .catch(() => setPrintStatus("Mất mạng"))
        .finally(() => {
          printingRef.current = false;
          directPrintPendingRef.current = false;
          setRemotePrintJob(null);
          setDirectPrintPending(false);
          setPrinting(false);
        });
    };
    const handleAfterPrint = () => finishDirectPrint(true);
    window.addEventListener("afterprint", handleAfterPrint, { once: true });
    const frame = window.requestAnimationFrame(() => {
      try {
        window.print();
      } catch (error) {
        finishDirectPrint(false, error?.message || "Không gọi được thao tác in");
      }
    });
    if (activeRemotePrint) {
      timeout = window.setTimeout(() => finishDirectPrint(false, "PC cân không xác nhận hoàn tất in"), 6_500);
    }
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("afterprint", handleAfterPrint);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [directPrintPending, printPayload, remotePrintJob]);

  const printTicket = () => {
    window.print();
  };

  const printAtScaleMachine = async (printRequest = {}) => {
    if (saving || printing) return;
    if (bridgeInfo && bridgeInfo.configured === false) {
      setPrintStatus("Máy đầu cân chưa bật cầu nối lệnh in online. Cần cập nhật/cấu hình bản chạy trên máy đầu cân.");
      return;
    }
    if (Date.now() - lastPrintRequestAt.current < 5_000) {
      setPrintStatus("Lệnh in vừa được gửi, vui lòng chờ máy in xử lý.");
      return;
    }
    const ticketNumber = printRequest.ticketNumber || printTicketNumber || createTicketNumber(now);
    const ticketForm = printRequest.form || printPayload?.form || form;
    const ticketCaptured = printRequest.captured || printPayload?.captured || captured;
    const billing = printRequest.billing || printPayload?.billing || { charge: visibleTotalCharge, paid: paidAmount, debt: debtAmount };
    printingRef.current = true;
    setPrinting(true);
    setPrintStatus("Đang in...");
    try {
      const result = await requestRemoteScalePrint({ ticketNumber, copies: printCopies, form: ticketForm, captured: ticketCaptured, billing });
      lastPrintRequestAt.current = Date.now();
      if (result?.printer) setPrinterInfo(result.printer);
      setPrintStatus("Đã in xong");
    } catch (error) {
      const isConnectionFailure = error?.scaleErrorCode === "CONNECTION_FAILURE"
        || error?.name === "AbortError"
        || error instanceof TypeError;
      setPrintStatus(isConnectionFailure ? "Mất mạng" : "In không thành công");
    } finally {
      printingRef.current = false;
      setPrinting(false);
    }
  };

  const createPrintRequest = () => ({
    ticketNumber: createTicketNumber(now),
    form: { ...form },
    captured: { ...captured },
    billing: { charge: visibleTotalCharge, paid: paidAmount, debt: debtAmount },
  });

  const printFromCurrentDevice = () => {
    const phoneLayout = phoneScalePage;
    setPrintAtMachineTarget(phoneLayout);
    if (phoneLayout) {
      const shouldEnterFullscreen = !document.fullscreenElement && Boolean(document.documentElement.requestFullscreen);
      const fullscreenRequest = shouldEnterFullscreen
        ? document.documentElement.requestFullscreen({ navigationUI: "hide" })
        : Promise.resolve();
      void Promise.resolve(fullscreenRequest)
        .then(() => {
          printFullscreenEntered.current = shouldEnterFullscreen;
          return window.screen.orientation?.lock?.("landscape");
        })
        .catch(() => {});
      const printRequest = createPrintRequest();
      setPrintTicketNumber(printRequest.ticketNumber);
      setPrintPayload(printRequest);
      // Điện thoại vẫn xem trước phiếu; chỉ nút In trong bản xem trước mới
      // gửi lệnh in im lặng về máy đầu cân.
      setPrintPreviewOpen(true);
      setPrintStatus(printerInfo?.message || "Sẵn sàng gửi lệnh in tới máy đầu cân…");
      return;
    }
    const printRequest = createPrintRequest();
    setPrintTicketNumber(printRequest.ticketNumber);
    setPrintPayload(printRequest);
    setPrintPreviewOpen(true);
    setPrintStatus("");
  };

  const printDirectFromCurrentDevice = () => {
    if (phoneScalePage || directPrintPendingRef.current || printingRef.current) return;
    const printRequest = createPrintRequest();
    setPrintAtMachineTarget(false);
    setPrintTicketNumber(printRequest.ticketNumber);
    setPrintPayload(printRequest);
    directPrintPendingRef.current = true;
    setDirectPrintPending(true);
    setPrintStatus("");
  };

  const handleRemotePrintEvent = async (printJob) => {
    if (!printJob?.id || !printJob.commandId || !isScaleMachineBrowser() || phoneScalePage) return;
    if (remotePrintSeenRef.current.has(printJob.commandId)) return;
    remotePrintSeenRef.current.add(printJob.commandId);
    try {
      if (!await claimRemotePrint(printJob)) return;
      if (directPrintPendingRef.current || printingRef.current) {
        await acknowledgeRemotePrint(printJob, false, "PC đang xử lý một lệnh in khác");
        return;
      }
      const copies = Math.min(10, Math.max(1, Number(printJob.copies) || 1));
      const printRequest = {
        ticketNumber: String(printJob.ticketNumber || createTicketNumber(now)),
        form: printJob.form && typeof printJob.form === "object" ? printJob.form : {},
        captured: printJob.captured && typeof printJob.captured === "object" ? printJob.captured : {},
        billing: printJob.billing && typeof printJob.billing === "object" ? printJob.billing : {},
      };
      setPrintAtMachineTarget(false);
      setPrintTicketNumber(printRequest.ticketNumber);
      setPrintPayload(printRequest);
      setPrintCopies(copies);
      setRemotePrintJob(printJob);
      printingRef.current = true;
      directPrintPendingRef.current = true;
      setPrinting(true);
      setPrintStatus("Đang in...");
      setDirectPrintPending(true);
    } catch {
      // HEAD sẽ đánh dấu command failed khi claim/ACK không hoàn tất.
    }
  };
  remotePrintHandlerRef.current = handleRemotePrintEvent;

  const returnToOrders = () => {
    window.location.assign(`${window.location.origin}/`);
  };

  useEffect(() => {
    let active = true;

    // Phone keeps the remote one-shot flow. A desktop browser on the internal
    // app must still try the local LAN/SSE endpoint before any cloud path.
    if (phoneScalePage) {
      setConnectionSource("offline");
      setLanConnected(false);
      setLanAvailable(false);
      setHeadConnected(false);
      setScaleOpen(true);
      setLiveWeight(0);
      return () => { active = false; };
    }

    const initialState = isScaleMachineBrowser()
      ? getScaleState({ allowOnline: false, allowCloud: false })
      : (onlineSessionActive
        ? updateScaleState({ open: true })
        : getScaleState({ allowOnline: false, allowCloud: false }));
    Promise.allSettled([initialState, getWeighings()])
      .then(([stateResult, rowsResult]) => {
        if (!active) return;
        if (stateResult.status === "fulfilled") {
          const state = stateResult.value;
          const rawSource = getScaleConnectionSource(state);
          const source = remoteScalePage && !onlineSessionActive && rawSource !== "lan" ? "offline" : rawSource;
          const headReady = source !== "offline" && scaleHeadReady(state);
          setConnectionSource(source);
          setLanConnected(source !== "offline");
          setLanAvailable(source === "lan");
          setHeadConnected(headReady);
          setSerialMessage(state.serialMessage || "Chờ dữ liệu từ đầu cân");
          setScaleOpen(Boolean(state.open));
          const holdManualLock = manualLockRef.current && manualLockedWeightRef.current > 0;
          setWeightLocked(holdManualLock || (headReady && Boolean(state.locked)));
          setLiveWeight(headReady ? Number(state.weight) || 0 : 0);
          setLockedWeight(holdManualLock ? manualLockedWeightRef.current : (headReady ? Number(state.lockedWeight) || 0 : 0));
        }
        if (rowsResult.status !== "fulfilled") return;
        const normalizedRows = dedupeWeighings(rowsResult.value);
        setRows(normalizedRows);
        const preserved = selectedIdRef.current
          ? normalizedRows.find((row) => rowIdentity(row) === String(selectedIdRef.current))
          : null;
        const first = preserved || (!manualSelectionRef.current ? normalizedRows[0] : null);
        if (first) {
          selectedIdRef.current = rowIdentity(first);
          setSelectedId(rowIdentity(first));
          setCaptured({
            gross: first.gross,
            tare: first.tare,
            grossAt: first.grossAt || "",
            tareAt: first.tareAt || "",
          });
          setCaptureLocked({ gross: first.gross > 0, tare: first.tare > 0 });
          setForm((current) => ({ ...current, customer: first.customer, plate: first.plate, plateNote: first.plateNote, direction: first.direction, goods: first.goods }));
          setTotalCharge(first.charge);
          setChargeInput(first.charge ? String(first.charge) : "");
          setPaidInput(first.paid ? String(first.paid) : "");
          setPaidChecked(first.charge > 0 && first.paid >= first.charge);
          setNoExtraCharge(first.noCharge);
          setSeriesId(first.seriesId);
          setSourceId(first.sourceId || "");
        } else if (!normalizedRows.length && !manualSelectionRef.current) {
          selectedIdRef.current = null;
          setSelectedId(null);
          setCaptured({ gross: 0, tare: 0, grossAt: "", tareAt: "" });
          setCaptureLocked({ gross: false, tare: false });
          setSourceId("");
        }
      })
      .catch(() => { setLanConnected(false); setLanAvailable(false); setConnectionSource("offline"); });

    const unsubscribe = subscribeToScale((state) => {
      if (!active) return;
      if (state.printer) setPrinterInfo(state.printer);
      if (state.bridge) setBridgeInfo(state.bridge);
      const headReady = scaleHeadReady(state);
      setHeadConnected(headReady);
      setSerialMessage(state.serialMessage || "Chờ dữ liệu từ đầu cân");
      setScaleOpen(Boolean(state.open));
      const holdManualLock = manualLockRef.current && manualLockedWeightRef.current > 0;
      setWeightLocked(holdManualLock || (headReady && Boolean(state.locked)));
      setLiveWeight(headReady ? Number(state.weight) || 0 : 0);
      setLockedWeight(holdManualLock ? manualLockedWeightRef.current : (headReady ? Number(state.lockedWeight) || 0 : 0));
    }, (connected, transport, source) => {
      if (!active) return;
      const isLan = connected && (source === "server" || transport === "server");
      const isSupabase = connected && (source === "cloud" || source === "cloud-snapshot" || transport === "supabase");
      const isOnline = connected && (source === "online" || transport === "online");
      setConnectionSource(isLan ? "lan" : (isSupabase ? "supabase" : (isOnline ? "online" : "offline")));
      setLanConnected(connected);
      setLanAvailable(isLan);
      if (!connected) {
        setHeadConnected(false);
        setLiveWeight(0);
        if (!manualLockRef.current) {
          setWeightLocked(false);
          setLockedWeight(0);
        }
      }
    }, {
      cloudEnabled: remoteScalePage && onlineSessionActive,
      onRemotePrint: (printJob) => remotePrintHandlerRef.current?.(printJob),
    });

    let polling = false;
    const pollScaleState = async () => {
      if (!active || polling) return;
      polling = true;
      try {
        const canUseOnline = onlineSessionActive;
        const state = await getScaleState({ allowOnline: canUseOnline, allowCloud: canUseOnline });
        if (!active) return;
        const rawSource = getScaleConnectionSource(state);
        const source = remoteScalePage && !onlineSessionActive && rawSource !== "lan" ? "offline" : rawSource;
        const headReady = source !== "offline" && scaleHeadReady(state);
        setConnectionSource(source);
        setLanConnected(source !== "offline");
        setLanAvailable(source === "lan");
        setHeadConnected(headReady);
        setSerialMessage(state.serialMessage || "Chờ dữ liệu từ đầu cân");
        setScaleOpen(Boolean(state.open));
        const holdManualLock = manualLockRef.current && manualLockedWeightRef.current > 0;
        setWeightLocked(holdManualLock || (headReady && Boolean(state.locked)));
        setLiveWeight(headReady ? Number(state.weight) || 0 : 0);
        setLockedWeight(holdManualLock ? manualLockedWeightRef.current : (headReady ? Number(state.lockedWeight) || 0 : 0));
      } catch {
        // Kết nối realtime tự quyết định trạng thái online/offline.
      } finally {
        polling = false;
      }
    };
    const pollTimer = window.setInterval(() => {
      if (isScaleMachineBrowser() || remoteScalePage) void pollScaleState();
    }, 5_000);

    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(pollTimer);
    };
  }, [onlineSessionActive, remoteScalePage, phoneScalePage]);

  useEffect(() => {
    if (phoneScalePage) return;
    if (lanConnected && headConnected) return;
    setLiveWeight(0);
    if (!manualLockRef.current) {
      setWeightLocked(false);
      setLockedWeight(0);
    }
  }, [lanConnected, headConnected, remoteScalePage, phoneScalePage]);

  const visibleRows = rows.filter((row) => {
    if (filter === "pending" && row.gross > 0 && row.tare > 0) return false;
    if (filter === "done" && (!row.gross || !row.tare)) return false;
    if (historyQuery) {
      if (historyQueryType === "customer" && !String(row.customer || "").toLocaleLowerCase("vi-VN").includes(historyQuery.toLocaleLowerCase("vi-VN"))) return false;
      if (historyQueryType === "plate" && !normalizePlate(row.plate).replace(/\s/g, "").includes(normalizePlate(historyQuery).replace(/\s/g, ""))) return false;
    }
    const date = rowDate(row);
    const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startYear = new Date(now.getFullYear(), 0, 1);
    if (dateFilter === "last30") {
      const start = new Date(startToday); start.setDate(start.getDate() - 29);
      return date >= start;
    }
    if (dateFilter === "today") return date >= startToday;
    if (["yesterday", "2days", "3days", "7days"].includes(dateFilter)) {
      const days = dateFilter === "7days" ? 6 : (dateFilter === "yesterday" ? 1 : Number(dateFilter.replace("days", "")));
      const start = new Date(startToday); start.setDate(start.getDate() - days);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      return date >= start && (dateFilter === "7days" ? date <= now : date < end);
    }
    if (dateFilter === "month") return date >= startMonth;
    if (dateFilter === "year") return date >= startYear;
    if (dateFilter === "custom") {
      const from = customFrom ? new Date(`${customFrom}T00:00:00`) : new Date(0);
      const to = customTo ? new Date(`${customTo}T23:59:59.999`) : now;
      return date >= from && date <= to;
    }
    return true;
  });

  const updateField = (name, value) => {
    setNewWeighingPrimed(false);
    setForm((current) => ({ ...current, [name]: value }));
  };
  const changeDirection = (value) => {
    updateField("direction", value);
    if (directionDefaultsToNoCharge(value)) {
      toggleNoCharge(true);
    } else if (directionDefaultsToNoCharge(form.direction)) {
      toggleNoCharge(false);
    }
  };
  const closeSuggestionsSoon = () => {
    window.setTimeout(() => setSuggestionField(""), 140);
  };
  const focusSuggestion = (field) => {
    setSuggestionField(field);
    setSuggestionQuery((current) => ({ ...current, [field]: "" }));
  };
  const changeSuggestion = (field, value) => {
    setSuggestionQuery((current) => ({ ...current, [field]: value }));
    updateField(field, value);
  };
  const chooseSuggestion = (field, value) => {
    setSuggestionQuery((current) => ({ ...current, [field]: value }));
    updateField(field, value);
    setSuggestionField("");
  };
  const searchHistoryByField = (field) => {
    const value = field === "customer" ? String(form.customer || "").trim() : normalizePlate(form.plate);
    setHistoryQueryType(field);
    setHistoryQuery(value);
    setFilter("all");
    setDateFilter("all");
    setCustomFrom("");
    setCustomTo("");
    if (isPhoneLayout()) setMobileScreen("history");
  };
  const clearHistorySearch = () => {
    setHistoryQueryType("");
    setHistoryQuery("");
  };
  const selectRow = (row) => {
    manualSelectionRef.current = true;
    selectedIdRef.current = rowIdentity(row);
    setNewWeighingPrimed(false);
    setAdditionalWeighingActive(false);
    const savedTotal = Math.round(Number(row.charge ?? row.weigher) || 0);
    const savedPaid = Math.max(0, Number(row.paid ?? row.driver) || 0);
    setTotalCharge(savedTotal);
    setPaidInput(savedPaid ? String(savedPaid) : "");
    setPaidChecked(savedTotal > 0 && savedPaid >= savedTotal);
    setChargeInput(savedTotal ? String(savedTotal) : "");
    setNoExtraCharge(Boolean(row.noCharge));
    setChargeManuallyEdited(savedTotal > 0);
    setMoneyMessage("");
    setSeriesId(row.seriesId || `scale-${row.id}`);
    setSourceId(row.sourceId || "");
    setSelectedId(rowIdentity(row));
    setLiveWeight(row.net);
    setLockedWeight(row.net);
    setCaptured({
      gross: row.gross,
      tare: row.tare,
      grossAt: row.grossAt || "",
      tareAt: row.tareAt || "",
    });
    setCaptureLocked({ gross: row.gross > 0, tare: row.tare > 0 });
    setWeightLocked(false);
    setForm((current) => ({
      ...current,
      customer: row.customer,
      plate: row.plate,
      plateNote: row.plateNote || "",
      direction: row.direction,
      goods: row.goods,
    }));
    setMobileScreen("weighing");
  };

  const openEditDialog = (row) => {
    if (!row?.id && !row?.sourceId) return;
    setEditDialog({
      row,
      plate: row.plate || "",
      plateNote: row.plateNote || "",
      customer: row.customer || "",
      direction: row.direction || "",
      goods: row.goods || "",
      gross: row.gross ? String(row.gross) : "",
      tare: row.tare ? String(row.tare) : "",
      grossAt: toDateTimeLocal(row.grossAt),
      tareAt: toDateTimeLocal(row.tareAt),
      charge: String(Math.round(Number(row.charge ?? row.weigher) || 0)),
      paid: String(Math.max(0, Number(row.paid ?? row.driver) || 0)),
    });
  };

  const performEditRow = async () => {
    if (!editDialog?.row || saving) return;
    const draft = editDialog;
    const weights = normalizeWeightPair({
      gross: draft.gross,
      tare: draft.tare,
      grossAt: fromDateTimeLocal(draft.grossAt),
      tareAt: fromDateTimeLocal(draft.tareAt),
    });
    const cancelled = Boolean(draft.row.cancelled);
    const charge = cancelled ? 0 : Math.round(Number(draft.charge) || 0);
    const paid = cancelled ? 0 : Math.max(0, Math.round(Number(draft.paid) || 0));
    setSaving(true);
    try {
      const saved = normalizeWeighing(await updateWeighingCloudFirst({
        ...draft.row,
        plate: normalizePlate(draft.plate),
        plateNote: String(draft.plateNote || "").trim(),
        customer: String(draft.customer || "").trim(),
        direction: draft.direction,
        goods: String(draft.goods || "").trim(),
        ...weights,
        charge,
        paid,
        weigher: String(charge),
        driver: String(paid),
        noCharge: cancelled || charge === 0,
        updatedAt: new Date().toISOString(),
      }));
      setRows((current) => [saved, ...current.filter((row) => !sameRow(row, saved))]);
      setEditDialog(null);
      selectRow(saved);
      if (saved.machineSyncError) setMoneyMessage(`Đã sửa trên web nhưng chưa đồng bộ về đầu cân: ${saved.machineSyncError}`);
    } catch (error) {
      window.alert(error.message || "Chưa sửa được phiếu cân");
    } finally {
      setSaving(false);
    }
  };

  const saveEditedRow = () => {
    if (!editDialog?.row) return;
    void performEditRow();
  };

  const toggleScale = async () => {
    manualLockRef.current = false;
    manualLockedWeightRef.current = 0;
    if (lanConnected) {
      try {
        await updateScaleState({ open: !scaleOpen, locked: false });
      } catch {
        setLanConnected(false);
      }
      return;
    }
    if (scaleOpen) {
      setScaleOpen(false);
      setWeightLocked(false);
      setLiveWeight(0);
      return;
    }
    setScaleOpen(true);
    setWeightLocked(false);
    setLiveWeight(0);
    setLockedWeight(0);
  };

  const toggleWeightLock = async () => {
    if (phoneScalePage) {
      if (snapshotBusyRef.current) return;
      const nextLocked = !weightLocked;
      snapshotBusyRef.current = true;
      setSnapshotLoading(true);
      setSerialMessage(nextLocked ? "Đang lấy số cân…" : "Đang đồng bộ…");
      try {
        const result = await requestScaleLock(nextLocked);
        const state = result?.state || {};
        const resultWeight = Math.round(Number(state.lockedWeight ?? state.weight) || 0);
        manualLockRef.current = Boolean(state.locked);
        manualLockedWeightRef.current = resultWeight;
        setLockedWeight(state.locked ? resultWeight : 0);
        setWeightLocked(Boolean(state.locked));
        setLiveWeight(0);
        setSerialMessage(nextLocked ? "Đã khóa số ✓" : "Đã mở khóa ✓");
      } catch (error) {
        setSerialMessage(error.message || "Không đồng bộ được trạng thái khóa số");
      } finally {
        snapshotBusyRef.current = false;
        setSnapshotLoading(false);
      }
      return;
    }
    if (!scaleOpen || !lanConnected || !headConnected) return;
    if (!weightLocked && liveWeight <= 0) return;
    const previousLocked = weightLocked;
    const previousLockedWeight = lockedWeight;
    const nextLocked = !weightLocked;
    if (nextLocked) {
      manualLockRef.current = true;
      manualLockedWeightRef.current = liveWeight;
      setLockedWeight(liveWeight);
      setWeightLocked(true);
    } else {
      manualLockRef.current = false;
      manualLockedWeightRef.current = 0;
      setWeightLocked(false);
    }
    try {
      const state = await updateScaleState({ locked: nextLocked });
      const headReady = scaleHeadReady({ ...state, receivedAt: new Date().toISOString() });
      setLanConnected(true);
      setHeadConnected(headReady);
      const holdManualLock = manualLockRef.current && manualLockedWeightRef.current > 0;
      setWeightLocked(holdManualLock || (headReady && Boolean(state.locked)));
      setLiveWeight(headReady ? Number(state.weight) || 0 : liveWeight);
      setLockedWeight(holdManualLock ? manualLockedWeightRef.current : (headReady && state.locked ? Number(state.lockedWeight) || Number(state.weight) || liveWeight : 0));
      if (nextLocked && !state.locked) setSerialMessage("Đầu cân chưa chấp nhận chốt số. Hãy chờ số cân hiện lại rồi bấm Khóa số.");
    } catch (error) {
      setWeightLocked(previousLocked);
      setLockedWeight(previousLockedWeight);
      setSerialMessage(`Không gửi được lệnh chốt số: ${error.message || "lỗi kết nối"}`);
    }
  };

  const startNewWeighing = () => {
    manualSelectionRef.current = true;
    if (newWeighingPrimed) {
      setForm(DEFAULT_SCALE_FORM);
      setNewWeighingPrimed(false);
      setChargeInput("0");
      setNoExtraCharge(false);
      setTotalCharge(0);
      setPaidInput("");
      setPaidChecked(false);
      setMoneyMessage("");
      setSeriesId("");
      setSourceId("");
      setChargeManuallyEdited(false);
      setAdditionalWeighingActive(false);
      return;
    }
    const preservedNoCharge = directionDefaultsToNoCharge(form.direction);
    selectedIdRef.current = null;
    setSelectedId(null);
    setCaptured({ gross: 0, tare: 0, grossAt: "", tareAt: "" });
    setCaptureLocked({ gross: false, tare: false });
    setCaptured({ gross: 0, tare: 0, grossAt: "", tareAt: "" });
    setNewWeighingPrimed(true);
    setChargeInput("0");
    setNoExtraCharge(preservedNoCharge);
    setTotalCharge(0);
    setPaidInput("");
    setPaidChecked(false);
    setMoneyMessage("");
    setSeriesId("");
    setSourceId("");
    setChargeManuallyEdited(false);
    setAdditionalWeighingActive(false);
  };

  const startAdditionalWeighing = () => {
    if (saving || !selectedId) return;
    manualSelectionRef.current = true;
    const nextSeriesId = seriesId || selected.seriesId || (selected.id ? `scale-${selected.id}` : createScaleUuid());
    setSeriesId(nextSeriesId);
    // Cân thêm là một lượt mới, dù vẫn thuộc cùng series.
    setSourceId("");
    selectedIdRef.current = null;
    setSelectedId(null);
    setCaptureLocked({ gross: false, tare: false });
    setNewWeighingPrimed(false);
    setAdditionalWeighingActive(true);
    setChargeInput("");
    setTotalCharge(0);
    setChargeManuallyEdited(false);
    setNoExtraCharge(directionDefaultsToNoCharge(form.direction));
    setPaidInput("");
    setPaidChecked(false);
    setMoneyMessage("Cân lại tổng hoặc bì để tạo mã cân tiếp theo");
  };

  const captureWeight = async (kind) => {
    if (captureLocked[kind] || saving) return;
    if (!weightLocked) {
      window.alert("Bạn chưa chốt số");
      return;
    }
    if (!phoneScalePage && (!lanConnected || !headConnected)) {
      setWeightLocked(false);
      setLiveWeight(0);
      setLockedWeight(0);
      return;
    }
    const value = lockedWeight;
    if (value <= 0) return;
    setNewWeighingPrimed(false);
    // Giữ đúng giá trị của cả hai lần cân. Không dùng tên nút Tổng/Bì để
    // ghi đè lại số đã chốt; cặp số sẽ được chuẩn hóa theo khối lượng.
    const rawNext = { ...captured, [kind]: value, [`${kind}At`]: new Date().toISOString() };
    const next = normalizeWeightPair(rawNext);
    const manualCharge = Number(chargeInput);
    const activeSeriesId = seriesId || selected?.seriesId || "";
    const seriesRows = activeSeriesId ? rows.filter((row) => row.seriesId === activeSeriesId) : [];
    const previousSeriesWeight = seriesRows.reduce((highest, row) => Math.max(highest, Number(row.gross) || 0, Number(row.tare) || 0), 0);
    const captureNumber = additionalWeighingActive
      ? seriesRows.length + 1
      : (Number(next.gross) > 0 ? 1 : 0) + (Number(next.tare) > 0 ? 1 : 0);
    const pricingWeight = captureNumber === 2
      ? Math.max(previousSeriesWeight, Number(next.gross) || 0, Number(next.tare) || 0)
      : value;
    const oldPlateDebt = rows.reduce((total, row) => {
      if (row.cancelled || normalizePlate(row.plate) !== normalizePlate(form.plate) || (selectedId && rowIdentity(row) === String(selectedId))) return total;
      const charge = Math.round(Number(row.charge ?? row.weigher) || 0);
      const paid = Math.max(0, Number(row.paid ?? row.driver) || 0);
      return total + Math.max(0, charge - paid);
    }, 0);
    // Không tự áp giá khi khóa số hoặc khi chốt Tổng/Bì. Giá chỉ được áp
    // khi người dùng bấm nút "Áp giá bán" hoặc tự nhập tiền.
    const appliedCharge = noExtraCharge ? 0 : (chargeManuallyEdited ? Math.round(manualCharge) : totalCharge);
    const nextTotalCharge = Math.round(appliedCharge);
    setMoneyMessage("");
    const currentPaid = Math.max(0, Math.round(Number(paidInput) || 0));
    const nextPaid = paidChecked ? nextTotalCharge : currentPaid;
    setTotalCharge(nextTotalCharge);
    if (paidChecked) setPaidInput(String(nextPaid));
    setChargeInput(appliedCharge > 0 ? String(appliedCharge) : "0");
    setCaptured(next);
    setCaptureLocked((current) => additionalWeighingActive ? { gross: true, tare: true } : { ...current, [kind]: true });
    if (!lanConnected && !phoneScalePage) return;

    setSaving(true);
    try {
      const nextSeriesId = seriesId || (selectedId ? selected.seriesId || `scale-${selected.id}` : createScaleUuid());
      const nextSourceId = sourceId
        || (selectedId ? selected.sourceId : "")
        || (selectedId && selected.id ? `scale-head-192-168-1-12:${selected.id}` : `browser:${createScaleUuid()}`);
      setSourceId(nextSourceId);
      const saved = await saveWeighing({
        id: selectedId ? selected.id : null,
        sourceId: nextSourceId,
        ...form,
        weigher: String(nextTotalCharge),
        driver: String(nextPaid),
        charge: nextTotalCharge,
        paid: nextPaid,
        noCharge: noExtraCharge,
        seriesId: nextSeriesId,
        operatorName: currentOperatorName,
        // Gửi cặp số đã chuẩn hóa; server cũng chuẩn hóa lần cuối để LAN,
        // Supabase và máy đầu cân luôn ghi cùng một kết quả.
        ...next,
        net: next.gross - next.tare,
      });
      const normalized = normalizeWeighing(saved);
      setRows((current) => [normalized, ...current.filter((row) => !sameRow(row, normalized))]);
      manualSelectionRef.current = true;
      selectedIdRef.current = rowIdentity(normalized);
      setSelectedId(rowIdentity(normalized));
      setSourceId(normalized.sourceId || nextSourceId);
      setSeriesId(nextSeriesId);
      setCaptured({
        gross: normalized.gross,
        tare: normalized.tare,
        grossAt: normalized.grossAt || "",
        tareAt: normalized.tareAt || "",
      });
      setAdditionalWeighingActive(false);
      if (next.gross > 0 || next.tare > 0) {
        setPaymentDialog({
          row: normalized,
          captureNumber,
          pricingWeight,
          previousRows: seriesRows,
          oldPlateDebt,
          charge: String(normalized.charge || 0),
          paid: normalized.paid > 0 ? String(normalized.paid) : "",
          paidChecked: normalized.charge > 0 && normalized.paid >= normalized.charge,
        });
      }
      if (saved.machineSyncError) {
        setMoneyMessage(`Đã lưu trên web nhưng chưa đồng bộ về đầu cân: ${saved.machineSyncError}`);
      }
      void notifyScaleWeighing({ weighingId: saved.id, plate: normalized.plate, charge: normalized.charge });
    } catch (error) {
      setMoneyMessage(`Chưa lưu được mã cân: ${error.message || "lỗi kết nối"}. Dữ liệu vẫn giữ trên màn hình để thử lại.`);
    } finally {
      setSaving(false);
    }
  };

  const persistCurrentWeighing = async (overrides = {}) => {
    if (saving || !selectedId) return;
    const cancelled = Boolean(selected.cancelled);
    const charge = cancelled ? 0 : (overrides.charge ?? totalCharge);
    const paid = cancelled ? 0 : (overrides.paid ?? Math.max(0, Math.round(Number(paidInput) || 0)));
    const previousPaid = Math.max(0, Math.round(Number(selected?.paid ?? selected?.driver) || 0));
    const paymentChanged = paid !== previousPaid;
    setSaving(true);
    try {
      const saved = normalizeWeighing(await saveWeighing({
        ...selected,
        ...form,
        id: selected.id,
        charge,
        paid,
        noCharge: overrides.noCharge ?? noExtraCharge,
        weigher: String(charge),
        driver: String(paid),
        gross: captured.gross,
        tare: captured.tare,
        net: captured.gross - captured.tare,
        grossAt: captured.grossAt || "",
        tareAt: captured.tareAt || "",
        seriesId: seriesId || selected.seriesId || `scale-${selected.id}`,
        // Đổi tiền đã thu thì lấy đúng thời điểm đổi làm ngày trả tiền.
        updatedAt: paymentChanged ? new Date().toISOString() : selected.updatedAt,
      }));
      setRows((current) => [saved, ...current.filter((row) => !sameRow(row, saved))]);
    } finally {
      setSaving(false);
    }
  };

  const applySellingPrice = async (target = "current") => {
    if (selected.cancelled || paymentDialog?.row?.cancelled || noExtraCharge) return;
    const pricingWeight = target === "dialog"
      ? Number(paymentDialog?.pricingWeight) || 0
      : fallbackPricingWeight;
    const nextPrice = Math.round(Number(findAutomaticPrice(priceTiers, form.goods, pricingWeight)));
    if (nextPrice <= 0) {
      setMoneyMessage("Chưa có giá bán phù hợp trong Bảng giá.");
      return;
    }
    if (target === "dialog") {
      setPaymentDialog((current) => current
        ? { ...current, charge: String(nextPrice), paid: current.paidChecked ? String(nextPrice) : current.paid, priceApplied: true }
        : current);
      return;
    }
    if (selectedId) {
      const nextPaid = paidChecked ? nextPrice : paidAmount;
      setTotalCharge(nextPrice);
      setChargeInput(String(nextPrice));
      setChargeManuallyEdited(false);
      setMoneyMessage(`Đã áp giá bán ${numberText(nextPrice)}đ`);
      if (paidChecked) setPaidInput(String(nextPrice));
      await persistCurrentWeighing({ charge: nextPrice, paid: nextPaid });
      return;
    }
    setTotalCharge(nextPrice);
    setChargeInput(String(nextPrice));
    setChargeManuallyEdited(false);
    setMoneyMessage(`Đã áp giá bán ${numberText(nextPrice)}đ`);
    if (paidChecked) setPaidInput(String(nextPrice));
  };

  const changeCharge = (value) => {
    if (selected.cancelled) return;
    const charge = Math.round(Number(value) || 0);
    setChargeInput(value);
    setTotalCharge(charge);
    setChargeManuallyEdited(true);
    setMoneyMessage("");
    if (paidChecked) setPaidInput(String(charge));
  };

  const changePaid = (value) => {
    if (selected.cancelled) return;
    setPaidChecked(false);
    setPaidInput(value);
  };

  const toggleNoCharge = (checked) => {
    if (selected.cancelled) return;
    setNoExtraCharge(checked);
    setMoneyMessage("");
    if (checked) {
      setChargeInput("0");
      setTotalCharge(0);
      setPaidInput("0");
      setPaidChecked(false);
      setChargeManuallyEdited(true);
      void persistCurrentWeighing({ charge: 0, paid: 0, noCharge: true });
    } else {
      setChargeInput("");
      setChargeManuallyEdited(false);
      void persistCurrentWeighing({ charge: 0, paid: 0, noCharge: false });
    }
  };

  const performToggleCancelled = async (row) => {
    if (saving) return;
    const cancelled = !row.cancelled;
    const optimistic = normalizeWeighing({
      ...row,
      cancelled,
      cancelledAt: cancelled ? new Date().toISOString() : "",
    });
    setRows((current) => current.map((item) => sameRow(item, row) ? optimistic : item));
    setSaving(true);
    try {
      const saved = normalizeWeighing(await updateWeighingCloudFirst(optimistic));
      setRows((current) => current.map((item) => sameRow(item, saved) ? saved : item));
      if (saved.machineSyncError) {
        setMoneyMessage(`Đã cập nhật trên web nhưng chưa đồng bộ trạng thái về đầu cân: ${saved.machineSyncError}`);
      }
    } catch (error) {
      setRows((current) => current.map((item) => sameRow(item, row) ? row : item));
      window.alert(error.message || "Chưa cập nhật được trạng thái hủy cân");
    } finally {
      setSaving(false);
    }
  };

  const toggleCancelled = (row) => {
    if (!row || saving) return;
    void performToggleCancelled(row);
  };

  const toggleRowPaid = async (row, checked) => {
    if (saving || row.cancelled) return;
    const charge = Math.round(Number(row.charge ?? row.weigher) || 0);
    const paid = checked ? charge : 0;
    setSaving(true);
    try {
      const saved = normalizeWeighing(await saveWeighing({
        ...row,
        charge,
        paid,
        weigher: String(charge),
        driver: String(paid),
      }));
      setRows((current) => current.map((item) => sameRow(item, saved) ? saved : item));
      if (sameRow(selected, saved)) {
        setPaidInput(paid > 0 ? String(paid) : "");
        setPaidChecked(checked);
      }
    } finally {
      setSaving(false);
    }
  };

  const changeBlacklistState = (checked) => {
    const plate = normalizePlate(form.plate);
    if (!plate) {
      window.alert("Cần nhập biển số trước khi thêm vào danh sách đen");
      return;
    }
    if (!checked) {
      setBlacklist((current) => {
        const next = current.filter((entry) => normalizePlate(entry.plate) !== plate);
        void saveScaleSettings({ priceTiers, blacklist: next });
        return next;
      });
      return;
    }
    setBlacklistDialog({ plate, reason: currentBlacklistEntry?.reason || "" });
  };

  const saveBlacklistEntry = () => {
    const plate = normalizePlate(blacklistDialog?.plate);
    const reason = String(blacklistDialog?.reason || "").trim();
    if (!plate || !reason) return;
    setBlacklist((current) => {
      const next = [{ plate, reason, updatedAt: new Date().toISOString() }, ...current.filter((entry) => normalizePlate(entry.plate) !== plate)];
      void saveScaleSettings({ priceTiers, blacklist: next });
      return next;
    });
    setBlacklistDialog(null);
  };

  const removeBlacklistEntry = (entry) => {
    const plate = normalizePlate(entry?.plate);
    setBlacklist((current) => {
      const next = current.filter((item) => normalizePlate(item.plate) !== plate);
      void saveScaleSettings({ priceTiers, blacklist: next });
      return next;
    });
  };

  const savePaymentDialog = async () => {
    if (!paymentDialog?.row || saving) return;
    const charge = Math.round(Number(paymentDialog.charge) || 0);
    const paid = paymentDialog.paidChecked
      ? charge
      : Math.max(0, Math.round(Number(paymentDialog.paid) || 0));
    setSaving(true);
    try {
      const saved = normalizeWeighing(await saveWeighing({
        ...paymentDialog.row,
        ...form,
        charge,
        paid,
        noCharge: charge === 0,
        weigher: String(charge),
        driver: String(paid),
      }));
      setRows((current) => [saved, ...current.filter((row) => !sameRow(row, saved))]);
      selectedIdRef.current = rowIdentity(saved);
      setSelectedId(rowIdentity(saved));
      setTotalCharge(charge);
      setChargeInput(String(charge));
      setPaidInput(paid > 0 ? String(paid) : "");
      setPaidChecked(charge > 0 && paid >= charge);
      setNoExtraCharge(charge === 0);
      setPaymentDialog(null);
    } catch (error) {
      setMoneyMessage(`Chưa lưu được thông tin thanh toán: ${error.message || "lỗi kết nối"}`);
    } finally {
      setSaving(false);
    }
  };

  const openStatistics = async () => {
    setStatisticsOpen(true);
    setStatisticsLoading(true);
    try {
      const allRows = await getWeighingsForStatistics();
      setStatisticsRows(allRows.map(normalizeWeighing));
    } finally {
      setStatisticsLoading(false);
    }
  };

  const startHistoryColumnResize = (index, event) => {
    if (index >= HISTORY_COLUMNS.length - 1) return;
    event.preventDefault();
    event.stopPropagation();
    const table = event.currentTarget.closest("table");
    const tableWidth = table?.getBoundingClientRect().width || 1;
    const startX = event.clientX;
    const startLeft = historyColumnWidths[index];
    const startRight = historyColumnWidths[index + 1];
    const pairWidth = startLeft + startRight;
    const minLeft = HISTORY_COLUMNS[index].min;
    const minRight = HISTORY_COLUMNS[index + 1].min;

    const handlePointerMove = (moveEvent) => {
      const delta = ((moveEvent.clientX - startX) / tableWidth) * 100;
      const left = Math.min(pairWidth - minRight, Math.max(minLeft, startLeft + delta));
      setHistoryColumnWidths((current) => {
        const next = [...current];
        next[index] = Number(left.toFixed(2));
        next[index + 1] = Number((pairWidth - left).toFixed(2));
        return next;
      });
    };
    const stopResize = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize, { once: true });
  };

  const displayWeight = scaleOpen
    ? (phoneScalePage ? (weightLocked ? lockedWeight : 0) : (weightLocked ? lockedWeight : (lanConnected && headConnected ? liveWeight : 0)))
    : 0;
  const connectionLabel = phoneScalePage
    ? "KHÓA SỐ"
    : connectionSource === "lan"
    ? (headConnected ? "LAN • Đầu cân đang kết nối" : "LAN • Đã vào máy chủ, chờ đầu cân")
      : (connectionSource === "supabase"
      ? (headConnected ? "SUPABASE • Cân online từ xa" : "SUPABASE • Kết nối dự phòng")
      : (connectionSource === "online"
        ? (headConnected ? "ONLINE • Đang kết nối cân online 5 phút" : "ONLINE • Đang kết nối cân online 5 phút, chờ đầu cân")
        : (remoteScalePage && !onlineSessionActive ? "CHƯA KẾT NỐI • Bấm Kết nối cân online 5 phút" : "MẤT KẾT NỐI • LAN / SUPABASE")));
  const connectionClass = connectionSource === "lan"
    ? (headConnected ? "is-ready" : "is-waiting")
    : (connectionSource === "supabase" ? "is-cloud" : (connectionSource === "online" ? "is-online" : "is-offline"));
  const detailsLocked = captureLocked.gross || captureLocked.tare;
  const selectedCancelled = Boolean(selected.cancelled);
  const fallbackPricingWeight = captured.gross > 0 && captured.tare > 0
    ? Math.abs(captured.gross - captured.tare)
    : (captured.gross || captured.tare);
  const visibleTotalCharge = selectedCancelled || noExtraCharge ? 0 : totalCharge;
  const visibleChargeInput = selectedCancelled || noExtraCharge ? "0" : chargeInput;
  const paidAmount = selectedCancelled || noExtraCharge ? 0 : Math.max(0, Math.round(Number(paidInput) || 0));
  const debtAmount = Math.max(0, visibleTotalCharge - paidAmount);
  const oldPlateDebtAmount = rows.reduce((total, row) => {
    if (row.cancelled || normalizePlate(row.plate) !== normalizePlate(form.plate) || (selectedId && rowIdentity(row) === String(selectedId))) return total;
    const charge = Math.round(Number(row.charge ?? row.weigher) || 0);
    const paid = Math.max(0, Number(row.paid ?? row.driver) || 0);
    return total + Math.max(0, charge - paid);
  }, 0);
  const totalPlateDebtAmount = oldPlateDebtAmount + debtAmount;
  const statisticsFilteredRows = (statisticsRows || rows).filter((row) => {
    if (row.cancelled) return false;
    const date = rowDate(row);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startYear = new Date(now.getFullYear(), 0, 1);
    if (statisticsDateFilter === "today" && date < today) return false;
    if (statisticsDateFilter === "yesterday") {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      if (date < yesterday || date >= today) return false;
    }
    if (["3days", "5days", "7days"].includes(statisticsDateFilter)) {
      const days = Number(statisticsDateFilter.replace("days", ""));
      const from = new Date(today);
      from.setDate(from.getDate() - (days - 1));
      if (date < from) return false;
    }
    if (statisticsDateFilter === "month" && date < startMonth) return false;
    if (statisticsDateFilter === "year" && date < startYear) return false;
    if (statisticsDateFilter === "custom") {
      const from = statisticsCustomFrom ? new Date(`${statisticsCustomFrom}T00:00:00`) : new Date(0);
      const to = statisticsCustomTo ? new Date(`${statisticsCustomTo}T23:59:59.999`) : now;
      if (date < from || date > to) return false;
    }
    const query = String(statisticsQuery || "").trim().toLocaleLowerCase("vi-VN");
    if (query && statisticsMode === "customer" && !String(row.customer || "").toLocaleLowerCase("vi-VN").includes(query)) return false;
    if (query && statisticsMode === "plate" && !normalizePlate(row.plate).toLocaleLowerCase("vi-VN").includes(query)) return false;
    const charge = Math.round(Number(row.charge ?? row.weigher) || 0);
    const paid = Math.max(0, Number(row.paid ?? row.driver) || 0);
    if (statisticsPaymentFilter === "debt" && charge <= paid) return false;
    if (statisticsPaymentFilter === "paid" && (charge <= 0 || paid < charge)) return false;
    return true;
  });
  const statisticsTotals = statisticsFilteredRows.reduce((total, row) => {
    const charge = Math.round(Number(row.charge ?? row.weigher) || 0);
    const paid = Math.max(0, Number(row.paid ?? row.driver) || 0);
    total.charge += charge;
    total.paid += paid;
    total.debt += Math.max(0, charge - paid);
    return total;
  }, { charge: 0, paid: 0, debt: 0 });

  const exportStatisticsExcel = () => {
    const tableRows = statisticsFilteredRows.map((row) => {
      const charge = Math.round(Number(row.charge ?? row.weigher) || 0);
      const paid = Math.max(0, Number(row.paid ?? row.driver) || 0);
      return `<tr><td>${escapeSpreadsheetCell(row.id)}</td><td>${escapeSpreadsheetCell(row.customer)}</td><td>${escapeSpreadsheetCell(row.plate)}</td><td>${row.gross}</td><td>${row.tare}</td><td>${charge}</td><td>${paid >= charge && charge > 0 ? "Đã thanh toán" : `Còn nợ ${Math.max(0, charge - paid)}`}</td></tr>`;
    }).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><table border="1"><thead><tr><th>Số phiếu</th><th>Khách hàng</th><th>Biển số</th><th>Tổng</th><th>Bì</th><th>Số tiền</th><th>Trạng thái thanh toán</th></tr></thead><tbody>${tableRows}<tr><th colspan="5">Tổng tiền cân</th><th>${statisticsTotals.charge}</th><th>Còn nợ ${statisticsTotals.debt}</th></tr></tbody></table></body></html>`;
    const url = window.URL.createObjectURL(new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `thong-ke-can-xe-${new Date().toISOString().slice(0, 10)}.xls`;
    link.click();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  };

  return (
    <main className={`scale-page mobile-screen-${mobileScreen}`}>
      <header className="scale-mobile-header">
        <button type="button" aria-label="Quay lại đơn hàng" onClick={returnToOrders}>←</button>
        <div>
          <strong>center</strong>
          <span>{now.toLocaleDateString("vi-VN")} • {now.toLocaleTimeString("vi-VN")}</span>
          <small className="scale-mobile-version">Cân Online Sơn Phú — v{SCALE_VERSION}</small>
        </div>
        <div className="scale-mobile-head-status">
          <small className={`scale-connection-status ${connectionClass}`}>{connectionLabel}</small>
        </div>
      </header>
      <div className="scale-mobile-sticky-zone">
        <section className="scale-display-row">
          <div
            className={`scale-led-panel${weightLocked ? " is-locked" : ""}${scaleOpen && (weightLocked || liveWeight > 0) ? " can-lock" : ""}`}
            aria-label={`Khối lượng ${displayWeight} kilogram${scaleOpen && (weightLocked || liveWeight > 0) ? (weightLocked ? ". Bấm để mở khóa số" : ". Bấm để khóa số") : ""}`}
            role="button"
            tabIndex={scaleOpen && (weightLocked || liveWeight > 0) ? 0 : -1}
            title={scaleOpen && (weightLocked || liveWeight > 0) ? (weightLocked ? "Bấm lại để mở khóa số cân" : "Bấm vào màn hình để khóa số cân") : ""}
            onClick={toggleWeightLock}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") toggleWeightLock();
            }}
          >
            <span className="scale-stability">✦</span>
            <SevenSegmentDisplay value={padWeight(displayWeight)} locked={weightLocked} />
          </div>
          <div className={`scale-unit${weightLocked ? " is-locked" : ""}`}>Kg</div>
          <div className="scale-clock">
            <strong>Thời Gian</strong>
            <small className="scale-version-label">Cân Online Sơn Phú — v{SCALE_VERSION}</small>
            <span>{now.toLocaleDateString("vi-VN")}</span>
            <span>{now.toLocaleTimeString("vi-VN")}</span>
            <button type="button" onClick={returnToOrders}>← Đơn hàng</button>
          </div>
        </section>

        <div className="scale-mobile-lock-bar">
          <span>{weightLocked ? "Đã khóa để chốt" : "Số đang chạy"}</span>
          <span className="scale-mobile-lock-actions">
            <button type="button" className={weightLocked ? "is-locked" : ""} disabled={!scaleOpen || snapshotLoading || (!phoneScalePage && (!lanConnected || !headConnected || (!weightLocked && liveWeight <= 0)))} onClick={toggleWeightLock}>{snapshotLoading ? (weightLocked ? "Đang đồng bộ..." : "Đang lấy số cân...") : (weightLocked ? "Mở khóa" : "Khóa số")}</button>
          </span>
          {phoneScalePage && serialMessage && <small className="scale-phone-action-status" aria-live="polite">{serialMessage}</small>}
        </div>

        <div className="scale-mobile-quick-actions">
          <button type="button" onClick={startNewWeighing}>Cân mới</button>
          <button type="button" disabled={saving || additionalWeighingActive || !selectedId} onClick={startAdditionalWeighing}>Cân thêm</button>
          <button type="button" disabled={saving || !selectedId} onClick={() => openEditDialog(selected)}>Sửa phiếu</button>
          <button type="button" disabled={saving} onClick={printFromCurrentDevice}>XEM PHIẾU</button>
          {printStatus && <small className="scale-print-status" aria-live="polite">{printStatus}</small>}
        </div>
      </div>

      <section className="scale-control-panel">
        <div className="scale-fields">
          <div className="scale-desktop-fields">
            <HistoryField
              label="Khách hàng"
              value={form.customer}
              disabled={detailsLocked}
              suggestions={filteredCustomerSuggestions}
              open={suggestionField === "customer"}
              onFocus={() => focusSuggestion("customer")}
              onBlur={closeSuggestionsSoon}
              onChange={(value) => changeSuggestion("customer", value)}
              onSelect={(value) => chooseSuggestion("customer", value)}
              onSearch={() => searchHistoryByField("customer")}
            />
            <PlateField
              plate={form.plate}
              note={form.plateNote}
              disabled={detailsLocked}
              suggestions={filteredPlateSuggestions}
              open={suggestionField === "plate"}
              onFocus={() => focusSuggestion("plate")}
              onBlur={closeSuggestionsSoon}
              onPlateChange={(value) => changeSuggestion("plate", value)}
              onPlateBlur={() => setForm((current) => ({ ...current, plate: normalizePlate(current.plate) }))}
              onNoteChange={(value) => updateField("plateNote", value)}
              onSelect={(value) => chooseSuggestion("plate", value)}
              onSearch={() => searchHistoryByField("plate")}
            />
            <Field
              label="Xuất/Nhập"
              value={form.direction}
              disabled={detailsLocked}
              options={["", "Cân Dịch Vụ", "Nhập Hàng", "Xuất Hàng"]}
              onChange={changeDirection}
            />
            <Field label="Loại hàng" value={form.goods} disabled={detailsLocked} onChange={(value) => updateField("goods", value)} />
            {currentBlacklistEntry && <div className="scale-blacklist-warning">⚠ {currentBlacklistEntry.plate}: {currentBlacklistEntry.reason}</div>}
            <div className={`scale-money-row${noExtraCharge || selectedCancelled ? " is-disabled" : ""}`}>
              <label>Tiền cân</label>
              <div className="scale-money-controls">
                <span className="scale-money-input-wrap">
                  <input type="number" step="10000" inputMode="numeric" placeholder="Nhập đúng số tiền (có thể âm)" value={visibleChargeInput} disabled={noExtraCharge || selectedCancelled} onFocus={() => setChargeManuallyEdited(true)} onChange={(event) => changeCharge(event.target.value)} onBlur={() => void persistCurrentWeighing({ charge: totalCharge, paid: paidAmount })} />
                  <span>đ</span>
                </span>
                <button type="button" className="scale-price-button" disabled={noExtraCharge || selectedCancelled || fallbackPricingWeight <= 0 || saving} onClick={() => void applySellingPrice()}>Áp giá bán</button>
                <label className="scale-money-check"><input type="checkbox" disabled={selectedCancelled} checked={noExtraCharge} onChange={(event) => toggleNoCharge(event.target.checked)} /> Không thu tiền</label>
                <strong>Tổng: {numberText(visibleTotalCharge)}đ</strong>
              </div>
            </div>
            <div className={`scale-money-row${noExtraCharge || selectedCancelled ? " is-disabled" : ""}`}>
              <label>Thanh toán</label>
              <div className="scale-money-controls">
                <label className="scale-money-check"><input type="checkbox" disabled={noExtraCharge || selectedCancelled} checked={paidChecked} onChange={(event) => {
                  const checked = event.target.checked;
                  setPaidChecked(checked);
                  const paid = checked ? visibleTotalCharge : 0;
                  setPaidInput(checked ? String(paid) : "");
                  void persistCurrentWeighing({ charge: visibleTotalCharge, paid });
                }} /> Đã thanh toán</label>
                <span className="scale-money-input-wrap">
                  <input type="number" min="0" step="10000" inputMode="numeric" placeholder="Đã thu" value={paidInput} disabled={noExtraCharge || selectedCancelled} onChange={(event) => changePaid(event.target.value)} onBlur={() => void persistCurrentWeighing({ charge: visibleTotalCharge, paid: paidAmount })} />
                  <span>đ</span>
                </span>
                <strong className={debtAmount > 0 ? "has-debt" : ""}>Nợ: {numberText(debtAmount)}đ</strong>
              </div>
            </div>
            <div className="scale-debt-summary">
              <span>Nợ cũ xe: <strong>{numberText(oldPlateDebtAmount)}đ</strong></span>
              <span>Nợ lượt này: <strong>{numberText(debtAmount)}đ</strong></span>
              <strong className={totalPlateDebtAmount > 0 ? "has-debt" : ""}>Tổng nợ xe: {numberText(totalPlateDebtAmount)}đ</strong>
            </div>
            {moneyMessage && <div className="scale-money-warning">{moneyMessage}</div>}
          </div>

          <section className="scale-mobile-card scale-mobile-vehicle-card">
            <div className="scale-mobile-card-heading"><span>Thông tin xe</span><span>{selectedId ? `Phiếu #${selected.id}` : "Phiếu mới"}</span></div>
            <label className="scale-mobile-form-control"><span>Khách hàng</span><span className="scale-mobile-input-action"><HistorySuggestInput value={form.customer} disabled={detailsLocked} suggestions={filteredCustomerSuggestions} open={suggestionField === "customer"} onFocus={() => focusSuggestion("customer")} onBlur={closeSuggestionsSoon} onChange={(value) => changeSuggestion("customer", value)} onSelect={(value) => chooseSuggestion("customer", value)} /><button type="button" disabled={detailsLocked} onClick={() => searchHistoryByField("customer")}>Tìm</button></span></label>
            <label className="scale-mobile-form-control scale-mobile-plate-control"><span>Biển số xe</span><span className="scale-mobile-input-action"><HistorySuggestInput value={form.plate} disabled={detailsLocked} suggestions={filteredPlateSuggestions} open={suggestionField === "plate"} onFocus={() => focusSuggestion("plate")} onBlur={closeSuggestionsSoon} onChange={(value) => changeSuggestion("plate", value)} onSelect={(value) => chooseSuggestion("plate", value)} onInputBlur={() => setForm((current) => ({ ...current, plate: normalizePlate(current.plate) }))} /><button type="button" disabled={detailsLocked} onClick={() => searchHistoryByField("plate")}>Tìm</button></span></label>
            <label className="scale-mobile-form-control scale-mobile-note-control"><span>Rơ-moóc / ghi chú</span><input value={form.plateNote} disabled={detailsLocked} placeholder="Nhập nếu có" onChange={(event) => updateField("plateNote", event.target.value)} /></label>
            <label className="scale-mobile-form-control"><span>Xuất/Nhập</span><select value={form.direction} disabled={detailsLocked} onChange={(event) => changeDirection(event.target.value)}>{["", "Cân Dịch Vụ", "Nhập Hàng", "Xuất Hàng"].map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
            <label className="scale-mobile-form-control"><span>Loại hàng</span><input value={form.goods} disabled={detailsLocked} onChange={(event) => updateField("goods", event.target.value)} /></label>
            {currentBlacklistEntry && <div className="scale-blacklist-warning">⚠ Xe này nằm trong danh sách đen: {currentBlacklistEntry.reason}</div>}
            <label className="scale-mobile-blacklist-toggle"><input type="checkbox" checked={Boolean(currentBlacklistEntry)} onChange={(event) => changeBlacklistState(event.target.checked)} /> Danh sách đen</label>
            <button type="button" className="scale-mobile-blacklist-list-button" onClick={() => setBlacklistListOpen(true)}>Xem danh sách đen ({blacklist.length})</button>
          </section>

          <section className={`scale-mobile-card scale-mobile-money-card${noExtraCharge || selectedCancelled ? " is-disabled" : ""}`}>
            <div className="scale-mobile-card-heading"><span>Tiền cân &amp; thanh toán</span></div>
            <label className="scale-mobile-money-control"><span>Tiền cân</span><span className="scale-mobile-money-line"><span className="scale-money-input-wrap"><input type="number" step="10000" inputMode="numeric" placeholder="Nhập đúng số tiền (có thể âm)" value={visibleChargeInput} disabled={noExtraCharge || selectedCancelled} onFocus={() => setChargeManuallyEdited(true)} onChange={(event) => changeCharge(event.target.value)} onBlur={() => void persistCurrentWeighing({ charge: totalCharge, paid: paidAmount })} /><span>đ</span></span><button type="button" className="scale-price-button" disabled={noExtraCharge || selectedCancelled || fallbackPricingWeight <= 0 || saving} onClick={() => void applySellingPrice()}>Áp giá bán</button><span className="scale-money-check"><input type="checkbox" disabled={selectedCancelled} checked={noExtraCharge} onChange={(event) => toggleNoCharge(event.target.checked)} /> Không thu tiền</span></span></label>
            <label className="scale-mobile-money-control"><span>Đã thu</span><span className="scale-mobile-money-line"><span className="scale-money-input-wrap"><input type="number" min="0" step="10000" inputMode="numeric" placeholder="0" value={paidInput} disabled={noExtraCharge || selectedCancelled} onChange={(event) => changePaid(event.target.value)} onBlur={() => void persistCurrentWeighing({ charge: visibleTotalCharge, paid: paidAmount })} /><span>đ</span></span><span className="scale-money-check"><input type="checkbox" disabled={noExtraCharge || selectedCancelled} checked={paidChecked} onChange={(event) => {
              const checked = event.target.checked;
              setPaidChecked(checked);
              const paid = checked ? visibleTotalCharge : 0;
              setPaidInput(checked ? String(paid) : "");
              void persistCurrentWeighing({ charge: visibleTotalCharge, paid });
            }} /> Đã thanh toán</span></span></label>
            <div className="scale-mobile-money-summary"><strong>Tổng: {numberText(visibleTotalCharge)}đ</strong><strong className={debtAmount > 0 ? "has-debt" : ""}>Nợ lượt này: {numberText(debtAmount)}đ</strong></div>
            <div className="scale-debt-summary"><span>Nợ cũ xe: <strong>{numberText(oldPlateDebtAmount)}đ</strong></span><strong className={totalPlateDebtAmount > 0 ? "has-debt" : ""}>Tổng nợ xe: {numberText(totalPlateDebtAmount)}đ</strong></div>
            {moneyMessage && <div className="scale-money-warning">{moneyMessage}</div>}
          </section>
        </div>

        <div className="scale-weight-box">
          <WeightRow label="Khối lượng tổng" value={captured.gross} action="Cân tổng" captured={captureLocked.gross} busy={saving} onAction={() => captureWeight("gross")} />
          <WeightRow label="Khối lượng bì" value={captured.tare} action="Cân bì" captured={captureLocked.tare} busy={saving} onAction={() => captureWeight("tare")} />
          <WeightRow
            label="Khối lượng hàng"
            value={captured.gross - captured.tare}
            labelExtra={<button type="button" className="scale-price-button" onClick={() => setPriceTableOpen(true)}>Bảng giá</button>}
          />
          <div className="scale-weight-actions">
            <button type="button" onClick={startNewWeighing}>Lần cân mới</button>
            <button type="button" disabled={saving || additionalWeighingActive || !selectedId} onClick={startAdditionalWeighing}>
              Cân thêm
            </button>
            {phoneScalePage && <button type="button" disabled={saving || !selectedId} onClick={() => openEditDialog(selected)}>Sửa phiếu</button>}
            <button type="button" onClick={() => void openStatistics()}>Thống kê</button>
          </div>
          <div className="scale-serial-settings">
            <label>Baud Rate <select defaultValue="9600"><option>9600</option><option>19200</option></select></label>
            <label>Data Bits <select defaultValue="8"><option>8</option><option>7</option></select></label>
            <label>Stop Bits <select defaultValue="Two"><option>One</option><option>Two</option></select></label>
          </div>
        </div>

        <div className="scale-side-actions">
          {!phoneScalePage && <button type="button" className={scaleOpen ? "is-open" : ""} onClick={toggleScale}>
            {scaleOpen ? "Tắt cân" : "Mở cân"}
          </button>}
          <button type="button" disabled={saving} onClick={printFromCurrentDevice}>XEM PHIẾU</button>
    {!phoneScalePage && <button type="button" disabled={saving || printing || directPrintPending} title="In thẳng tại máy tính đang thao tác" onClick={printDirectFromCurrentDevice}>In phiếu</button>}
          <button type="button" className="scale-blacklist-button" onClick={() => changeBlacklistState(!currentBlacklistEntry)}>{currentBlacklistEntry ? "Bỏ DS đen" : "DS đen"}</button>
          <button type="button" className="scale-blacklist-list-button" onClick={() => setBlacklistListOpen(true)}>Danh sách đen ({blacklist.length})</button>
          {printStatus && <small className="scale-print-status" aria-live="polite">{printStatus}</small>}
        </div>
      </section>

      <datalist id="scale-customer-suggestions">{customerSuggestions.map((value) => <option key={value} value={value} />)}</datalist>
      <datalist id="scale-plate-suggestions">{plateSuggestions.map((value) => <option key={value} value={value} />)}</datalist>

      <section className="scale-history-panel">
        <aside className="scale-filter-panel">
          <button type="button" className="scale-mobile-statistics-button" onClick={() => void openStatistics()}>Thống kê</button>
          {historyQueryType && <div className="scale-history-active-filter"><span>Lọc {historyQueryType === "customer" ? "khách hàng" : "biển số"}: <strong>{historyQuery || "Tất cả"}</strong></span><button type="button" onClick={clearHistorySearch}>Bỏ lọc</button></div>}
          <label><input type="radio" name="scale-filter" checked={filter === "pending"} onChange={() => setFilter("pending")} /> Chưa cân</label>
          <label><input type="radio" name="scale-filter" checked={filter === "done"} onChange={() => setFilter("done")} /> Đã cân</label>
          <label><input type="radio" name="scale-filter" checked={filter === "all"} onChange={() => setFilter("all")} /> Tất cả</label>
          <label className="scale-date-filter">Thời gian
            <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
              <option value="last30">30 ngày gần đây</option>
              <option value="all">Hiện tất cả</option>
              <option value="today">Hôm nay</option>
              <option value="yesterday">Hôm qua</option>
              <option value="2days">2 ngày trước</option>
              <option value="3days">3 ngày trước</option>
              <option value="7days">7 ngày gần đây</option>
              <option value="month">Tháng này</option>
              <option value="year">Năm này</option>
              <option value="custom">Tùy chọn</option>
            </select>
          </label>
          {dateFilter === "custom" && (
            <div className="scale-custom-dates">
              <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
              <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
            </div>
          )}
          <div className="scale-port">
            <span>Cổng COM</span>
            <select defaultValue="COM1"><option>COM1</option><option>COM2</option><option>COM3</option></select>
          </div>
        </aside>

        <div className="scale-table-wrap">
          <table className="scale-table">
            <colgroup>
              {HISTORY_COLUMNS.map((column, index) => <col key={column.key} style={{ width: `${historyColumnWidths[index]}%` }} />)}
            </colgroup>
            <thead>
              <tr>
                {HISTORY_COLUMNS.map((column, index) => (
                  <th key={column.key}>
                    {column.label}
                    {index < HISTORY_COLUMNS.length - 1 && (
                      <span
                        className="scale-column-resizer"
                        role="separator"
                        aria-label={`Đổi độ rộng cột ${column.label}`}
                        onPointerDown={(event) => startHistoryColumnResize(index, event)}
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={rowIdentity(row)} className={`${rowIdentity(row) === String(selectedId || "") ? "selected " : ""}${row.cancelled ? "is-cancelled" : ""}`} onClick={() => selectRow(row)}>
                  <td><button type="button" className="scale-cancel-row" onClick={(event) => { event.stopPropagation(); void toggleCancelled(row); }}>Hủy</button></td>
                  <td>{row.plate}{row.plateNote ? <small>{row.plateNote}</small> : null}</td><td>{row.customer}</td><td>{numberText(row.gross)}</td><td>{numberText(row.tare)}</td><td>{numberText(row.net)}</td>
                  <td>{formatPrintDate(row.grossAt)}</td><td>{formatPrintDate(row.tareAt)}</td><td>{row.direction}</td><td>{row.goods}</td>
                  <td>{numberText(row.charge ?? row.weigher)}đ</td>
                  <td className="scale-paid-cell">
                    <input
                      type="checkbox"
                      aria-label={`Đã thanh toán ${row.plate || row.id}`}
                      title="Tích để đánh dấu đã thanh toán đủ"
                      checked={Number(row.charge ?? row.weigher) > 0 && Number(row.paid ?? row.driver) >= Number(row.charge ?? row.weigher)}
                      disabled={saving || row.cancelled || Number(row.charge ?? row.weigher) <= 0}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => void toggleRowPaid(row, event.target.checked)}
                    />
                  </td>
                  <td>{numberText(Math.max(0, Number(row.charge ?? row.weigher) - Number(row.paid ?? row.driver)))}đ</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="scale-mobile-history-list">
          {visibleRows.map((row) => (
            <article key={rowIdentity(row)} className={`scale-mobile-history-row${row.cancelled ? " is-cancelled" : ""}`}>
              <button type="button" className="scale-mobile-history-open" onClick={() => selectRow(row)}>
                <span className="scale-mobile-history-head"><strong>{row.plate || "Chưa có biển số"}</strong><small>{formatPrintDate(row.updatedAt || row.createdAt)}</small></span>
                <span className="scale-mobile-history-code">Mã cân #{row.id}</span>
                <span className="scale-mobile-history-code">Người cân: {row.operatorName || "Không rõ"}</span>
                <span>{row.customer || "Vãng Lai"} • {row.direction || "Cân Dịch Vụ"} • {row.goods || "Hàng hóa"}</span>
                <span className="scale-mobile-history-times"><span>Giờ cân tổng <strong>{formatPrintDate(row.grossAt) || "—"}</strong></span><span>Giờ cân bì <strong>{formatPrintDate(row.tareAt) || "—"}</strong></span></span>
                <span className="scale-mobile-history-weights"><span>Tổng <strong>{numberText(row.gross)} kg</strong></span><span>Bì <strong>{numberText(row.tare)} kg</strong></span><span>Hàng <strong>{numberText(row.net)} kg</strong></span></span>
                <span className="scale-mobile-history-money"><span><small>Tiền cân</small><strong>{numberText(row.charge ?? row.weigher)}đ</strong></span><span><small>Đã thu {numberText(row.paid ?? row.driver)}đ</small><strong className={Math.max(0, Number(row.charge ?? row.weigher) - Number(row.paid ?? row.driver)) > 0 ? "has-debt" : ""}>{Math.max(0, Number(row.charge ?? row.weigher) - Number(row.paid ?? row.driver)) > 0 ? `Còn nợ ${numberText(Math.max(0, Number(row.charge ?? row.weigher) - Number(row.paid ?? row.driver)))}đ` : "Đã thanh toán ✓"}</strong></span></span>
              </button>
              <button type="button" className="scale-mobile-cancel-row" onClick={() => void toggleCancelled(row)}>Hủy</button>
            </article>
          ))}
          {!visibleRows.length && <div className="scale-mobile-history-empty">Không có lượt cân phù hợp.</div>}
        </div>
      </section>

      <footer className="scale-footer">
        <span>PHẦN MỀM CÂN XE • Thép Sơn Phú</span>
        <small className={`scale-footer-connection ${connectionClass}`}>
          <span className="scale-connection-badge">{connectionSource === "lan" ? "LAN" : connectionSource === "supabase" ? "SUPABASE" : connectionSource === "online" ? "ONLINE" : "OFFLINE"}</span>
          <span>{connectionLabel}{connectionSource === "lan" && headConnected ? ` • ${serialMessage}` : ""}</span>
        </small>
      </footer>

      <nav className="scale-mobile-nav" aria-label="Điều hướng màn cân">
        <button type="button" className={mobileScreen === "weighing" ? "is-active" : ""} onClick={() => setMobileScreen("weighing")}>Cân xe</button>
        <button type="button" className={mobileScreen === "history" ? "is-active" : ""} onClick={() => setMobileScreen("history")}>Lịch sử</button>
      </nav>

      {(printPreviewOpen || directPrintPending) && (
        <div
          className="scale-print-preview"
          style={directPrintPending ? { position: "fixed", left: "-100000px", top: 0, pointerEvents: "none" } : undefined}
          role={directPrintPending ? undefined : "dialog"}
          aria-hidden={directPrintPending ? "true" : undefined}
          aria-modal={directPrintPending ? undefined : "true"}
          aria-label={directPrintPending ? undefined : "Xem trước phiếu cân"}
        >
          <div className="scale-print-pages">
            <ScalePrintTicket
              preview
              ticketNumber={printTicketNumber}
              form={printPayload?.form || form}
              captured={printPayload?.captured || captured}
              billing={printPayload?.billing || { charge: visibleTotalCharge, paid: paidAmount, debt: debtAmount }}
              printedAt={now}
            />
            <div className="scale-print-extra-copies" aria-hidden="true">
              {Array.from({ length: Math.max(0, printCopies - 1) }, (_, index) => (
                <ScalePrintTicket
                  key={index}
                  ticketNumber={printTicketNumber}
                  form={printPayload?.form || form}
                  captured={printPayload?.captured || captured}
                  billing={printPayload?.billing || { charge: visibleTotalCharge, paid: paidAmount, debt: debtAmount }}
                  printedAt={now}
                />
              ))}
            </div>
          </div>
          {!directPrintPending && <div className="scale-print-preview-actions">
            <label>
              Số bản in
              <input
                type="number"
                min="1"
                max="10"
                value={printCopies}
                onChange={(event) => setPrintCopies(Math.min(10, Math.max(1, Number(event.target.value) || 1)))}
              />
            </label>
            <button type="button" className="print-now" disabled={printing} onClick={(phoneScalePage || printAtMachineTarget) ? printAtScaleMachine : printTicket}>{printing ? "Đang in..." : ((phoneScalePage || printAtMachineTarget) ? "🖨 In ngay tại máy cân" : "🖨 In")}</button>
            <button type="button" onClick={() => setPrintPreviewOpen(false)}>Đóng (Esc)</button>
            {printStatus && <small className="scale-print-status" aria-live="polite">{printStatus}</small>}
          </div>}
        </div>
      )}
      {blacklistDialog && (
        <div className="scale-price-overlay" role="dialog" aria-modal="true" aria-label="Lý do danh sách đen">
          <div className="scale-blacklist-dialog">
            <h3>DANH SÁCH ĐEN: {blacklistDialog.plate}</h3>
            <label>Lý do cảnh báo
              <textarea autoFocus rows="4" placeholder="Ví dụ: Không thanh toán tiền" value={blacklistDialog.reason} onChange={(event) => setBlacklistDialog((current) => ({ ...current, reason: event.target.value }))} />
            </label>
            <div><button type="button" onClick={() => setBlacklistDialog(null)}>Bỏ qua</button><button type="button" className="save" disabled={!String(blacklistDialog.reason || "").trim()} onClick={saveBlacklistEntry}>Lưu cảnh báo</button></div>
          </div>
        </div>
      )}
      {blacklistListOpen && (
        <div className="scale-price-overlay" role="dialog" aria-modal="true" aria-label="Danh sách đen">
          <div className="scale-blacklist-dialog scale-blacklist-list-dialog">
            <div className="scale-dialog-heading"><h3>DANH SÁCH ĐEN</h3><button type="button" onClick={() => setBlacklistListOpen(false)}>Đóng</button></div>
            {!blacklist.length && <p className="scale-blacklist-empty">Chưa có xe nào trong danh sách đen.</p>}
            <div className="scale-blacklist-list">
              {blacklist.map((entry) => (
                <div className="scale-blacklist-list-item" key={normalizePlate(entry.plate)}>
                  <div><strong>{normalizePlate(entry.plate)}</strong><span>{entry.reason || "Không có lý do"}</span></div>
                  <button type="button" onClick={() => removeBlacklistEntry(entry)}>Bỏ</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {editDialog && (
        <div className="scale-price-overlay" role="dialog" aria-modal="true" aria-label="Sửa phiếu cân">
          <form className="scale-edit-dialog" onSubmit={(event) => { event.preventDefault(); saveEditedRow(); }}>
            <div className="scale-dialog-heading"><h3>SỬA PHIẾU CÂN #{editDialog.row.id || ""}</h3><button type="button" onClick={() => setEditDialog(null)}>Đóng</button></div>
            <p className="scale-edit-hint">Số lớn hơn sẽ tự vào Tổng, số nhỏ hơn vào Bì.</p>
            <div className="scale-edit-grid">
              <label>Biển số<input value={editDialog.plate} onChange={(event) => setEditDialog((current) => ({ ...current, plate: event.target.value }))} /></label>
              <label>Khách hàng<input value={editDialog.customer} onChange={(event) => setEditDialog((current) => ({ ...current, customer: event.target.value }))} /></label>
              <label>Rơ-moóc / ghi chú<input value={editDialog.plateNote} onChange={(event) => setEditDialog((current) => ({ ...current, plateNote: event.target.value }))} /></label>
              <label>Xuất/Nhập<select value={editDialog.direction} onChange={(event) => setEditDialog((current) => ({ ...current, direction: event.target.value }))}>{["", "Cân Dịch Vụ", "Nhập Hàng", "Xuất Hàng"].map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
              <label>Loại hàng<input value={editDialog.goods} onChange={(event) => setEditDialog((current) => ({ ...current, goods: event.target.value }))} /></label>
              <label>Khối lượng Tổng (kg)<input type="number" min="0" step="1" value={editDialog.gross} onChange={(event) => setEditDialog((current) => ({ ...current, gross: event.target.value }))} /></label>
              <label>Khối lượng Bì (kg)<input type="number" min="0" step="1" value={editDialog.tare} onChange={(event) => setEditDialog((current) => ({ ...current, tare: event.target.value }))} /></label>
              <label>Ngày giờ Tổng<input type="datetime-local" value={editDialog.grossAt} onChange={(event) => setEditDialog((current) => ({ ...current, grossAt: event.target.value }))} /></label>
              <label>Ngày giờ Bì<input type="datetime-local" value={editDialog.tareAt} onChange={(event) => setEditDialog((current) => ({ ...current, tareAt: event.target.value }))} /></label>
              <label>Tiền cân<input type="number" step="1000" value={editDialog.charge} onChange={(event) => setEditDialog((current) => ({ ...current, charge: event.target.value }))} /></label>
              <label>Đã thu<input type="number" min="0" step="1000" value={editDialog.paid} onChange={(event) => setEditDialog((current) => ({ ...current, paid: event.target.value }))} /></label>
            </div>
            <div className="scale-price-actions"><button type="button" onClick={() => setEditDialog(null)}>Bỏ qua</button><button type="submit" className="save" disabled={saving}>Lưu thay đổi</button></div>
          </form>
        </div>
      )}
      {paymentDialog && (
        <div className="scale-price-overlay" role="dialog" aria-modal="true" aria-label="Xác nhận thanh toán">
          <div className="scale-payment-dialog">
            <h3>XÁC NHẬN THANH TOÁN</h3>
            <p>Xe <strong>{paymentDialog.row.plate || "chưa có biển số"}</strong> — lượt cân <strong>#{paymentDialog.captureNumber}</strong>.</p>
            <div className="scale-payment-detail"><span>Khối lượng dùng tính giá</span><strong>{numberText(paymentDialog.pricingWeight)} kg</strong></div>
            <div className={`scale-payment-detail${paymentDialog.oldPlateDebt > 0 ? " has-debt" : ""}`}><span>Nợ cũ xe này từ trước</span><strong>{paymentDialog.oldPlateDebt > 0 ? `${numberText(paymentDialog.oldPlateDebt)}đ` : "0đ"}</strong></div>
            {paymentDialog.row.paid > 0 && <div className="scale-payment-detail"><span>Đã thu từ trước</span><strong>{numberText(paymentDialog.row.paid)}đ</strong></div>}
            {paymentDialog.previousRows?.length > 0 && <div className="scale-payment-history"><strong>Các lượt trước trong xe này</strong>{paymentDialog.previousRows.map((row, index) => { const charge = Number(row.charge ?? row.weigher) || 0; const paid = Number(row.paid ?? row.driver) || 0; const balance = charge - paid; return <div key={rowIdentity(row) || index}><span>Lượt {index + 1}: {numberText(charge)}đ • Đã thu {numberText(paid)}đ</span><b className={balance > 0 ? "has-debt" : balance < 0 ? "has-surplus" : ""}>{balance > 0 ? `Nợ ${numberText(balance)}đ` : balance < 0 ? `Thừa ${numberText(Math.abs(balance))}đ` : "Đủ"}</b></div>; })}</div>}
            <label>Tiền cân (có thể sửa)
              <span className="scale-dialog-money-input"><span className="scale-dialog-money-input-field"><input autoFocus type="number" step="10000" value={paymentDialog.charge} onChange={(event) => setPaymentDialog((current) => ({ ...current, charge: event.target.value, paid: current.paidChecked ? event.target.value : current.paid }))} /><b>đ</b></span><button type="button" className="scale-price-button" disabled={saving || paymentDialog.pricingWeight <= 0} onClick={() => void applySellingPrice("dialog")}>Áp giá bán</button></span>
            </label>
            <label>Đã thu
              <span className="scale-dialog-money-input"><input type="number" min="0" step="10000" value={paymentDialog.paid} disabled={paymentDialog.paidChecked} onChange={(event) => setPaymentDialog((current) => ({ ...current, paid: event.target.value }))} /><b>đ</b></span>
            </label>
            <label className="scale-payment-check"><input type="checkbox" checked={paymentDialog.paidChecked} onChange={(event) => setPaymentDialog((current) => ({ ...current, paidChecked: event.target.checked, paid: event.target.checked ? current.charge : "" }))} /> Đã thanh toán đủ</label>
            {(() => {
              const balance = Math.round(Number(paymentDialog.charge) || 0) - Math.round(Number(paymentDialog.paid) || 0);
              const totalDebt = Math.max(0, Number(paymentDialog.oldPlateDebt) || 0) + Math.max(0, balance);
              return <div className={`scale-payment-balance${balance > 0 ? " has-debt" : balance < 0 ? " has-surplus" : ""}`}>
                <span>{balance > 0 ? `Nợ lượt này: ${numberText(balance)}đ` : balance < 0 ? `Đã thu thừa: ${numberText(Math.abs(balance))}đ` : "Nợ lượt này: 0đ"}</span>
                <strong className={totalDebt > 0 ? "has-debt" : ""}>Tổng nợ xe: {numberText(totalDebt)}đ</strong>
              </div>;
            })()}
            <div><button type="button" onClick={() => setPaymentDialog(null)}>Để sau</button><button type="button" className="save" disabled={saving} onClick={() => void savePaymentDialog()}>Lưu thanh toán</button></div>
          </div>
        </div>
      )}
      {statisticsOpen && (
        <div className="scale-price-overlay" role="dialog" aria-modal="true" aria-label="Thống kê cân xe">
          <div className="scale-statistics-dialog">
            <div className="scale-statistics-head">
              <h3>THỐNG KÊ CÂN XE</h3>
              <button type="button" onClick={() => setStatisticsOpen(false)}>Đóng</button>
            </div>
            <div className="scale-statistics-tabs">
              <button type="button" className={statisticsMode === "overall" ? "active" : ""} onClick={() => { setStatisticsMode("overall"); setStatisticsQuery(""); }}>Tổng thể</button>
              <button type="button" className={statisticsMode === "customer" ? "active" : ""} onClick={() => { setStatisticsMode("customer"); setStatisticsQuery(""); }}>Theo khách</button>
              <button type="button" className={statisticsMode === "plate" ? "active" : ""} onClick={() => { setStatisticsMode("plate"); setStatisticsQuery(""); }}>Theo biển số xe</button>
            </div>
            <div className="scale-statistics-filters">
              <label>{statisticsMode === "customer" ? "Tìm khách hàng" : statisticsMode === "plate" ? "Tìm biển số xe" : "Phạm vi"}
                {statisticsMode === "overall" ? <span>Tất cả mã cân phù hợp</span> : <input list={statisticsMode === "customer" ? "scale-customer-suggestions" : "scale-plate-suggestions"} value={statisticsQuery} placeholder={statisticsMode === "customer" ? "Nhập hoặc chọn khách" : "Nhập hoặc chọn biển số"} onChange={(event) => setStatisticsQuery(event.target.value)} />}
              </label>
              <label>Thời gian
                <select value={statisticsDateFilter} onChange={(event) => setStatisticsDateFilter(event.target.value)}>
                  <option value="today">Hôm nay</option><option value="yesterday">Hôm qua</option><option value="3days">3 ngày</option><option value="5days">5 ngày</option><option value="7days">7 ngày</option><option value="month">Tháng này</option><option value="year">Năm nay</option><option value="custom">Tùy chọn</option>
                </select>
              </label>
              <label>Thanh toán
                <select value={statisticsPaymentFilter} onChange={(event) => setStatisticsPaymentFilter(event.target.value)}><option value="all">Tất cả</option><option value="debt">Xe đang nợ</option><option value="paid">Đã thanh toán</option></select>
              </label>
              {statisticsDateFilter === "custom" && <span className="scale-statistics-custom-dates"><input type="date" value={statisticsCustomFrom} onChange={(event) => setStatisticsCustomFrom(event.target.value)} /><input type="date" value={statisticsCustomTo} onChange={(event) => setStatisticsCustomTo(event.target.value)} /></span>}
              <button type="button" className="scale-export-excel" onClick={exportStatisticsExcel}>Xuất Excel</button>
            </div>
            <div className="scale-statistics-table-wrap">
              {statisticsLoading && <div className="scale-statistics-loading">Đang tải toàn bộ dữ liệu cân…</div>}
              <table className="scale-statistics-table">
                <thead><tr><th>Số phiếu</th><th>Khách hàng</th><th>Biển số</th><th>Tổng</th><th>Bì</th><th>Số tiền</th><th>Trạng thái thanh toán</th></tr></thead>
                <tbody>
                  {statisticsFilteredRows.map((row) => {
                    const charge = Math.round(Number(row.charge ?? row.weigher) || 0);
                    const paid = Math.max(0, Number(row.paid ?? row.driver) || 0);
                    const debt = Math.max(0, charge - paid);
                    return <tr key={rowIdentity(row)}><td>#{row.id}</td><td>{row.customer || "Vãng Lai"}</td><td>{row.plate || "—"}</td><td>{numberText(row.gross)}</td><td>{numberText(row.tare)}</td><td>{numberText(charge)}đ</td><td className={debt > 0 ? "has-debt" : ""}>{debt > 0 ? `Còn nợ ${numberText(debt)}đ` : "Đã thanh toán"}</td></tr>;
                  })}
                  {!statisticsFilteredRows.length && <tr><td colSpan="7">Không có dữ liệu phù hợp</td></tr>}
                </tbody>
                <tfoot><tr><th colSpan="5">Tổng {statisticsFilteredRows.length} mã cân</th><th>{numberText(statisticsTotals.charge)}đ</th><th className={statisticsTotals.debt > 0 ? "has-debt" : ""}>Đã thu {numberText(statisticsTotals.paid)}đ • Còn nợ {numberText(statisticsTotals.debt)}đ</th></tr></tfoot>
              </table>
            </div>
          </div>
        </div>
      )}
      {priceTableOpen && (
        <div className="scale-price-overlay" role="dialog" aria-modal="true" aria-label="Bảng giá cân theo tấn">
          <div className="scale-price-dialog">
            <h3>BẢNG GIÁ CÂN THEO TẤN</h3>
            <p className="scale-price-hint">Giá áp dụng theo khối lượng hàng: mỗi dòng là từ 0 đến mức tấn đã nhập, không phụ thuộc biển số hay loại xe.</p>
            <div className="scale-price-table-head"><span>Đến (tấn)</span><span>Giá (đồng)</span><span></span></div>
            <div className="scale-price-table-body">
              {priceTiers.map((tier, index) => (
                <div className="scale-price-tier" key={index}>
                  <input type="number" min="0" step="1" value={tier.maxTons} onChange={(event) => setPriceTiers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, maxTons: event.target.value } : item))} />
                  <input type="number" min="0" step="10000" placeholder="Ví dụ 30000" value={tier.price} onChange={(event) => setPriceTiers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, price: event.target.value } : item))} />
                  <button type="button" aria-label="Xóa mức giá" onClick={() => setPriceTiers((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
                </div>
              ))}
            </div>
            <div className="scale-price-actions">
              <button type="button" onClick={() => setPriceTiers((current) => [...current, { name: "", maxTons: "", price: "" }])}>+ Thêm mức</button>
              <button type="button" className="save" onClick={() => { void saveScaleSettings({ priceTiers, blacklist }); setPriceTableOpen(false); }}>Lưu và đóng</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function formatPrintDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function vietQrUrl(ticketNumber, billing = {}) {
  const transferAmount = Math.max(0, Number(billing.debt) || Number(billing.charge) || 0);
  const query = new URLSearchParams({
    addInfo: `PHIEU CAN ${ticketNumber || "SON PHU"}`,
    accountName: "NGUYEN HONG SON",
  });
  if (transferAmount > 0) query.set("amount", String(Math.round(transferAmount)));
  return `https://img.vietqr.io/image/BIDV-0949250969-qr_only.png?${query.toString()}`;
}

function ScalePrintTicket({ ticketNumber, form, captured, billing = {}, preview = false }) {
  return (
    <section className={`scale-print-sheet${preview ? " is-preview" : ""}`}>
      <header className="scale-print-header">
        <img src="/icon-192.png" alt="Logo Sơn Phú" />
        <div>
          <h1>XƯỞNG TÔN THÉP HỘP SƠN PHÚ</h1>
          <h2>TRẠM CÂN ĐIỆN TỬ 150 TẤN - PHỤC VỤ CÂN ONLINE TỪ XA 24/7</h2>
          <p>QL1A, KCN Diễn Hồng - Xã Đức Châu - Tỉnh Nghệ An</p>
          <p>Điện thoại: 0862.250.969 &amp; 0949.250.969</p>
          <p>Số tài khoản: 0949250969 - Nguyễn Hồng Sơn - BIDV</p>
        </div>
        <figure className="scale-print-payment-qr">
          <img src={vietQrUrl(ticketNumber, billing)} alt="QR thanh toán BIDV 0949250969" />
          <figcaption>QUÉT QR THANH TOÁN</figcaption>
        </figure>
      </header>

      <div className="scale-print-title-row">
        <h3>PHIẾU CÂN XE</h3>
        <div className="scale-print-ticket-code">
          <span>Phiếu số: <strong>{ticketNumber}</strong></span>
          <TicketBarcode value={ticketNumber} />
        </div>
      </div>
      <div className="scale-print-details">
        <div className="scale-print-detail-column">
          <p><span>Khách hàng:</span><strong>{form.customer || ""}</strong></p>
          <p><span>Loại hàng:</span><strong>{form.goods || ""}</strong></p>
          <p><span>Tiền cân:</span><strong>{numberText(billing.charge)}đ</strong></p>
          <p><span>Đã thanh toán:</span><strong>{numberText(billing.paid)}đ</strong></p>
          <p><span>Còn nợ:</span><strong>{numberText(billing.debt)}đ</strong></p>
        </div>
        <div className="scale-print-detail-column">
          <p><span>Biển số xe:</span><strong>{form.plate || ""}{form.plateNote ? ` • ${form.plateNote}` : ""}</strong></p>
          <p><span>Xuất/Nhập:</span><strong>{form.direction || ""}</strong></p>
          <p><span>Ngày cân tổng:</span><strong>{formatPrintDate(captured.grossAt)}</strong></p>
          <p><span>Ngày cân bì:</span><strong>{formatPrintDate(captured.tareAt)}</strong></p>
        </div>
      </div>

      <table className="scale-print-weights">
        <thead><tr><th>Khối lượng tổng</th><th>Khối lượng bì</th><th>Khối lượng hàng</th></tr></thead>
        <tbody><tr><td>{numberText(captured.gross)} kg</td><td>{numberText(captured.tare)} kg</td><td>{numberText(captured.gross - captured.tare)} kg</td></tr></tbody>
      </table>

      <div className="scale-print-signatures">
        <div><strong>NGƯỜI CÂN</strong><span>(Ký, ghi rõ họ tên)</span></div>
        <div><strong>BÊN MUA</strong><span>(Ký, ghi rõ họ tên)</span></div>
        <div><strong>BÊN BÁN</strong><span>(Ký, ghi rõ họ tên)</span></div>
      </div>
    </section>
  );
}

const CODE39_PATTERNS = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn",
  "4": "nnnwwnnnw", "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw",
  "8": "wnnwnnwnn", "9": "nnwwnnwnn", "-": "nwnnnnwnw", "*": "nwnnwnwnn",
};

function TicketBarcode({ value }) {
  const encoded = `*${String(value || "").replace(/[^0-9-]/g, "")}*`;
  const bars = [];
  let x = 0;

  for (const character of encoded) {
    const pattern = CODE39_PATTERNS[character] || CODE39_PATTERNS["-"];
    [...pattern].forEach((widthCode, index) => {
      const width = widthCode === "w" ? 3 : 1;
      if (index % 2 === 0) bars.push(<rect key={`${x}-${index}`} x={x} y="0" width={width} height="24" />);
      x += width;
    });
    x += 1;
  }

  return <svg className="scale-print-barcode" viewBox={`0 0 ${x} 24`} role="img" aria-label={`Mã vạch phiếu ${value}`}>{bars}</svg>;
}

function HistorySuggestInput({ value, onChange, onSelect, suggestions = [], open = false, onFocus, onBlur, onInputBlur, disabled = false, placeholder = "" }) {
  return (
    <div className="scale-history-suggest-wrap">
      <input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
        onFocus={onFocus}
        onBlur={() => { onInputBlur?.(); onBlur?.(); }}
        onChange={(event) => onChange(event.target.value)}
      />
      {open && !disabled && suggestions.length > 0 && (
        <div className="scale-history-suggestions" role="listbox">
          {suggestions.map((item) => (
            <button
              type="button"
              role="option"
              key={item.value}
              onMouseDown={(event) => { event.preventDefault(); onSelect(item.value); }}
            >
              <strong>{item.value}</strong>
              <small>{item.count} lượt • {formatPrintDate(item.latest)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryField({ label, value, onChange, onSelect, suggestions, open, onFocus, onBlur, onSearch, disabled = false }) {
  return (
    <div className="scale-field-row scale-history-field-row">
      <label>{label}</label>
      <HistorySuggestInput value={value} disabled={disabled} suggestions={suggestions} open={open} onFocus={onFocus} onBlur={onBlur} onChange={onChange} onSelect={onSelect} />
      <button type="button" disabled={disabled} onClick={onSearch}>Tìm</button>
    </div>
  );
}

function PlateField({ plate, note, suggestions, open, onFocus, onBlur, onPlateChange, onPlateBlur, onNoteChange, onSelect, onSearch, disabled = false }) {
  return (
    <div className="scale-field-row scale-plate-row">
      <label>Biển số xe</label>
      <div className="scale-plate-inputs">
        <HistorySuggestInput value={plate} disabled={disabled} suggestions={suggestions} open={open} onFocus={onFocus} onBlur={onBlur} onInputBlur={onPlateBlur} onChange={onPlateChange} onSelect={onSelect} />
        <input value={note} disabled={disabled} placeholder="Rơ-moóc / ghi chú" onChange={(event) => onNoteChange(event.target.value)} />
      </div>
      <button type="button" disabled={disabled} onClick={onSearch}>Tìm</button>
    </div>
  );
}

function Field({ label, value, onChange, options, list, disabled = false }) {
  return (
    <div className="scale-field-row">
      <label>{label}</label>
      {options ? (
        <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <input list={list} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      )}
      <button type="button" disabled={disabled}>Tìm</button>
    </div>
  );
}

function WeightRow({ label, value, action, captured = false, busy = false, onAction, labelExtra = null }) {
  return (
    <div className="scale-weight-row">
      <div className="scale-weight-label"><span>{label}</span>{labelExtra}</div>
      <strong>{numberText(value)}</strong>
      {action ? (
        <button
          type="button"
          className={captured ? "is-captured" : ""}
          disabled={captured || busy}
          onClick={onAction}
        >
          {captured ? `Đã ${action.toLowerCase()} ✓` : action}
        </button>
      ) : <span />}
    </div>
  );
}

function SevenSegmentDisplay({ value, locked }) {
  return (
    <div className={`scale-led-digits${locked ? " is-locked" : ""}`} aria-hidden="true">
      {String(value).split("").map((digit, index) => {
        const active = SEGMENTS[digit] || [];
        return (
          <span className="seven-digit" key={`${index}-${digit}`}>
            {["a", "b", "c", "d", "e", "f", "g"].map((segment) => (
              <i key={segment} className={`seven-segment segment-${segment}${active.includes(segment) ? " on" : ""}`} />
            ))}
          </span>
        );
      })}
    </div>
  );
}
