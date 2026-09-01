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
const EMPTY_ROW = { id: null, gross: 0, tare: 0, net: 0, plate: "", customer: "", direction: "", goods: "", grossAt: "", tareAt: "" };
const DEFAULT_SCALE_FORM = {
  customer: "Vãng Lai",
  plate: "",
  direction: "Cân Dịch Vụ",
  goods: "Hàng hóa",
  weigher: "",
  driver: "",
};
const DEFAULT_PRICE_TIERS = [{ name: "Mặc định", maxTons: "", price: "" }];

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
  return configuredPrice >= 1000 ? configuredPrice / 1000 : configuredPrice;
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
  const [selectedId, setSelectedId] = useState(2162);
  const [captured, setCaptured] = useState({ gross: 54000, tare: 19320, grossAt: "", tareAt: "" });
  const [captureLocked, setCaptureLocked] = useState({ gross: true, tare: true });
  const [newWeighingPrimed, setNewWeighingPrimed] = useState(false);
  const [chargeInput, setChargeInput] = useState("");
  const [noExtraCharge, setNoExtraCharge] = useState(false);
  const [totalCharge, setTotalCharge] = useState(0);
  const [lockedChargeRate, setLockedChargeRate] = useState(0);
  const [paidChecked, setPaidChecked] = useState(false);
  const [paidInput, setPaidInput] = useState("");
  const [moneyMessage, setMoneyMessage] = useState("");
  const [priceTableOpen, setPriceTableOpen] = useState(false);
  const [priceTiers, setPriceTiers] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("scale-price-tiers") || "null");
      if (!Array.isArray(saved) || !saved.length) return DEFAULT_PRICE_TIERS;
      const normalized = saved.map((tier) => ({ name: tier.name || "Mặc định", maxTons: tier.maxTons ?? "", price: tier.price ?? "" }));
      return normalized.every((tier) => !tier.price) ? DEFAULT_PRICE_TIERS : normalized;
    } catch {
      return DEFAULT_PRICE_TIERS;
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
        setRows(savedRows);
        setSelectedId(savedRows.at(0)?.id ?? null);
        if (savedRows.at(0)) {
          setCaptured({
            gross: savedRows[0].gross,
            tare: savedRows[0].tare,
            grossAt: savedRows[0].grossAt || "",
            tareAt: savedRows[0].tareAt || "",
          });
          setCaptureLocked({ gross: savedRows[0].gross > 0, tare: savedRows[0].tare > 0 });
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
    if (filter === "pending") return !row.gross || !row.tare;
    if (filter === "done") return row.gross > 0 && row.tare > 0;
    return true;
  });

  const updateField = (name, value) => {
    setNewWeighingPrimed(false);
    setForm((current) => ({ ...current, [name]: value }));
  };
  const selectRow = (row) => {
    setNewWeighingPrimed(false);
    const savedTotal = Math.max(0, Number(row.weigher) || 0);
    const savedPaid = Math.max(0, Number(row.driver) || 0);
    setTotalCharge(savedTotal);
    setLockedChargeRate((row.gross > 0) !== (row.tare > 0) ? savedTotal : 0);
    setPaidInput(savedPaid ? String(savedPaid / 1000) : "");
    setPaidChecked(savedTotal > 0 && savedPaid >= savedTotal);
    setChargeInput(savedTotal ? String(savedTotal / 1000) : "");
    setNoExtraCharge(false);
    setMoneyMessage("");
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
      setForm({ customer: "", plate: "", direction: "", goods: "", weigher: "", driver: "" });
      setNewWeighingPrimed(false);
      setChargeInput("");
      setNoExtraCharge(false);
      setTotalCharge(0);
      setLockedChargeRate(0);
      setPaidInput("");
      setPaidChecked(false);
      setMoneyMessage("");
      return;
    }
    setSelectedId(null);
    setCaptured({ gross: 0, tare: 0, grossAt: "", tareAt: "" });
    setCaptureLocked({ gross: false, tare: false });
    setNewWeighingPrimed(true);
    setChargeInput("");
    setNoExtraCharge(false);
    setTotalCharge(0);
    setLockedChargeRate(0);
    setPaidInput("");
    setPaidChecked(false);
    setMoneyMessage("");
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
    const pricingWeight = hasBothWeights ? Math.abs(next.gross - next.tare) : value;
    const automaticCharge = !noExtraCharge && (!Number.isFinite(manualCharge) || manualCharge <= 0)
      ? (lockedChargeRate > 0 ? lockedChargeRate / 1000 : Number(findAutomaticPrice(priceTiers, form.goods, pricingWeight)))
      : 0;
    if (!noExtraCharge && (!Number.isFinite(manualCharge) || manualCharge <= 0) && automaticCharge <= 0) {
      setMoneyMessage("Chưa có giá phù hợp trong Bảng giá");
      return;
    }
    const appliedCharge = noExtraCharge ? 0 : (manualCharge > 0 ? manualCharge : automaticCharge);
    const nextTotalCharge = totalCharge + Math.round(appliedCharge * 1000);
    if (appliedCharge > 0 && lockedChargeRate <= 0) setLockedChargeRate(Math.round(appliedCharge * 1000));
    setMoneyMessage(automaticCharge > 0 ? `Đã tự áp giá ${numberText(automaticCharge * 1000)}đ` : "");
    const currentPaid = Math.max(0, Math.round((Number(paidInput) || 0) * 1000));
    const nextPaid = paidChecked ? nextTotalCharge : currentPaid;
    setTotalCharge(nextTotalCharge);
    if (paidChecked) setPaidInput(String(nextPaid / 1000));
    setChargeInput(String(appliedCharge));
    setNoExtraCharge(false);
    setCaptured(next);
    setCaptureLocked((current) => ({ ...current, [kind]: true }));
    if (!lanConnected) return;

    setSaving(true);
    try {
      const saved = await saveWeighing({
        id: selectedId,
        ...form,
        weigher: String(nextTotalCharge),
        driver: String(nextPaid),
        ...next,
        net: next.gross - next.tare,
      });
      setRows((current) => [saved, ...current.filter((row) => row.id !== saved.id)]);
      setSelectedId(saved.id);
    } finally {
      setSaving(false);
    }
  };

  const storeCurrentWeighing = async () => {
    if (!lanConnected || saving) return;
    setSaving(true);
    try {
      const saved = await saveWeighing({
        id: selectedId,
        ...form,
        weigher: String(totalCharge),
        driver: String(Math.max(0, Math.round((Number(paidInput) || 0) * 1000))),
        gross: captured.gross,
        tare: captured.tare,
        net: captured.gross - captured.tare,
        grossAt: captured.grossAt || "",
        tareAt: captured.tareAt || "",
      });
      setRows((current) => [saved, ...current.filter((row) => row.id !== saved.id)]);
      setSelectedId(saved.id);
    } finally {
      setSaving(false);
    }
  };

  const displayWeight = scaleOpen ? (weightLocked ? lockedWeight : liveWeight) : 0;
  const detailsLocked = captureLocked.gross || captureLocked.tare;
  const fallbackPricingWeight = captured.gross > 0 && captured.tare > 0
    ? Math.abs(captured.gross - captured.tare)
    : (captured.gross || captured.tare);
  const fallbackPrice = detailsLocked && totalCharge <= 0
    ? Number(findAutomaticPrice(priceTiers, form.goods, fallbackPricingWeight))
    : 0;
  const visibleTotalCharge = totalCharge > 0 ? totalCharge : Math.round(fallbackPrice * 1000);
  const visibleChargeInput = chargeInput !== "" ? chargeInput : (fallbackPrice > 0 ? String(fallbackPrice) : "");

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
          <Field label="Biển số xe" value={form.plate} disabled={detailsLocked} onChange={(value) => updateField("plate", value)} />
          <Field
            label="Xuất/Nhập"
            value={form.direction}
            disabled={detailsLocked}
            options={["", "Cân Dịch Vụ", "Nhập Hàng", "Xuất Hàng"]}
            onChange={(value) => updateField("direction", value)}
          />
          <Field label="Loại hàng" value={form.goods} disabled={detailsLocked} onChange={(value) => updateField("goods", value)} />
          <div className="scale-money-row">
            <label>Tiền cân</label>
            <div className="scale-money-controls">
              <span className="scale-money-input-wrap">
                <input
                  type="number"
                  min="0"
                  step="10"
                  inputMode="numeric"
                  placeholder="Tiền lần này"
                  value={visibleChargeInput}
                  disabled={noExtraCharge}
                  onChange={(event) => { setChargeInput(event.target.value); setMoneyMessage(""); }}
                />
                <span>.000đ</span>
              </span>
              <label className="scale-money-check"><input type="checkbox" checked={noExtraCharge} onChange={(event) => {
                const checked = event.target.checked;
                setNoExtraCharge(checked);
                setChargeInput(checked ? "0" : "");
                setMoneyMessage("");
              }} /> Không thu thêm</label>
              <strong>Tổng: {numberText(visibleTotalCharge)}đ</strong>
            </div>
          </div>
          <div className="scale-money-row">
            <label>Thanh toán</label>
            <div className="scale-money-controls">
              <label className="scale-money-check"><input type="checkbox" checked={paidChecked} onChange={(event) => {
                const checked = event.target.checked;
                setPaidChecked(checked);
                if (checked) setPaidInput(String(visibleTotalCharge / 1000));
              }} /> Đã thanh toán</label>
              <span className="scale-money-input-wrap">
                <input
                  type="number"
                  min="0"
                  step="10"
                  inputMode="numeric"
                  placeholder="Đã thu"
                  value={paidInput}
                  onChange={(event) => { setPaidChecked(false); setPaidInput(event.target.value); }}
                />
                <span>.000đ</span>
              </span>
              <strong className={Math.max(0, visibleTotalCharge - ((Number(paidInput) || 0) * 1000)) > 0 ? "has-debt" : ""}>
                Nợ: {numberText(Math.max(0, visibleTotalCharge - ((Number(paidInput) || 0) * 1000)))}đ
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
            <button type="button" disabled={!lanConnected || saving} onClick={storeCurrentWeighing}>
              {saving ? "Đang lưu..." : "Lưu số liệu"}
            </button>
            <button type="button">Thống kê</button>
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
          <label className="scale-show-all"><input type="checkbox" defaultChecked /> Hiện tất cả</label>
          <div className="scale-port">
            <span>Cổng COM</span>
            <select defaultValue="COM1"><option>COM1</option><option>COM2</option><option>COM3</option></select>
          </div>
        </aside>

        <div className="scale-table-wrap">
          <table className="scale-table">
            <thead>
              <tr>
                <th>STT</th><th>Biển số</th><th>Khối lượng tổng</th><th>Khối lượng bì</th><th>Khối lượng hàng</th>
                <th>Xuất/Nhập</th><th>Khách hàng</th><th>Loại hàng</th><th>Thời gian tổng</th><th>Thời gian bì</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id} className={selectedId === row.id ? "selected" : ""} onClick={() => selectRow(row)}>
                  <td>{row.id}</td><td>{row.plate}</td><td>{numberText(row.gross)}</td><td>{numberText(row.tare)}</td><td>{numberText(row.net)}</td>
                  <td>{row.direction}</td><td>{row.customer}</td><td>{row.goods}</td><td>{row.grossAt}</td><td>{row.tareAt}</td>
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
      {priceTableOpen && (
        <div className="scale-price-overlay" role="dialog" aria-modal="true" aria-label="Bảng giá cân theo tấn">
          <div className="scale-price-dialog">
            <h3>BẢNG GIÁ CÂN THEO TẤN</h3>
            <div className="scale-price-table-head"><span>Loại xe/nhóm</span><span>Đến (tấn)</span><span>Giá (30 = 30.000đ)</span><span></span></div>
            <div className="scale-price-table-body">
              {priceTiers.map((tier, index) => (
                <div className="scale-price-tier" key={index}>
                  <input type="text" placeholder="Tên loại" value={tier.name || ""} onChange={(event) => setPriceTiers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
                  <input type="number" min="0" step="1" value={tier.maxTons} onChange={(event) => setPriceTiers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, maxTons: event.target.value } : item))} />
                  <input type="number" min="0" step="10" placeholder="Nhập giá" value={tier.price} onChange={(event) => setPriceTiers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, price: event.target.value } : item))} />
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
          <p><span>Biển số xe:</span><strong>{form.plate || ""}</strong></p>
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
