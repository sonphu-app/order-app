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
  const [saving, setSaving] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [form, setForm] = useState({
    customer: "Cường inox",
    plate: "37H 07553",
    direction: "Cân Dịch Vụ",
    goods: "Inox",
    weigher: "Nguyễn Sơn",
    driver: "",
  });

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) || rows.at(0) || EMPTY_ROW,
    [rows, selectedId]
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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

  const updateField = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  const selectRow = (row) => {
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
    setSelectedId(null);
    setCaptured({ gross: 0, tare: 0, grossAt: "", tareAt: "" });
    setCaptureLocked({ gross: false, tare: false });
  };

  const captureWeight = (kind) => {
    if (captureLocked[kind]) return;
    const value = weightLocked ? lockedWeight : liveWeight;
    if (value <= 0) return;
    setCaptured((current) => {
      const next = { ...current, [kind]: value, [`${kind}At`]: new Date().toISOString() };
      if (next.gross > 0 && next.tare > 0) {
        if (next.gross >= next.tare) return next;
        return { gross: next.tare, tare: next.gross, grossAt: next.tareAt, tareAt: next.grossAt };
      }
      return next;
    });
    setCaptureLocked((current) => ({ ...current, [kind]: true }));
  };

  const storeCurrentWeighing = async () => {
    if (!lanConnected || saving) return;
    setSaving(true);
    try {
      const saved = await saveWeighing({
        ...form,
        gross: captured.gross,
        tare: captured.tare,
        net: captured.gross - captured.tare,
        grossAt: captured.grossAt || "",
        tareAt: captured.tareAt || "",
      });
      setRows((current) => [saved, ...current]);
      setSelectedId(saved.id);
    } finally {
      setSaving(false);
    }
  };

  const displayWeight = scaleOpen ? (weightLocked ? lockedWeight : liveWeight) : 0;

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
          <Field label="Khách hàng" value={form.customer} onChange={(value) => updateField("customer", value)} />
          <Field label="Biển số xe" value={form.plate} onChange={(value) => updateField("plate", value)} />
          <Field label="Xuất/Nhập" value={form.direction} onChange={(value) => updateField("direction", value)} />
          <Field label="Loại hàng" value={form.goods} onChange={(value) => updateField("goods", value)} />
          <Field label="Người cân" value={form.weigher} onChange={(value) => updateField("weigher", value)} />
          <Field label="Lái xe" value={form.driver} onChange={(value) => updateField("driver", value)} />
        </div>

        <div className="scale-weight-box">
          <WeightRow label="Khối lượng tổng" value={captured.gross} action="Cân tổng" captured={captureLocked.gross} onAction={() => captureWeight("gross")} />
          <WeightRow label="Khối lượng bì" value={captured.tare} action="Cân bì" captured={captureLocked.tare} onAction={() => captureWeight("tare")} />
          <WeightRow label="Khối lượng hàng" value={captured.gross - captured.tare} />
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
          <button type="button" onClick={() => setPrintPreviewOpen(true)}>In phiếu</button>
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
          <div className="scale-print-preview-actions">
            <button type="button" className="print-now" onClick={() => window.print()}>🖨 In ngay</button>
            <button type="button" onClick={() => setPrintPreviewOpen(false)}>Đóng</button>
          </div>
          <ScalePrintTicket
            preview
            ticketId={selectedId}
            form={form}
            captured={captured}
            printedAt={now}
          />
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

function ScalePrintTicket({ ticketId, form, captured, printedAt, preview = false }) {
  const sourceDate = new Date(captured.grossAt || captured.tareAt || printedAt);
  const dateCode = [
    String(sourceDate.getDate()).padStart(2, "0"),
    String(sourceDate.getMonth() + 1).padStart(2, "0"),
    sourceDate.getFullYear(),
  ].join("");
  const ticketNumber = `${dateCode}-${ticketId ? String(ticketId).padStart(4, "0") : "TAM"}`;

  return (
    <section className={`scale-print-sheet${preview ? " is-preview" : ""}`}>
      <header className="scale-print-header">
        <img src="/icon-192.png" alt="Logo Sơn Phú" />
        <div>
          <h1>XƯỞNG TÔN THÉP HỘP SƠN PHÚ</h1>
          <h2>TRẠM CÂN ĐIỆN TỬ 150 TẤN</h2>
          <p>QL1A, KCN Diễn Hồng - Xã Đức Châu - Tỉnh Nghệ An</p>
          <p>Điện thoại: 0862.250.969 &amp; 0949.250.969</p>
          <p>Số tài khoản: 0949.250.969 - BIDV</p>
        </div>
        <div className="scale-print-qr-placeholder">QR<br />THANH TOÁN</div>
      </header>

      <h3>PHIẾU CÂN XE</h3>
      <div className="scale-print-details">
        <p><span>Phiếu số:</span><strong>{ticketNumber}</strong></p>
        <p><span>Biển số xe:</span><strong>{form.plate || ""}</strong></p>
        <p><span>Khách hàng:</span><strong>{form.customer || ""}</strong></p>
        <p><span>Xuất/Nhập:</span><strong>{form.direction || ""}</strong></p>
        <p><span>Loại hàng:</span><strong>{form.goods || ""}</strong></p>
        <p><span>Ngày cân tổng:</span><strong>{formatPrintDate(captured.grossAt)}</strong></p>
        <p><span>Ngày cân bì:</span><strong>{formatPrintDate(captured.tareAt)}</strong></p>
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

function Field({ label, value, onChange }) {
  return (
    <div className="scale-field-row">
      <label>{label}</label>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
      <button type="button">Tìm</button>
    </div>
  );
}

function WeightRow({ label, value, action, captured = false, onAction }) {
  return (
    <div className="scale-weight-row">
      <span>{label}</span>
      <strong>{numberText(value)}</strong>
      {action ? (
        <button
          type="button"
          className={captured ? "is-captured" : ""}
          disabled={captured}
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
