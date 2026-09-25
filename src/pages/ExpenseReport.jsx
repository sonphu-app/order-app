import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import Header from "../components/Header";
import FilterBar from "../components/FilterBar";
import { supabase } from "../supabaseClient";
import { getCurrentUser } from "../utils/auth";
import { hasPermission, PERMISSIONS } from "../utils/permissions";
import AccountingLedger from "../components/AccountingLedger";
import { formatMoneyInput, parseMoneyInput } from "../utils/moneyInput";
import "../styles/expenseReport.css";

const currentMonth = () => new Date().toISOString().slice(0, 7);
const ACCOUNTING_VIEW_KEY = "sonphu-accounting-view";
const money = (value) => `${Number(value || 0).toLocaleString("vi-VN")}đ`;
const dayStart = () => { const value = new Date(); value.setHours(0, 0, 0, 0); return value; };
const dayEnd = () => { const value = dayStart(); value.setDate(value.getDate() + 1); return value; };
const orderTime = (row, view = "") => new Date(view === "checked"
  ? (row.accounting_checked_at || row.created_at || row.updated_at || 0)
  : (row.created_at || row.updated_at || 0));
let expenseReturnMemory = null;
const getPageScrollY = () => {
  const root = document.getElementById("root");
  return root ? root.scrollTop : window.scrollY || document.scrollingElement?.scrollTop || document.documentElement.scrollTop || document.body.scrollTop || 0;
};
const restorePageScrollY = (scrollY) => {
  const top = Number(scrollY) || 0;
  const root = document.getElementById("root");
  if (root) {
    root.scrollTo({ top, behavior: "auto" });
    return;
  }
  window.scrollTo({ top, behavior: "auto" });
};
const readExpenseReturn = () => { try { return (sessionStorage.getItem("expense-report-return") ? JSON.parse(sessionStorage.getItem("expense-report-return")) : null) || expenseReturnMemory || window.history.state?.accountingReturn || null; } catch { return expenseReturnMemory || window.history.state?.accountingReturn || null; } };
const saveExpenseReturn = (value) => { expenseReturnMemory = value; sessionStorage.setItem("expense-report-return", JSON.stringify(value)); window.history.replaceState({ ...window.history.state, accountingReturn: value }, ""); };
const readAccountingView = () => {
  try { return sessionStorage.getItem(ACCOUNTING_VIEW_KEY) || "report"; } catch { return "report"; }
};
const orderStatus = (row) => {
  if (row.accounting_cancelled) return "Đơn đã hủy";
  if (row.status === "new") return "Đơn mới";
  if (row.status === "delivered") return "Đã giao";
  if (row.status === "completed" && (row.delivered_at || row.deliveredAt)) return "Đã giao";
  if (row.status === "done" || row.status === "completed") return "Đã xong chưa giao";
  return row.status || "Chưa rõ";
};

export default function ExpenseReport() {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const returnPosition = readExpenseReturn();
  const [month, setMonth] = useState(currentMonth());
  const [expenses, setExpenses] = useState([]);
  const [items, setItems] = useState([]);
  const [piecework, setPiecework] = useState([]);
  const [payrollTotal, setPayrollTotal] = useState(0);
  const canViewAccounting = hasPermission(PERMISSIONS.VIEW_ACCOUNTING);
  const [accountingView, setAccountingView] = useState(() => location.state?.view === "checked" ? "checked" : location.state?.view === "orders" ? "orders" : location.state?.view === "ledger" && canViewAccounting ? "ledger" : returnPosition?.view === "ledger" && !canViewAccounting ? "report" : returnPosition?.view || readAccountingView());
  const [orders, setOrders] = useState([]);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderFilter, setOrderFilter] = useState("today");
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [checkOrder, setCheckOrder] = useState(null);
  const [checkTotalInput, setCheckTotalInput] = useState("");

  useEffect(() => {
    try { sessionStorage.setItem(ACCOUNTING_VIEW_KEY, accountingView); } catch { /* storage không bắt buộc */ }
  }, [accountingView]);

  const load = useCallback(async () => {
    const start = `${month}-01`;
    const endDate = new Date(`${start}T00:00:00`);
    endDate.setMonth(endDate.getMonth() + 1, 0);
    const end = endDate.toISOString().slice(0, 10);
    const { data: expenseRows } = await supabase.from("workshop_expenses").select("*").gte("expense_date", start).lte("expense_date", end).order("expense_date", { ascending: false });
    const activeExpenses = (expenseRows || []).filter((row) => row.status !== "CANCELLED");
    setExpenses(expenseRows || []);
    const ids = activeExpenses.map((row) => row.id);
    if (ids.length) {
      const { data: itemRows } = await supabase.from("workshop_expense_items").select("*, expense_categories(name)").in("expense_id", ids);
      setItems(itemRows || []);
    } else setItems([]);
    const { data: pieceworkRows } = await supabase.from("piecework_costs").select("*").gte("cost_date", start).lte("cost_date", end).neq("status", "CANCELLED");
    setPiecework(pieceworkRows || []);
    const { data: period } = await supabase.from("payroll_periods").select("id").eq("period_start", start).maybeSingle();
    if (period?.id) {
      const { data: details } = await supabase.from("payroll_details").select("net_amount").eq("payroll_period_id", period.id);
      setPayrollTotal((details || []).reduce((sum, row) => sum + Number(row.net_amount || 0), 0));
    } else setPayrollTotal(0);
  }, [month]);

  // Tải số liệu báo cáo khi đổi tháng.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (accountingView !== "orders" && accountingView !== "checked" && accountingView !== "ledger") return undefined;
    let active = true;
    // Chuyển sang mục Đơn thì bật trạng thái tải trước khi gọi dữ liệu.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrdersLoading(true);
    void supabase.from("orders").select("*").order("created_at", { ascending: true }).then(({ data }) => {
      if (active) setOrders((data || []).filter((row) => row.type !== "system_task" && row.type !== "system_message"));
    }).finally(() => {
      if (active) setOrdersLoading(false);
    });
    return () => { active = false; };
  }, [accountingView]);
  useEffect(() => {
    window.history.scrollRestoration = "manual";
    return undefined;
  }, []);
  useLayoutEffect(() => {
    if (navigationType !== "POP") return undefined;
    const pending = readExpenseReturn();
    if (!pending) return undefined;
    let frame = 0;
    let frameId = 0;
    const restore = () => {
      restorePageScrollY(pending.scrollY);
      frame += 1;
      if (frame < 4) frameId = window.requestAnimationFrame(restore);
    };
    frameId = window.requestAnimationFrame(restore);
    return () => window.cancelAnimationFrame(frameId);
  }, [location.key, location.pathname, navigationType]);
  useEffect(() => {
    if (!returnPosition || ordersLoading) return undefined;
    let frame = 0;
    let frameId = 0;
    const restore = () => {
      const card = returnPosition.orderId ? document.querySelector(`[data-accounting-order-id="${returnPosition.orderId}"]`) : null;
      if (returnPosition.scrollY != null) {
        restorePageScrollY(returnPosition.scrollY);
      } else if (card && returnPosition.cardOffset != null) {
        const top = getPageScrollY() + Number(returnPosition.cardOffset) - card.getBoundingClientRect().top;
        restorePageScrollY(top);
      } else {
        restorePageScrollY(returnPosition.scrollY);
      }
      frame += 1;
      if (frame < 4) frameId = window.requestAnimationFrame(restore);
      else {
        expenseReturnMemory = null;
        sessionStorage.removeItem("expense-report-return");
      }
    };
    frameId = window.requestAnimationFrame(restore);
    return () => window.cancelAnimationFrame(frameId);
  }, [returnPosition, ordersLoading]);
  const workshopTotal = useMemo(() => expenses.filter((row) => row.status !== "CANCELLED").reduce((sum, row) => sum + Number(row.total_amount || 0), 0), [expenses]);
  const pieceworkTotal = useMemo(() => piecework.reduce((sum, row) => sum + Number(row.total_amount || 0), 0), [piecework]);
  const byCategory = useMemo(() => items.reduce((map, item) => { const name = item.expense_categories?.name || "Khác"; map[name] = (map[name] || 0) + Number(item.amount || 0); return map; }, {}), [items]);
  const visibleAccountingOrders = useMemo(() => {
    const query = orderSearch.trim().toLocaleLowerCase("vi-VN");
    const today = dayStart();
    const tomorrow = dayEnd();
    const filtered = orders.filter((row) => {
      if (row.type === "system_task" || row.type === "system_message") return false;
      if (row.status === "new") return false;
      const hasAccountingTotal = Number(row.payment_breakdown?.total_amount || 0) > 0;
      if (accountingView === "orders" && row.accounting_checked && hasAccountingTotal) return false;
      if (accountingView === "checked" && (!row.accounting_checked || !hasAccountingTotal)) return false;
      if (!query) {
        const created = orderTime(row, accountingView);
        if (orderFilter === "today" && !(created >= today && created < tomorrow)) {
          // Đơn chưa kiểm tra vẫn phải giữ lại ở mục Đơn qua ngày hôm sau.
          const keepUnprocessedOrder = accountingView === "orders" && !row.accounting_checked;
          if (!keepUnprocessedOrder) return false;
        }
        if (orderFilter === "yesterday") {
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          if (!(created >= yesterday && created < today)) return false;
        }
        if (orderFilter === "7days") {
          const sevenDaysAgo = new Date(today);
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          if (created < sevenDaysAgo) return false;
        }
        if (orderFilter && typeof orderFilter === "object" && orderFilter.type === "custom") {
          const from = orderFilter.from ? new Date(`${orderFilter.from}T00:00:00`) : new Date(0);
          const to = orderFilter.to ? new Date(`${orderFilter.to}T23:59:59.999`) : dayEnd();
          if (created < from || created > to) return false;
        }
      } else {
        const text = [row.title, row.content, row.phone, row.customer_name, row.created_by_name]
          .filter(Boolean).join(" ").toLocaleLowerCase("vi-VN");
        if (!text.includes(query)) return false;
      }
      return true;
    });
    const displayRows = filtered.map((row) => {
      const hasAccountingTotal = Number(row.payment_breakdown?.total_amount || 0) > 0;
      if (row.accounting_checked && !hasAccountingTotal) return { ...row, accounting_checked: false };
      if (row.accounting_checked) return row;
      const paymentBreakdown = { ...(row.payment_breakdown || {}) };
      delete paymentBreakdown.total_amount;
      delete paymentBreakdown.total_amount_at;
      return { ...row, payment_breakdown: paymentBreakdown };
    });
    return displayRows.sort((a, b) => {
      const aCancelled = Boolean(a.accounting_cancelled);
      const bCancelled = Boolean(b.accounting_cancelled);
      if (aCancelled !== bCancelled) return aCancelled ? 1 : -1;
      const aTime = orderTime(a, accountingView).getTime();
      const bTime = orderTime(b, accountingView).getTime();
      if (accountingView === "orders") {
        const aOld = aTime < today.getTime();
        const bOld = bTime < today.getTime();
        // Đơn cũ chưa kiểm tra vẫn hiện, nhưng luôn nằm sau đơn mới.
        if (aOld !== bOld) return aOld ? 1 : -1;
      }
      return bTime - aTime;
    });
  }, [orders, orderSearch, orderFilter, accountingView]);

  const handleHeaderSearch = (value) => {
    setOrderSearch(value);
  };

  const markOrderChecked = async (order) => {
    const hasAccountingTotal = Number(order.payment_breakdown?.total_amount || 0) > 0;
    if ((order.accounting_checked && hasAccountingTotal) || !hasPermission(PERMISSIONS.CHECK_ACCOUNTING_ORDER)) return;
    setCheckOrder(order);
    setCheckTotalInput(formatMoneyInput(order.payment_breakdown?.total_amount || ""));
  };

  const confirmOrderChecked = async () => {
    if (!checkOrder) return;
    const total = Math.max(0, Math.round(parseMoneyInput(checkTotalInput)));
    if (!total) {
      window.alert("Vui lòng nhập tổng tiền trước khi chuyển sang HT.");
      return;
    }
    const order = checkOrder;
    const user = getCurrentUser();
    const checkedAt = new Date().toISOString();
    const checkedByName = user?.name || user?.username || "";
    const nextPaymentBreakdown = {
      ...(order.payment_breakdown || {}),
      total_amount: total,
      total_amount_at: checkedAt,
    };
    const { data, error } = await supabase.from("orders").update({
      accounting_checked: true,
      accounting_checked_at: checkedAt,
      accounting_checked_by_name: checkedByName,
      payment_breakdown: nextPaymentBreakdown,
    }).eq("id", order.id).select("*").single();
    if (error) {
      window.alert(`Không thể ghi trạng thái đã kiểm tra: ${error.message}`);
      return;
    }
    const checkedOrder = {
      ...(data || order),
      accounting_checked: true,
      accounting_checked_at: checkedAt,
      accounting_checked_by_name: checkedByName,
      payment_breakdown: nextPaymentBreakdown,
    };
    setOrders((current) => current.map((row) => row.id === order.id ? checkedOrder : row));
    setCheckOrder(null);
    setCheckTotalInput("");
    setAccountingView("checked");
  };

  const uncheckOrder = async (order) => {
    if (!order.accounting_checked || !hasPermission(PERMISSIONS.CHECK_ACCOUNTING_ORDER)) return;
    const paymentBreakdown = {
      ...(order.payment_breakdown || {}),
    };
    delete paymentBreakdown.total_amount;
    delete paymentBreakdown.total_amount_at;
    const { data, error } = await supabase.from("orders").update({
      accounting_checked: false,
      accounting_checked_at: null,
      accounting_checked_by_name: null,
      payment_breakdown: paymentBreakdown,
    }).eq("id", order.id).select("*").single();
    if (error) {
      window.alert(`Không thể đưa đơn về mục Đơn: ${error.message}`);
      return;
    }
    const uncheckedOrder = {
      ...(data || order),
      accounting_checked: false,
      accounting_checked_at: null,
      accounting_checked_by_name: null,
      payment_breakdown: paymentBreakdown,
    };
    setOrders((current) => current.map((row) => row.id === order.id ? uncheckedOrder : row));
    setAccountingView("orders");
  };

  const renderAccountingOrder = (order, index) => {
    if (order.accounting_cancelled) {
      const openOrder = (event) => {
        saveExpenseReturn({ view: accountingView, orderId: order.id, scrollY: getPageScrollY(), cardOffset: getPageScrollY() + event.currentTarget.getBoundingClientRect().top });
        navigate("/order/" + order.id, { state: { fromAccounting: accountingView === "orders", accountingView }, preventScrollReset: true });
      };
      return <article key={order.id} data-accounting-order-id={order.id} style={styles.cancelledOrderCard} role="button" tabIndex={0} aria-label="Đã hủy đơn" onClick={openOrder} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openOrder(event); } }}>
        <div style={styles.cancelledOrderContent}>
          <strong style={styles.cancelledOrderLabel}>ĐÃ HỦY ĐƠN</strong>
          <span style={styles.cancelledOrderTitle}>{order.title || "Đơn hàng"}</span>
        </div>
      </article>;
    }
    return <article key={order.id} data-accounting-order-id={order.id} style={styles.orderCard} role="button" tabIndex={0} onClick={(event) => { saveExpenseReturn({ view: accountingView, orderId: order.id, scrollY: getPageScrollY(), cardOffset: getPageScrollY() + event.currentTarget.getBoundingClientRect().top }); navigate("/order/" + order.id, { state: { fromAccounting: accountingView === "orders", accountingView }, preventScrollReset: true }); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { saveExpenseReturn({ view: accountingView, orderId: order.id, scrollY: getPageScrollY(), cardOffset: getPageScrollY() + event.currentTarget.getBoundingClientRect().top }); navigate("/order/" + order.id, { state: { fromAccounting: accountingView === "orders", accountingView }, preventScrollReset: true }); } }}><div style={styles.orderCardTop}><span style={styles.orderNumber}>STT {visibleAccountingOrders.length - index}</span>{hasPermission(PERMISSIONS.CHECK_ACCOUNTING_ORDER) && <button type="button" onClick={(event) => { event.stopPropagation(); void (accountingView === "checked" ? uncheckOrder(order) : markOrderChecked(order)); }} disabled={accountingView === "orders" && order.accounting_checked} style={{ ...styles.checkButton, ...(order.accounting_checked ? styles.checkButtonDone : {}) }}>{accountingView === "checked" ? "Kiểm tra lại" : "Đã kiểm tra"}</button>}<span>{orderStatus(order)}</span></div><div style={styles.orderTitle}>{order.order_number ? `Đơn số: ${order.order_number} · ` : ""}{order.title || "Đơn hàng"}</div><div style={styles.orderContent}>{order.content || "Không có nội dung"}</div><div style={styles.orderMeta}>{accountingView === "checked" ? `Đã kiểm tra lúc ${new Date(order.accounting_checked_at || order.created_at || order.updated_at || 0).toLocaleString("vi-VN")}` : new Date(order.created_at || order.updated_at || 0).toLocaleString("vi-VN")} · {order.created_by_name || "Không rõ"}{order.phone ? ` · ${order.phone}` : ""}</div>{Number(order.payment_breakdown?.total_amount || 0) > 0 && <div style={styles.orderTotal}>Tổng tiền: {money(order.payment_breakdown.total_amount)}</div>}</article>;
  };

  return <div style={styles.page}><Header searchValue={accountingView === "orders" || accountingView === "checked" || accountingView === "ledger" ? orderSearch : ""} onSearchChange={handleHeaderSearch} /><main style={styles.main}>
    {accountingView === "ledger" && canViewAccounting ? <><FilterBar value={orderFilter} onChange={setOrderFilter} /><AccountingLedger search={orderSearch} filter={orderFilter} /></> : accountingView === "orders" || accountingView === "checked" ? <>
      <FilterBar value={orderFilter} onChange={setOrderFilter} />
      {ordersLoading && <div style={styles.muted}>Đang tải đơn...</div>}
      <section style={styles.orderList}>{visibleAccountingOrders.map(renderAccountingOrder)}{!ordersLoading && !visibleAccountingOrders.length && <div style={styles.muted}>Không có đơn phù hợp.</div>}</section>
    </> : <>
      <div style={styles.titleRow}><div><h1 style={styles.title}>Báo cáo chi phí</h1><div style={styles.muted}>Tổng tháng · phiếu đã hủy không tính</div></div><div style={styles.actions}><button type="button" onClick={() => navigate("/expenses")} style={styles.secondary}>Chi phí xưởng</button><button type="button" onClick={() => navigate("/payroll")} style={styles.secondary}>Bảng lương</button></div></div>
      <section style={styles.card}><label style={styles.field}><span>Tháng báo cáo</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} style={styles.input} /></label><div style={styles.summary}><Box label="Chi phí xưởng" value={workshopTotal} /><Box label="Chi phí công khoán" value={pieceworkTotal} /><Box label="Tổng lương tháng" value={payrollTotal} /></div></section>
      <section style={styles.card}><h2 style={styles.heading}>Theo hạng mục</h2><div style={styles.list}>{Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([name, value]) => <div key={name} style={styles.row}><b>{name}</b><strong>{money(value)}</strong></div>)}{Object.keys(byCategory).length === 0 && <div style={styles.muted}>Chưa có chi phí trong tháng.</div>}</div></section>
      <section style={styles.card}><h2 style={styles.heading}>Phiếu trong tháng</h2><div style={styles.list}>{expenses.map((expense) => <div key={expense.id} style={styles.row}><span>{expense.expense_date} · {expense.status === "CANCELLED" ? "ĐÃ HỦY" : "ĐANG DÙNG"}</span><strong style={{ color: expense.status === "CANCELLED" ? "#999" : "inherit" }}>{money(expense.total_amount)}</strong></div>)}</div></section>
    </>}
  </main>{checkOrder && <div style={styles.modalOverlay}><div style={styles.modal}><h2 style={styles.heading}>Tổng tiền</h2><div style={styles.muted}>{checkOrder.order_number ? `Đơn số ${checkOrder.order_number} · ` : ""}{checkOrder.title || "Đơn hàng"}</div><input autoFocus inputMode="decimal" placeholder="Nhập đầy đủ tổng tiền" value={checkTotalInput} onChange={(event) => setCheckTotalInput(event.target.value)} style={styles.input} /><div style={{ ...styles.actions, justifyContent: "flex-end", marginTop: 12 }}><button type="button" onClick={() => setCheckOrder(null)} style={styles.secondary}>Hủy</button><button type="button" onClick={() => void confirmOrderChecked()} style={styles.searchButton}>Đồng ý</button></div></div></div>}<nav style={{ ...styles.bottomNav, gridTemplateColumns: canViewAccounting ? "repeat(3, minmax(0, 1fr))" : "repeat(2, minmax(0, 1fr))" }} aria-label="Điều hướng kế toán"><button type="button" onClick={() => setAccountingView("orders")} style={{ ...styles.bottomButton, ...(accountingView === "orders" ? styles.bottomButtonActive : {}) }}>Đơn</button><button type="button" onClick={() => setAccountingView("checked")} style={{ ...styles.bottomButton, ...(accountingView === "checked" ? styles.bottomButtonActive : {}) }}>HT</button>{canViewAccounting && <button type="button" onClick={() => setAccountingView("ledger")} style={{ ...styles.bottomButton, ...(accountingView === "ledger" ? styles.bottomButtonActive : {}) }}>TK</button>}</nav></div>;
}
function Box({ label, value }) { return <div style={styles.box}><strong>{money(value)}</strong><span>{label}</span></div>; }
const styles = { page: { minHeight: "100dvh", background: "#f5efe3", color: "#3d2b1b", paddingBottom: "calc(86px + env(safe-area-inset-bottom))" }, main: { maxWidth: 1100, margin: "0 auto", padding: 16 }, titleRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }, title: { margin: "18px 0 4px", color: "#5b3716" }, heading: { margin: "0 0 12px", color: "#5b3716", fontSize: 21 }, muted: { color: "#745b3d" }, card: { background: "#fffaf0", border: "1px solid #d8b36a", borderRadius: 14, padding: 16, marginTop: 16 }, field: { display: "grid", gap: 5, fontWeight: 700, maxWidth: 260 }, input: { width: "100%", boxSizing: "border-box", padding: "10px 11px", borderRadius: 10, border: "1px solid #d1aa62", background: "white", color: "#3d2b1b", fontSize: 16 }, summary: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginTop: 14 }, box: { display: "grid", gap: 4, padding: 12, borderRadius: 10, background: "#fff3d6", border: "1px solid #ecd4a4" }, actions: { display: "flex", gap: 8, flexWrap: "wrap" }, secondary: { padding: "9px 12px", borderRadius: 10, border: "1px solid #d1aa62", background: "#fff3d6", color: "#4d3218", fontWeight: 700, cursor: "pointer" }, searchBar: { display: "flex", gap: 8, marginTop: 16 }, searchInput: { flex: 1 }, searchButton: { padding: "10px 16px", border: "1px solid #c88b1f", borderRadius: 10, background: "#d3a13f", color: "#3d260d", fontWeight: 800, cursor: "pointer" }, orderList: { display: "grid", gap: 10, marginTop: 16 }, orderCard: { background: "#fffaf0", border: "1px solid #d8b36a", borderRadius: 12, padding: 13 }, cancelledOrderCard: { width: "min(100%, 430px)", justifySelf: "center", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 46, padding: "8px 12px", background: "#fff0ee", border: "2px solid #c0392b", borderRadius: 12, color: "#b42318" }, cancelledOrderContent: { display: "grid", gap: 3, justifyItems: "center", textAlign: "center" }, cancelledOrderLabel: { fontSize: 17, fontWeight: 950, letterSpacing: ".04em" }, cancelledOrderTitle: { color: "#5b3716", fontSize: 16, fontWeight: 750, overflowWrap: "anywhere" }, orderCardTop: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", color: "#5b3716" }, orderNumber: { display: "inline-flex", padding: "2px 6px", borderRadius: 6, background: "#f2d58f", color: "#5b3716", fontSize: 13, fontWeight: 900 }, checkButton: { padding: "3px 7px", borderRadius: 6, border: "1px solid #d1aa62", background: "#fff3d6", color: "#4d3218", fontSize: 12, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }, checkButtonDone: { background: "#d9f1df", borderColor: "#70ad7b", color: "#216b2d", cursor: "default" }, orderTitle: { marginTop: 8, fontWeight: 800, color: "#5b3716" }, orderContent: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 6, fontSize: 17 }, orderMeta: { marginTop: 9, color: "#745b3d", fontSize: 14 }, orderTotal: { marginTop: 8, paddingTop: 6, borderTop: "1px solid #ecd4a4", color: "#5b3716", fontSize: 17, fontWeight: 800 }, notice: { marginTop: 14, padding: 12, borderRadius: 10, background: "#eafff4", border: "1px solid #64b995", color: "#075b3a", fontWeight: 700 }, list: { display: "grid", gap: 7 }, row: { display: "flex", justifyContent: "space-between", gap: 10, padding: "9px 10px", borderRadius: 9, background: "#fff3d6", border: "1px solid #ecd4a4" }, modalOverlay: { position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", padding: 16, background: "rgba(30,20,10,.45)" }, modal: { width: "min(460px, 100%)", boxSizing: "border-box", padding: 16, borderRadius: 14, background: "#fffaf0", boxShadow: "0 12px 36px rgba(0,0,0,.28)" }, bottomNav: { position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 25, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, padding: "6px 8px calc(6px + env(safe-area-inset-bottom))", background: "#fff7e6", borderTop: "1px solid #d8b36a", boxShadow: "0 -3px 12px rgba(91,55,22,.12)" }, bottomButton: { minHeight: 46, border: "1px solid #d1aa62", borderRadius: 10, background: "#fff3d6", color: "#4d3218", fontSize: 17, fontWeight: 800, cursor: "pointer" }, bottomButtonActive: { background: "#f2d58f", borderColor: "#a8731f" } };
