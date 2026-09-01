import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getWeighings,
  saveWeighing,
  subscribeToScale,
  updateScaleState,
} from "../utils/scaleApi";
import "../styles/weighing.css";

const SAMPLE_ROWS = [
  { id: 2157, plate: "15C 066.35", gross: 52510, tare: 19430, net: 33080, direction: "Cân Dịch Vụ", customer: "VL", goods: "Thép", grossAt: "2026/08/24 15:20", tareAt: "2026/08/25 11:05" },
  { id: 2158, plate: "37H 18695", gross: 10255, tare: 0, net: 10255, direction: "Cân Dịch Vụ", customer: "VL", goods: "Inox", grossAt: "2026/08/25 17:12", tareAt: "" },
  { id: 2159, plate: "37H 00687", gross: 30100, tare: 21450, net: 8650, direction: "Cân Dịch Vụ", customer: "KÍNH CƯỜNG", goods: "Kính", grossAt: "2026/08/26 07:42", tareAt: "2026/08/26 08:16" },
  { id: 2160, plate: "37H 17203", gross: 0, tare: 19710, net: -19710, direction: "Cân Dịch Vụ", customer: "VL", goods: "Thép", grossAt: "", tareAt: "2026/08/26 10:10" },
  { id: 2161, plate: "36K 26615", gross: 6870, tare: 0, net: 6870, direction: "Cân Dịch Vụ", customer: "VL", goods: "Tôn", grossAt: "2026/08/30 10:22", tareAt: "" },
  { id: 2162, plate: "37H 07553", gross: 54000, tare: 19320, net: 34680, direction: "Cân Dịch Vụ", customer: "Cường inox", goods: "Inox", grossAt: "2026/08/31 11:03", tareAt: "2026/08/31 11:42" },
];

const padWeight = (value) => String(Math.max(0, Math.round(Number(value) || 0))).padStart(6, " ");
const numberText = (value) => Number(value || 0).toLocaleString("vi-VN");
const EMPTY_ROW = { id: null, gross: 0, tare: 0, net: 0, plate: "", plateNote: "", customer: "", direction: "", goods: "", grossAt: "", tareAt: "", charge: 0, paid: 0, cancelled: 0, seriesId: "" };
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
  { key: "plate", label: "Biển số", width: 9, min: 6 },
  { key: "customer", label: "Khách hàng", width: 11, min: 7 },
  { key: "gross", label: "KL tổng", width: 6, min: 5 },
  { key: "tare", label: "KL bì", width: 6, min: 5 },
  { key: "grossAt", label: "Ngày tổng", width: 10, min: 7 },
  { key: "tareAt", label: "Ngày bì", width: 10, min: 7 },
  { key: "direction", label: "Xuất/Nhập", width: 8, min: 6 },
  { key: "goods", label: "Loại hàng", width: 8, min: 6 },
  { key: "charge", label: "Thành tiền", width: 10, min: 7 },
  { key: "paid", label: "Đã TT", width: 5, min: 4 },
  { key: "debt", label: "Còn nợ", width: 12, min: 7 },
];
const DEFAULT_HISTORY_COLUMN_WIDTHS = HISTORY_COLUMNS.map((column) => column.width);

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

function normalizeWeighing(row) {
  const charge = Math.max(0, Number(row.charge ?? row.weigher) || 0);
  const paid = Math.max(0, Number(row.paid ?? row.driver) || 0);
  return {
    ...row,
    plateNote: row.plateNote || "",
    charge,
    paid,
    noCharge: Boolean(row.noCharge),
    cancelled: Boolean(row.cancelled),
    cancelledAt: row.cancelledAt || "",
    seriesId: row.seriesId || (row.id ? `scale-${row.id}` : ""),
  };
}

function findAutomaticPrice(priceTiers, goodsName, netWeight) {
  const normalizedGoods = String(goodsName || "").trim().toLocaleLowerCase("vi-VN");
  const priced = priceTiers.filter((tier) => Number(tier.price) > 0);
  if (!priced.length) return 0;
  const named = priced.filter((tier) => String(tier.name || "").trim().toLocaleLowerCase("vi-VN") === normalizedGoods);
  const defaults = priced.filter((tier) => ["mặc định", "theo tấn"].includes(String(tier.name || "").trim().toLocaleLowerCase("vi-VN")));
  const candidates = named.length ? named : (defaults.length ? defaults : (priced.length === 1 ? priced : []));
  const tons = Math.abs(Number(netWeight) || 0) / 1000;
  const configuredPrice = Number(candidates
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
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());
  const [lanConnected, setLanConnected] = useState(false);
  const [headConnected, setHeadConnected] = useState(false);
  const [serialMessage, setSerialMessage] = useState("Chờ máy chủ cân");
  const [rows, setRows] = useState(SAMPLE_ROWS);
  const [scaleOpen, setScaleOpen] = useState(true);
  const [weightLocked, setWeightLocked] = useState(false);
  const [liveWeight, setLiveWeight] = useState(34680);
  const [lockedWeight, setLockedWeight] = useState(34680);
  const [filter, setFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("last30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedId, setSelectedId] = useState(2162);
  const [captured, setCaptured] = useState({ gross: 54000, tare: 19320, grossAt: "", tareAt: "" });
  const [captureLocked, setCaptureLocked] = useState({ gross: true, tare: true });
  const [newWeighingPrimed, setNewWeighingPrimed] = useState(false);
  const [additionalWeighingActive, setAdditionalWeighingActive] = useState(false);
  const [chargeInput, setChargeInput] = useState("");
  const [noExtraCharge, setNoExtraCharge] = useState(false);
  const [totalCharge, setTotalCharge] = useState(0);
  const [lockedChargeRate, setLockedChargeRate] = useState(0);
  const [chargeManuallyEdited, setChargeManuallyEdited] = useState(false);
  const [paidChecked, setPaidChecked] = useState(false);
  const [paidInput, setPaidInput] = useState("");
  const [moneyMessage, setMoneyMessage] = useState("");
  const [priceTableOpen, setPriceTableOpen] = useState(false);
  const [statisticsOpen, setStatisticsOpen] = useState(false);
  const [statisticsMode, setStatisticsMode] = useState("overall");
  const [seriesId, setSeriesId] = useState("");
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
  const [form, setForm] = useState(DEFAULT_SCALE_FORM);

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) || rows.at(0) || EMPTY_ROW,
    [rows, selectedId]
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("scale-price-tiers", JSON.stringify(priceTiers));
  }, [priceTiers]);

  useEffect(() => {
    window.localStorage.setItem("scale-history-column-widths", JSON.stringify(historyColumnWidths));
  }, [historyColumnWidths]);

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
    };
  }, [printPreviewOpen]);

  const printTicket = () => {
    window.print();
  };

  const openPrintPreview = () => {
    const dateCode = [
      String(now.getDate()).padStart(2, "0"),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getFullYear()).slice(-2),
    ].join("");
    const randomSequence = window.crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
    setPrintTicketNumber(`${dateCode}-${String(randomSequence).padStart(6, "0")}`);
    setPrintPreviewOpen(true);
  };

  useEffect(() => {
    let active = true;

    Promise.all([updateScaleState({ open: true }), getWeighings()])
      .then(([state, savedRows]) => {
        if (!active) return;
        setLanConnected(true);
        setHeadConnected(Boolean(state.headConnected));
        setSerialMessage(state.serialMessage || "Chờ dữ liệu từ đầu cân");
        setScaleOpen(Boolean(state.open));
        setWeightLocked(Boolean(state.locked));
        setLiveWeight(Number(state.weight) || 0);
        setLockedWeight(Number(state.lockedWeight) || 0);
        const normalizedRows = savedRows.map(normalizeWeighing);
        setRows(normalizedRows);
        setSelectedId(normalizedRows.at(0)?.id ?? null);
        if (normalizedRows.at(0)) {
          const first = normalizedRows[0];
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
        } else {
          setCaptured({ gross: 0, tare: 0, grossAt: "", tareAt: "" });
          setCaptureLocked({ gross: false, tare: false });
        }
      })
      .catch(() => setLanConnected(false));

    const unsubscribe = subscribeToScale((state) => {
      if (!active) return;
      setHeadConnected(Boolean(state.headConnected));
      setSerialMessage(state.serialMessage || "Chờ dữ liệu từ đầu cân");
      setScaleOpen(Boolean(state.open));
      setWeightLocked(Boolean(state.locked));
      setLiveWeight(Number(state.weight) || 0);
      setLockedWeight(Number(state.lockedWeight) || 0);
    }, (connected) => {
      if (active) setLanConnected(connected);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (lanConnected || !scaleOpen || weightLocked) return undefined;
    const timer = window.setInterval(() => {
      setLiveWeight(Math.max(0, selected.net + Math.round((Math.random() - 0.5) * 70)));
    }, 650);
    return () => window.clearInterval(timer);
  }, [lanConnected, scaleOpen, selected.net, weightLocked]);

  const visibleRows = rows.filter((row) => {
    if (filter === "pending" && row.gross > 0 && row.tare > 0) return false;
    if (filter === "done" && (!row.gross || !row.tare)) return false;

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
  const selectRow = (row) => {
    setNewWeighingPrimed(false);
    setAdditionalWeighingActive(false);
    const savedTotal = Math.max(0, Number(row.charge ?? row.weigher) || 0);
    const savedPaid = Math.max(0, Number(row.paid ?? row.driver) || 0);
    setTotalCharge(savedTotal);
    setLockedChargeRate((row.gross > 0) !== (row.tare > 0) ? savedTotal : 0);
    setPaidInput(savedPaid ? String(savedPaid) : "");
    setPaidChecked(savedTotal > 0 && savedPaid >= savedTotal);
    setChargeInput(savedTotal ? String(savedTotal) : "");
    setNoExtraCharge(Boolean(row.noCharge));
    setChargeManuallyEdited(savedTotal > 0);
    setMoneyMessage("");
    setSeriesId(row.seriesId || `scale-${row.id}`);
    setSelectedId(row.id);
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
  };

  const toggleScale = async () => {
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
    setLiveWeight(selected.net);
  };

  const toggleWeightLock = async () => {
    if (!scaleOpen) return;
    if (!weightLocked && liveWeight <= 0) return;
    if (weightLocked) applyHigherAutomaticPrice(liveWeight || lockedWeight);
    if (lanConnected) {
      try {
        await updateScaleState({ locked: !weightLocked });
      } catch {
        setLanConnected(false);
      }
      return;
    }
    if (weightLocked) {
      setWeightLocked(false);
      setLiveWeight(lockedWeight);
      return;
    }
    setLockedWeight(liveWeight);
    setWeightLocked(true);
  };

  const startNewWeighing = () => {
    if (newWeighingPrimed) {
      setForm({ customer: "", plate: "", plateNote: "", direction: "", goods: "", weigher: "", driver: "" });
      setNewWeighingPrimed(false);
      setChargeInput("");
      setNoExtraCharge(false);
      setTotalCharge(0);
      setLockedChargeRate(0);
      setPaidInput("");
      setPaidChecked(false);
      setMoneyMessage("");
      setSeriesId("");
      setChargeManuallyEdited(false);
      setAdditionalWeighingActive(false);
      return;
    }
    const preservedCharge = weightLocked ? Math.max(lockedChargeRate, totalCharge) : 0;
    setSelectedId(null);
    setCaptured({ gross: 0, tare: 0, grossAt: "", tareAt: "" });
    setCaptureLocked({ gross: false, tare: false });
    setNewWeighingPrimed(true);
    setChargeInput(preservedCharge > 0 ? String(preservedCharge) : "");
    setNoExtraCharge(false);
    setTotalCharge(preservedCharge);
    setLockedChargeRate(preservedCharge);
    setPaidInput("");
    setPaidChecked(false);
    setMoneyMessage("");
    setSeriesId("");
    setChargeManuallyEdited(preservedCharge > 0);
    setAdditionalWeighingActive(false);
  };

  const startAdditionalWeighing = () => {
    const nextSeriesId = seriesId || selected.seriesId || (selected.id ? `scale-${selected.id}` : crypto.randomUUID());
    setSeriesId(nextSeriesId);
    setSelectedId(null);
    setCaptureLocked({ gross: false, tare: false });
    setNewWeighingPrimed(false);
    setAdditionalWeighingActive(true);
    setChargeInput("");
    setTotalCharge(0);
    setLockedChargeRate(0);
    setChargeManuallyEdited(false);
    setNoExtraCharge(false);
    setPaidInput("");
    setPaidChecked(false);
    setMoneyMessage("Cân lại tổng hoặc bì để tạo mã cân tiếp theo");
  };

  const captureWeight = async (kind) => {
    if (captureLocked[kind] || saving) return;
    const value = weightLocked ? lockedWeight : liveWeight;
    if (value <= 0) return;
    setNewWeighingPrimed(false);
    let next = { ...captured, [kind]: value, [`${kind}At`]: new Date().toISOString() };
    if (next.gross > 0 && next.tare > 0 && next.gross < next.tare) {
      next = { gross: next.tare, tare: next.gross, grossAt: next.tareAt, tareAt: next.grossAt };
    }
    const manualCharge = Number(chargeInput);
    const hasBothWeights = next.gross > 0 && next.tare > 0;
    const pricingWeight = additionalWeighingActive ? value : (hasBothWeights ? Math.abs(next.gross - next.tare) : value);
    const automaticCharge = !noExtraCharge && !chargeManuallyEdited
      ? (additionalWeighingActive
        ? Number(findAutomaticPrice(priceTiers, form.goods, pricingWeight))
        : (lockedChargeRate > 0 ? lockedChargeRate : Number(findAutomaticPrice(priceTiers, form.goods, pricingWeight))))
      : 0;
    const appliedCharge = noExtraCharge ? 0 : (chargeManuallyEdited ? Math.max(0, manualCharge) : automaticCharge);
    const nextTotalCharge = Math.round(appliedCharge);
    if (appliedCharge > 0 && (additionalWeighingActive || lockedChargeRate <= 0)) setLockedChargeRate(Math.round(appliedCharge));
    setMoneyMessage(automaticCharge > 0 ? `Đã tự áp giá ${numberText(automaticCharge)}đ` : (!noExtraCharge && !chargeManuallyEdited ? "Chưa có giá phù hợp trong Bảng giá" : ""));
    const currentPaid = Math.max(0, Math.round(Number(paidInput) || 0));
    const nextPaid = paidChecked ? nextTotalCharge : currentPaid;
    setTotalCharge(nextTotalCharge);
    if (paidChecked) setPaidInput(String(nextPaid));
    setChargeInput(appliedCharge > 0 ? String(appliedCharge) : "0");
    setCaptured(next);
    setCaptureLocked((current) => additionalWeighingActive ? { gross: true, tare: true } : { ...current, [kind]: true });
    if (!lanConnected) return;

    setSaving(true);
    try {
      const nextSeriesId = seriesId || (selectedId ? selected.seriesId || `scale-${selectedId}` : crypto.randomUUID());
      const saved = await saveWeighing({
        id: selectedId,
        ...form,
        weigher: String(nextTotalCharge),
        driver: String(nextPaid),
        charge: nextTotalCharge,
        paid: nextPaid,
        noCharge: noExtraCharge,
        seriesId: nextSeriesId,
        ...next,
        net: next.gross - next.tare,
      });
      const normalized = normalizeWeighing(saved);
      setRows((current) => [normalized, ...current.filter((row) => row.id !== normalized.id)]);
      setSelectedId(saved.id);
      setSeriesId(nextSeriesId);
      setAdditionalWeighingActive(false);
    } finally {
      setSaving(false);
    }
  };

  const persistCurrentWeighing = async (overrides = {}) => {
    if (!lanConnected || saving || !selectedId) return;
    const charge = overrides.charge ?? totalCharge;
    const paid = overrides.paid ?? Math.max(0, Math.round(Number(paidInput) || 0));
    setSaving(true);
    try {
      const saved = normalizeWeighing(await saveWeighing({
        ...selected,
        ...form,
        id: selectedId,
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
        seriesId: seriesId || selected.seriesId || `scale-${selectedId}`,
      }));
      setRows((current) => [saved, ...current.filter((row) => row.id !== saved.id)]);
    } finally {
      setSaving(false);
    }
  };

  const applyHigherAutomaticPrice = (weight) => {
    if (noExtraCharge) return;
    const referenceWeight = captured.gross > 0 && captured.tare > 0
      ? Math.max(Math.abs(Number(weight) - captured.gross), Math.abs(Number(weight) - captured.tare))
      : Number(weight) || 0;
    const nextPrice = Math.round(Number(findAutomaticPrice(priceTiers, form.goods, referenceWeight)));
    if (nextPrice <= totalCharge) return;
    setTotalCharge(nextPrice);
    setChargeInput(String(nextPrice));
    setLockedChargeRate(nextPrice);
    setChargeManuallyEdited(false);
    setMoneyMessage(`Giá mới ${numberText(nextPrice)}đ, nợ ${numberText(Math.max(0, nextPrice - paidAmount))}đ`);
    if (paidChecked) setPaidInput(String(nextPrice));
    void persistCurrentWeighing({ charge: nextPrice, paid: paidChecked ? nextPrice : paidAmount });
  };

  const changeCharge = (value) => {
    const charge = Math.max(0, Math.round(Number(value) || 0));
    setChargeInput(value);
    setTotalCharge(charge);
    setChargeManuallyEdited(true);
    setMoneyMessage("");
    if (paidChecked) setPaidInput(String(charge));
  };

  const changePaid = (value) => {
    setPaidChecked(false);
    setPaidInput(value);
  };

  const toggleNoCharge = (checked) => {
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

  const toggleCancelled = async (row) => {
    if (!lanConnected || saving) return;
    const cancelled = !row.cancelled;
    setSaving(true);
    try {
      const saved = normalizeWeighing(await saveWeighing({
        ...row,
        cancelled,
        cancelledAt: cancelled ? new Date().toISOString() : "",
      }));
      setRows((current) => current.map((item) => item.id === saved.id ? saved : item));
    } finally {
      setSaving(false);
    }
  };

  const toggleRowPaid = async (row, checked) => {
    if (!lanConnected || saving || row.cancelled) return;
    const charge = Math.max(0, Number(row.charge ?? row.weigher) || 0);
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
      setRows((current) => current.map((item) => item.id === saved.id ? saved : item));
      if (selectedId === saved.id) {
        setPaidInput(paid > 0 ? String(paid) : "");
        setPaidChecked(checked);
      }
    } finally {
      setSaving(false);
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

  const displayWeight = scaleOpen ? (weightLocked ? lockedWeight : liveWeight) : 0;
  const detailsLocked = captureLocked.gross || captureLocked.tare;
  const fallbackPricingWeight = captured.gross > 0 && captured.tare > 0
    ? Math.abs(captured.gross - captured.tare)
    : (captured.gross || captured.tare);
  const fallbackPrice = detailsLocked && totalCharge <= 0 && !chargeManuallyEdited
    ? Math.round(Number(findAutomaticPrice(priceTiers, form.goods, fallbackPricingWeight)))
    : 0;
  const visibleTotalCharge = noExtraCharge ? 0 : (totalCharge > 0 ? totalCharge : fallbackPrice);
  const visibleChargeInput = noExtraCharge ? "0" : (chargeInput !== "" ? chargeInput : (fallbackPrice > 0 ? String(fallbackPrice) : ""));
  const paidAmount = noExtraCharge ? 0 : Math.max(0, Math.round(Number(paidInput) || 0));
  const debtAmount = Math.max(0, visibleTotalCharge - paidAmount);
  const statisticsRows = Object.values(rows.filter((row) => !row.cancelled).reduce((groups, row) => {
    const key = statisticsMode === "customer"
      ? (row.customer || "Không rõ")
      : statisticsMode === "plate"
      ? (row.plate || "Không biển số")
      : "Tổng thể";
    if (!groups[key]) groups[key] = { key, count: 0, net: 0, charge: 0, paid: 0 };
    groups[key].count += 1;
    groups[key].net += Math.abs(Number(row.net) || 0);
    groups[key].charge += Math.max(0, Number(row.charge ?? row.weigher) || 0);
    groups[key].paid += Math.max(0, Number(row.paid ?? row.driver) || 0);
    return groups;
  }, {}));

  return (
    <main className="scale-page">
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
          <span>{now.toLocaleDateString("vi-VN")}</span>
          <span>{now.toLocaleTimeString("vi-VN")}</span>
          <small className={lanConnected ? (headConnected ? "is-ready" : "is-waiting") : "is-offline"}>
            {lanConnected ? serialMessage : "Chưa kết nối máy chủ cân"}
          </small>
          <button type="button" onClick={() => navigate("/")}>← Đơn hàng</button>
        </div>
      </section>

      <section className="scale-control-panel">
        <div className="scale-fields">
          <Field label="Khách hàng" value={form.customer} disabled={detailsLocked} onChange={(value) => updateField("customer", value)} />
          <PlateField
            plate={form.plate}
            note={form.plateNote}
            disabled={detailsLocked}
            onPlateChange={(value) => updateField("plate", value)}
            onPlateBlur={() => setForm((current) => ({ ...current, plate: normalizePlate(current.plate) }))}
            onNoteChange={(value) => updateField("plateNote", value)}
          />
          <Field
            label="Xuất/Nhập"
            value={form.direction}
            disabled={detailsLocked}
            options={["", "Cân Dịch Vụ", "Nhập Hàng", "Xuất Hàng"]}
            onChange={(value) => updateField("direction", value)}
          />
          <Field label="Loại hàng" value={form.goods} disabled={detailsLocked} onChange={(value) => updateField("goods", value)} />
          <div className={`scale-money-row${noExtraCharge ? " is-disabled" : ""}`}>
            <label>Tiền cân</label>
            <div className="scale-money-controls">
              <span className="scale-money-input-wrap">
                <input
                  type="number"
                  min="0"
                  step="10000"
                  inputMode="numeric"
                  placeholder="Nhập đúng số tiền"
                  value={visibleChargeInput}
                  disabled={noExtraCharge}
                  onFocus={() => setChargeManuallyEdited(true)}
                  onChange={(event) => changeCharge(event.target.value)}
                  onBlur={() => void persistCurrentWeighing({ charge: totalCharge, paid: paidAmount })}
                />
                <span>đ</span>
              </span>
              <label className="scale-money-check"><input type="checkbox" checked={noExtraCharge} onChange={(event) => {
                const checked = event.target.checked;
                toggleNoCharge(checked);
              }} /> Không thu tiền</label>
              <strong>Tổng: {numberText(visibleTotalCharge)}đ</strong>
            </div>
          </div>
          <div className={`scale-money-row${noExtraCharge ? " is-disabled" : ""}`}>
            <label>Thanh toán</label>
            <div className="scale-money-controls">
              <label className="scale-money-check"><input type="checkbox" disabled={noExtraCharge} checked={paidChecked} onChange={(event) => {
                const checked = event.target.checked;
                setPaidChecked(checked);
                const paid = checked ? visibleTotalCharge : 0;
                setPaidInput(checked ? String(paid) : "");
                void persistCurrentWeighing({ charge: visibleTotalCharge, paid });
              }} /> Đã thanh toán</label>
              <span className="scale-money-input-wrap">
                <input
                  type="number"
                  min="0"
                  step="10000"
                  inputMode="numeric"
                  placeholder="Đã thu"
                  value={paidInput}
                  disabled={noExtraCharge}
                  onChange={(event) => changePaid(event.target.value)}
                  onBlur={() => void persistCurrentWeighing({ charge: visibleTotalCharge, paid: paidAmount })}
                />
                <span>đ</span>
              </span>
              <strong className={debtAmount > 0 ? "has-debt" : ""}>
                Nợ: {numberText(debtAmount)}đ
              </strong>
            </div>
          </div>
          {moneyMessage && <div className="scale-money-warning">{moneyMessage}</div>}
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
            <button type="button" disabled={saving || !selectedId} onClick={startAdditionalWeighing}>
              Cân thêm
            </button>
            <button type="button" onClick={() => setStatisticsOpen(true)}>Thống kê</button>
          </div>
          <div className="scale-serial-settings">
            <label>Baud Rate <select defaultValue="9600"><option>9600</option><option>19200</option></select></label>
            <label>Data Bits <select defaultValue="8"><option>8</option><option>7</option></select></label>
            <label>Stop Bits <select defaultValue="Two"><option>One</option><option>Two</option></select></label>
          </div>
        </div>

        <div className="scale-side-actions">
          <button type="button" className={scaleOpen ? "is-open" : ""} onClick={toggleScale}>
            {scaleOpen ? "Tắt cân" : "Mở cân"}
          </button>
          <button type="button" onClick={openPrintPreview}>In phiếu</button>
        </div>
      </section>

      <section className="scale-history-panel">
        <aside className="scale-filter-panel">
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
                <tr key={row.id} className={`${selectedId === row.id ? "selected " : ""}${row.cancelled ? "is-cancelled" : ""}`} onClick={() => selectRow(row)}>
                  <td><button type="button" className="scale-cancel-row" onClick={(event) => { event.stopPropagation(); void toggleCancelled(row); }}>{row.cancelled ? "Khôi phục" : "Hủy"}</button></td>
                  <td>{row.plate}{row.plateNote ? <small>{row.plateNote}</small> : null}</td><td>{row.customer}</td><td>{numberText(row.gross)}</td><td>{numberText(row.tare)}</td>
                  <td>{formatPrintDate(row.grossAt)}</td><td>{formatPrintDate(row.tareAt)}</td><td>{row.direction}</td><td>{row.goods}</td>
                  <td>{numberText(row.charge ?? row.weigher)}đ</td>
                  <td className="scale-paid-cell">
                    <input
                      type="checkbox"
                      aria-label={`Đã thanh toán ${row.plate || row.id}`}
                      title="Tích để đánh dấu đã thanh toán đủ"
                      checked={Number(row.charge ?? row.weigher) > 0 && Number(row.paid ?? row.driver) >= Number(row.charge ?? row.weigher)}
                      disabled={!lanConnected || saving || row.cancelled || Number(row.charge ?? row.weigher) <= 0}
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
      </section>

      <footer className="scale-footer">PHẦN MỀM CÂN XE • THÉP SƠN PHÚ</footer>

      {printPreviewOpen && (
        <div className="scale-print-preview" role="dialog" aria-modal="true" aria-label="Xem trước phiếu cân">
          <div className="scale-print-pages">
            <ScalePrintTicket
              preview
              ticketNumber={printTicketNumber}
              form={form}
              captured={captured}
              printedAt={now}
            />
            <div className="scale-print-extra-copies" aria-hidden="true">
              {Array.from({ length: Math.max(0, printCopies - 1) }, (_, index) => (
                <ScalePrintTicket
                  key={index}
                  ticketNumber={printTicketNumber}
                  form={form}
                  captured={captured}
                  printedAt={now}
                />
              ))}
            </div>
          </div>
          <div className="scale-print-preview-actions">
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
            <button type="button" className="print-now" onClick={printTicket}>🖨 In</button>
            <button type="button" onClick={() => setPrintPreviewOpen(false)}>Đóng (Esc)</button>
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
              <button type="button" className={statisticsMode === "overall" ? "active" : ""} onClick={() => setStatisticsMode("overall")}>Tổng thể</button>
              <button type="button" className={statisticsMode === "customer" ? "active" : ""} onClick={() => setStatisticsMode("customer")}>Theo khách</button>
              <button type="button" className={statisticsMode === "plate" ? "active" : ""} onClick={() => setStatisticsMode("plate")}>Theo biển số xe</button>
            </div>
            <div className="scale-statistics-table-wrap">
              <table className="scale-statistics-table">
                <thead><tr><th>Nhóm</th><th>Số lượt</th><th>Khối lượng hàng</th><th>Tổng tiền cân</th><th>Đã thu</th><th>Xe đang nợ</th></tr></thead>
                <tbody>
                  {statisticsRows.map((item) => (
                    <tr key={item.key}>
                      <td>{item.key}</td><td>{item.count}</td><td>{numberText(item.net)} kg</td><td>{numberText(item.charge)}đ</td><td>{numberText(item.paid)}đ</td><td className={item.charge > item.paid ? "has-debt" : ""}>{numberText(Math.max(0, item.charge - item.paid))}đ</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {priceTableOpen && (
        <div className="scale-price-overlay" role="dialog" aria-modal="true" aria-label="Bảng giá cân theo tấn">
          <div className="scale-price-dialog">
            <h3>BẢNG GIÁ CÂN THEO TẤN</h3>
            <div className="scale-price-table-head"><span>Loại xe/nhóm</span><span>Đến (tấn)</span><span>Giá (đồng)</span><span></span></div>
            <div className="scale-price-table-body">
              {priceTiers.map((tier, index) => (
                <div className="scale-price-tier" key={index}>
                  <input type="text" placeholder="Tên loại" value={tier.name || ""} onChange={(event) => setPriceTiers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
                  <input type="number" min="0" step="1" value={tier.maxTons} onChange={(event) => setPriceTiers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, maxTons: event.target.value } : item))} />
                  <input type="number" min="0" step="10000" placeholder="Ví dụ 30000" value={tier.price} onChange={(event) => setPriceTiers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, price: event.target.value } : item))} />
                  <button type="button" aria-label="Xóa mức giá" onClick={() => setPriceTiers((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
                </div>
              ))}
            </div>
            <div className="scale-price-actions">
              <button type="button" onClick={() => setPriceTiers((current) => [...current, { name: "", maxTons: "", price: "" }])}>+ Thêm mức</button>
              <button type="button" className="save" onClick={() => setPriceTableOpen(false)}>Lưu và đóng</button>
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

function ScalePrintTicket({ ticketNumber, form, captured, preview = false }) {
  return (
    <section className={`scale-print-sheet${preview ? " is-preview" : ""}`}>
      <header className="scale-print-header">
        <img src="/icon-192.png" alt="Logo Sơn Phú" />
        <div>
          <h1>XƯỞNG TÔN THÉP HỘP SƠN PHÚ</h1>
          <h2>TRẠM CÂN ĐIỆN TỬ 150 TẤN - PHỤC VỤ CÂN ONLINE TỪ XA 24/7</h2>
          <p>QL1A, KCN Diễn Hồng - Xã Đức Châu - Tỉnh Nghệ An</p>
          <p>Điện thoại: 0862.250.969 &amp; 0949.250.969</p>
          <p>Số tài khoản: 0949.250.969 - BIDV</p>
        </div>
        <div className="scale-print-qr-placeholder">QR<br />THANH TOÁN</div>
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

function PlateField({ plate, note, onPlateChange, onPlateBlur, onNoteChange, disabled = false }) {
  return (
    <div className="scale-field-row scale-plate-row">
      <label>Biển số xe</label>
      <div className="scale-plate-inputs">
        <input value={plate} disabled={disabled} placeholder="37S 1234" onChange={(event) => onPlateChange(event.target.value)} onBlur={onPlateBlur} />
        <input value={note} disabled={disabled} placeholder="Rơ-moóc / ghi chú" onChange={(event) => onNoteChange(event.target.value)} />
      </div>
      <button type="button" disabled={disabled}>Tìm</button>
    </div>
  );
}

function Field({ label, value, onChange, options, disabled = false }) {
  return (
    <div className="scale-field-row">
      <label>{label}</label>
      {options ? (
        <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
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
