import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Home, RefreshCw, Wallet, TrendingUp, Bell, Pause, Play, Edit2, Trash2,
  Plus, X, ChevronRight, ChevronLeft, AlertCircle, Loader2, Check,
  Calendar as CalendarIcon, List, History as HistoryIcon, PieChart as PieChartIcon
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const EXPENSE_CATEGORIES = ["食費", "日用品", "買い物", "交通費", "住居", "光熱費", "通信費", "娯楽", "医療", "その他"];
const INCOME_CATEGORIES = ["給与", "ボーナス", "副業", "お小遣い", "投資収益", "その他"];
const SUB_CATEGORIES = ["動画配信", "音楽", "ニュース・雑誌", "クラウド・ソフト", "フィットネス", "ゲーム", "その他"];

const UNIT_LABEL = { day: "日", week: "週間", month: "ヶ月", year: "年" };
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

const ASSET_TYPES = [
  { key: "domestic_stock", label: "国内株式現物" },
  { key: "us_stock", label: "米国株式現物" },
  { key: "mutual_fund", label: "投資信託" },
  { key: "cash_deposit", label: "預かり金等現金" },
];

const PALETTE = ["#1B2A4A", "#A2793F", "#2F6E4E", "#AE4A3A", "#5B6B85", "#8A6BAE", "#3E8FA3", "#B08D57", "#6B7F4F", "#9C5B6E"];

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const pad2 = (n) => String(n).padStart(2, "0");
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const fmtYen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString("ja-JP")}`;
const fmtDate = (s) => {
  if (!s) return "-";
  const d = new Date(s + "T00:00:00");
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};
const daysBetween = (fromStr, toStr) => {
  const a = new Date(fromStr + "T00:00:00");
  const b = new Date(toStr + "T00:00:00");
  return Math.round((b - a) / 86400000);
};
const addDays = (dateStr, n) => {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

function addInterval(dateStr, value, unit) {
  const d = new Date(dateStr + "T00:00:00");
  const v = Number(value) || 1;
  if (unit === "day") d.setDate(d.getDate() + v);
  else if (unit === "week") d.setDate(d.getDate() + v * 7);
  else if (unit === "month") d.setMonth(d.getMonth() + v);
  else if (unit === "year") d.setFullYear(d.getFullYear() + v);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function intervalLabel(sub) {
  return `${sub.intervalValue}${UNIT_LABEL[sub.intervalUnit]}ごと`;
}

// approximate monthly-equivalent cost, used only as a rough estimate on the home tab
function monthlyEquivalent(sub) {
  const v = Number(sub.intervalValue) || 1;
  let months;
  if (sub.intervalUnit === "day") months = v / 30;
  else if (sub.intervalUnit === "week") months = (v * 7) / 30;
  else if (sub.intervalUnit === "month") months = v;
  else months = v * 12;
  return months > 0 ? Number(sub.amount) / months : 0;
}

// the next date a subscription is due, based on what has already been recorded as paid
function getNextPaymentDate(sub) {
  return sub.lastRecordedDate ? addInterval(sub.lastRecordedDate, sub.intervalValue, sub.intervalUnit) : sub.firstPaymentDate;
}

// walk each active subscription forward from its last recorded payment (or first payment
// date) and record a payment-history entry for every occurrence that has come due.
// paused subscriptions are frozen: nothing is recorded and their next date does not move,
// so re-using a free trial repeatedly never creates duplicate subscriptions or history.
function accrueAll(subs, today) {
  const historyAdded = [];
  const newSubs = subs.map((s) => {
    if (s.status !== "active") return s;
    let cursor = s.lastRecordedDate ? addInterval(s.lastRecordedDate, s.intervalValue, s.intervalUnit) : s.firstPaymentDate;
    let last = s.lastRecordedDate;
    let guard = 0;
    while (cursor <= today && guard < 1000) {
      historyAdded.push({ id: uid(), subscriptionId: s.id, name: s.name, category: s.category, amount: Number(s.amount), date: cursor });
      last = cursor;
      cursor = addInterval(cursor, s.intervalValue, s.intervalUnit);
      guard++;
    }
    return last !== s.lastRecordedDate ? { ...s, lastRecordedDate: last } : s;
  });
  return { newSubs, historyAdded };
}

/* ------------------------------------------------------------------ */
/* Storage helpers (browser localStorage)                              */
/* ------------------------------------------------------------------ */

const STORAGE_PREFIX = "household-ledger:";

async function loadKey(key, fallback) {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (raw != null) return JSON.parse(raw);
    return fallback;
  } catch {
    return fallback;
  }
}
async function saveKey(key, value) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Root App                                                            */
/* ------------------------------------------------------------------ */

export default function App() {
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("home");
  const [subTab, setSubTab] = useState("list"); // list | history | analysis
  const [subs, setSubs] = useState([]);
  const [history, setHistory] = useState([]);
  const [txns, setTxns] = useState([]);
  const [assets, setAssets] = useState(() => {
    const o = {};
    ASSET_TYPES.forEach((t) => (o[t.key] = { valuation: 0, gainLoss: 0 }));
    return o;
  });
  const [subModal, setSubModal] = useState(null); // {mode:'new'|'edit'|'resume', data}
  const [txnModal, setTxnModal] = useState(null); // {type, date}
  const [saveError, setSaveError] = useState("");

  const today = todayStr();

  useEffect(() => {
    (async () => {
      const [rawSubs, t, a, h] = await Promise.all([
        loadKey("subscriptions", []),
        loadKey("transactions", []),
        loadKey("assets", null),
        loadKey("paymentHistory", []),
      ]);
      // migrate older records that used "paymentDate" as the anchor field name
      const migrated = rawSubs.map((s) => ({
        ...s,
        firstPaymentDate: s.firstPaymentDate || s.paymentDate || todayStr(),
      }));
      const { newSubs, historyAdded } = accrueAll(migrated, todayStr());
      const newHistory = historyAdded.length ? [...historyAdded, ...h] : h;
      setSubs(newSubs);
      setHistory(newHistory);
      setTxns(t);
      if (a) setAssets(a);
      setLoading(false);
      saveKey("subscriptions", newSubs);
      if (historyAdded.length) saveKey("paymentHistory", newHistory);
    })();
  }, []);

  const enrichedSubs = useMemo(() => {
    return subs
      .map((s) => ({ ...s, nextPaymentDate: getNextPaymentDate(s) }))
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "active" ? -1 : 1;
        return a.nextPaymentDate < b.nextPaymentDate ? -1 : 1;
      });
  }, [subs]);

  const remindingSubs = useMemo(() => {
    return enrichedSubs.filter((s) => {
      if (s.status !== "active") return false;
      const d = daysBetween(today, s.nextPaymentDate);
      return d >= 0 && d <= (Number(s.reminderDays) || 0);
    });
  }, [enrichedSubs, today]);

  const activeMonthlyEstimate = useMemo(
    () => enrichedSubs.filter((s) => s.status === "active").reduce((sum, s) => sum + monthlyEquivalent(s), 0),
    [enrichedSubs]
  );

  const thisMonthKey = today.slice(0, 7);
  const monthTxns = useMemo(() => txns.filter((t) => t.date.slice(0, 7) === thisMonthKey), [txns, thisMonthKey]);
  const monthIncome = useMemo(() => monthTxns.filter((t) => t.type === "income").reduce((s, t) => s + Number(t.amount), 0), [monthTxns]);
  const monthExpense = useMemo(() => monthTxns.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0), [monthTxns]);
  const monthSubHistory = useMemo(() => history.filter((h) => h.date.slice(0, 7) === thisMonthKey), [history, thisMonthKey]);
  const monthSubActual = useMemo(() => monthSubHistory.reduce((s, h) => s + Number(h.amount), 0), [monthSubHistory]);
  const freeMoney = monthIncome - monthExpense - monthSubActual;

  const assetValuationTotal = useMemo(() => ASSET_TYPES.reduce((s, t) => s + (Number(assets[t.key]?.valuation) || 0), 0), [assets]);
  const assetGainLossTotal = useMemo(() => ASSET_TYPES.reduce((s, t) => s + (Number(assets[t.key]?.gainLoss) || 0), 0), [assets]);

  const applyAccrual = useCallback((rawSubs, baseHistory) => {
    const { newSubs, historyAdded } = accrueAll(rawSubs, todayStr());
    const newHistory = historyAdded.length ? [...historyAdded, ...baseHistory] : baseHistory;
    return { newSubs, newHistory };
  }, []);

  const commitSubs = useCallback(
    async (rawSubs) => {
      const { newSubs, newHistory } = applyAccrual(rawSubs, history);
      setSubs(newSubs);
      setHistory(newHistory);
      const ok1 = await saveKey("subscriptions", newSubs);
      const ok2 = await saveKey("paymentHistory", newHistory);
      if (!ok1 || !ok2) setSaveError("サブスクの保存に失敗しました。もう一度お試しください。");
    },
    [history, applyAccrual]
  );

  const persistHistory = useCallback(async (next) => {
    setHistory(next);
    const ok = await saveKey("paymentHistory", next);
    if (!ok) setSaveError("支払い履歴の保存に失敗しました。もう一度お試しください。");
  }, []);

  const persistTxns = useCallback(async (next) => {
    setTxns(next);
    const ok = await saveKey("transactions", next);
    if (!ok) setSaveError("収支の保存に失敗しました。もう一度お試しください。");
  }, []);
  const persistAssets = useCallback(async (next) => {
    setAssets(next);
    const ok = await saveKey("assets", next);
    if (!ok) setSaveError("資産情報の保存に失敗しました。もう一度お試しください。");
  }, []);

  const saveSub = (data) => {
    if (data.id) {
      commitSubs(subs.map((s) => (s.id === data.id ? { ...s, ...data, status: data.status || s.status, lastRecordedDate: null } : s)));
    } else {
      commitSubs([...subs, { ...data, id: uid(), status: "active", lastRecordedDate: null }]);
    }
    setSubModal(null);
  };
  const deleteSub = (id) => commitSubs(subs.filter((s) => s.id !== id));
  const togglePause = (sub) => {
    if (sub.status === "active") {
      commitSubs(subs.map((s) => (s.id === sub.id ? { ...s, status: "paused", pausedAt: today } : s)));
    } else {
      // resume: open edit modal so the user can confirm/adjust the next payment date.
      // the subscription keeps the same id, so it is still recognized as the same one.
      setSubModal({ mode: "resume", data: { ...sub, status: "active", firstPaymentDate: today } });
    }
  };
  const deleteHistoryEntry = (id) => {
    if (confirm("この支払い履歴を削除しますか？")) persistHistory(history.filter((h) => h.id !== id));
  };

  const saveTxn = (data) => {
    persistTxns([{ ...data, id: uid() }, ...txns]);
    setTxnModal(null);
  };
  const deleteTxn = (id) => persistTxns(txns.filter((t) => t.id !== id));

  return (
    <div className="min-h-screen w-full">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b" style={{ borderColor: "var(--rule)", background: "var(--paper)" }}>
        <div className="max-w-5xl mx-auto px-4 pt-5 pb-3">
          <div className="flex items-baseline justify-between">
            <h1 className="serif text-2xl md:text-3xl font-bold tracking-wide" style={{ color: "var(--ink)" }}>家計ノート</h1>
            <span className="mono text-xs" style={{ color: "var(--ink-soft)" }}>{fmtDate(today)}</span>
          </div>
          <p className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>収支・サブスク・資産をひとつの通帳で管理</p>
        </div>
        <nav className="max-w-5xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {[
            { id: "home", label: "ホーム", icon: Home },
            { id: "subs", label: "サブスク", icon: RefreshCw, badge: remindingSubs.length },
            { id: "calendar", label: "カレンダー", icon: CalendarIcon },
            { id: "txns", label: "収支", icon: Wallet },
            { id: "assets", label: "資産", icon: TrendingUp },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="relative flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium whitespace-nowrap"
                style={{
                  color: active ? "var(--ink)" : "var(--ink-soft)",
                  borderBottom: active ? "2px solid var(--brass)" : "2px solid transparent",
                }}
              >
                <Icon size={15} />
                {t.label}
                {!!t.badge && (
                  <span className="mono ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full text-white" style={{ background: "var(--clay)" }}>
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-24" style={{ color: "var(--ink-soft)" }}>
            <Loader2 className="animate-spin mr-2" size={18} /> 読み込み中…
          </div>
        ) : (
          <>
            {saveError && (
              <div className="mb-4 flex items-center gap-2 text-sm px-3 py-2 rounded" style={{ background: "var(--clay-soft)", color: "var(--clay)" }}>
                <AlertCircle size={15} /> {saveError}
                <button className="ml-auto underline" onClick={() => setSaveError("")}>閉じる</button>
              </div>
            )}
            {tab === "home" && (
              <HomeTab
                freeMoney={freeMoney}
                monthIncome={monthIncome}
                monthExpense={monthExpense}
                monthSubActual={monthSubActual}
                activeMonthlyEstimate={activeMonthlyEstimate}
                assetValuationTotal={assetValuationTotal}
                assetGainLossTotal={assetGainLossTotal}
                remindingSubs={remindingSubs}
                today={today}
                goSubs={() => setTab("subs")}
              />
            )}
            {tab === "subs" && (
              <SubsTab
                subTab={subTab}
                setSubTab={setSubTab}
                subs={enrichedSubs}
                history={history}
                today={today}
                activeMonthlyEstimate={activeMonthlyEstimate}
                onAdd={() => setSubModal({ mode: "new", data: null })}
                onEdit={(s) => setSubModal({ mode: "edit", data: s })}
                onDelete={deleteSub}
                onTogglePause={togglePause}
                onDeleteHistory={deleteHistoryEntry}
              />
            )}
            {tab === "calendar" && (
              <CalendarTab subs={enrichedSubs} history={history} txns={txns} today={today} onAddTxn={(type, date) => setTxnModal({ type, date })} />
            )}
            {tab === "txns" && (
              <TxnsTab
                txns={txns}
                monthIncome={monthIncome}
                monthExpense={monthExpense}
                freeMoney={freeMoney}
                onAdd={(type) => setTxnModal({ type, date: today })}
                onDelete={deleteTxn}
              />
            )}
            {tab === "assets" && (
              <AssetsTab assets={assets} onSave={persistAssets} totalValuation={assetValuationTotal} totalGainLoss={assetGainLossTotal} />
            )}
          </>
        )}
      </main>

      {subModal && <SubModal mode={subModal.mode} initial={subModal.data} onCancel={() => setSubModal(null)} onSave={saveSub} />}
      {txnModal && (
        <TxnModal type={txnModal.type} defaultDate={txnModal.date || today} onCancel={() => setTxnModal(null)} onSave={saveTxn} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Home                                                                 */
/* ------------------------------------------------------------------ */

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="rounded-lg p-4" style={{ background: "var(--paper-alt)", border: "1px solid var(--rule)" }}>
      <div className="text-xs" style={{ color: "var(--ink-soft)" }}>{label}</div>
      <div className="mono text-2xl font-bold mt-1" style={{ color: accent || "var(--ink)" }}>{value}</div>
      {sub && <div className="text-[11px] mt-1" style={{ color: "var(--ink-soft)" }}>{sub}</div>}
    </div>
  );
}

function HomeTab({ freeMoney, monthIncome, monthExpense, monthSubActual, activeMonthlyEstimate, assetValuationTotal, assetGainLossTotal, remindingSubs, today, goSubs }) {
  return (
    <div className="space-y-6">
      <section>
        <div className="rounded-xl p-5 perforated" style={{ background: "var(--ink)", color: "white" }}>
          <div className="text-xs opacity-70">今月 自由に使えるお金（サブスク支払い込み・株式等は除く）</div>
          <div className="mono text-4xl font-bold mt-1">{fmtYen(freeMoney)}</div>
          <div className="flex gap-4 mt-3 text-xs opacity-80 flex-wrap">
            <span>収入 {fmtYen(monthIncome)}</span>
            <span>支出 {fmtYen(monthExpense)}</span>
            <span>サブスク {fmtYen(monthSubActual)}</span>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <StatCard label="サブスク月換算（見込み・稼働中）" value={fmtYen(activeMonthlyEstimate)} sub="実際の支払額は支払い履歴に記録されます" />
        <div className="rounded-lg p-4" style={{ background: "var(--brass-soft)", border: "1px solid var(--brass)" }}>
          <div className="text-xs" style={{ color: "var(--brass)" }}>資産評価額（自由に使えるお金には含みません）</div>
          <div className="mono text-2xl font-bold mt-1" style={{ color: "var(--ink)" }}>{fmtYen(assetValuationTotal)}</div>
          <div className="text-[11px] mt-1 mono" style={{ color: assetGainLossTotal >= 0 ? "var(--green)" : "var(--clay)" }}>
            評価損益 {assetGainLossTotal >= 0 ? "+" : ""}{fmtYen(assetGainLossTotal)}
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold flex items-center gap-1.5" style={{ color: "var(--ink)" }}>
            <Bell size={15} /> 支払いリマインド
          </h2>
          <button onClick={goSubs} className="text-xs flex items-center gap-0.5" style={{ color: "var(--brass)" }}>
            サブスク一覧 <ChevronRight size={13} />
          </button>
        </div>
        {remindingSubs.length === 0 ? (
          <div className="text-sm rounded-lg p-4" style={{ background: "var(--paper-alt)", border: "1px dashed var(--rule)", color: "var(--ink-soft)" }}>
            今のところ近づいている支払いはありません。
          </div>
        ) : (
          <div className="space-y-2">
            {remindingSubs.map((s) => {
              const d = daysBetween(today, s.nextPaymentDate);
              return (
                <div key={s.id} className="flex items-center justify-between rounded-lg px-4 py-3" style={{ background: "var(--clay-soft)", border: "1px solid var(--clay)" }}>
                  <div>
                    <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>{s.name}</div>
                    <div className="text-xs" style={{ color: "var(--ink-soft)" }}>{fmtDate(s.nextPaymentDate)} 支払い予定</div>
                  </div>
                  <div className="text-right">
                    <div className="mono font-bold" style={{ color: "var(--clay)" }}>{d === 0 ? "本日" : `あと${d}日`}</div>
                    <div className="mono text-xs" style={{ color: "var(--ink-soft)" }}>{fmtYen(s.amount)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Subscriptions (list / history / analysis)                            */
/* ------------------------------------------------------------------ */

function SegButton({ active, onClick, icon: Icon, label, badge }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-2 rounded-md"
      style={{ background: active ? "var(--ink)" : "transparent", color: active ? "white" : "var(--ink-soft)" }}
    >
      <Icon size={13} /> {label}
      {!!badge && (
        <span className="mono text-[9px] px-1 rounded-full text-white" style={{ background: "var(--clay)" }}>{badge}</span>
      )}
    </button>
  );
}

function SubsTab({ subTab, setSubTab, subs, history, today, activeMonthlyEstimate, onAdd, onEdit, onDelete, onTogglePause, onDeleteHistory }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="serif text-lg font-bold" style={{ color: "var(--ink)" }}>サブスクリプション</h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--ink-soft)" }}>月換算の見込み <span className="mono font-bold">{fmtYen(activeMonthlyEstimate)}</span></p>
        </div>
        {subTab === "list" && (
          <button onClick={onAdd} className="flex items-center gap-1 text-sm font-bold px-3.5 py-2 rounded-lg text-white" style={{ background: "var(--ink)" }}>
            <Plus size={15} /> 追加
          </button>
        )}
      </div>

      <div className="flex gap-1 p-1 rounded-lg mb-4" style={{ background: "var(--paper-alt)", border: "1px solid var(--rule)" }}>
        <SegButton active={subTab === "list"} onClick={() => setSubTab("list")} icon={List} label="一覧" />
        <SegButton active={subTab === "history"} onClick={() => setSubTab("history")} icon={HistoryIcon} label="支払い履歴" />
        <SegButton active={subTab === "analysis"} onClick={() => setSubTab("analysis")} icon={PieChartIcon} label="分析" />
      </div>

      {subTab === "list" && (
        <SubsList subs={subs} today={today} onEdit={onEdit} onDelete={onDelete} onTogglePause={onTogglePause} />
      )}
      {subTab === "history" && <SubsHistory history={history} onDelete={onDeleteHistory} />}
      {subTab === "analysis" && <SubsAnalysis history={history} today={today} />}
    </div>
  );
}

function SubsList({ subs, today, onEdit, onDelete, onTogglePause }) {
  if (subs.length === 0) return <EmptyState text="登録されているサブスクはありません。「追加」から登録してください。" />;
  return (
    <div className="space-y-2.5">
      {subs.map((s) => {
        const paused = s.status === "paused";
        const d = daysBetween(today, s.nextPaymentDate);
        const reminding = !paused && d >= 0 && d <= (Number(s.reminderDays) || 0);
        return (
          <div
            key={s.id}
            className="rounded-lg p-4"
            style={{
              background: paused ? "var(--paper)" : "var(--paper-alt)",
              border: `1px solid ${reminding ? "var(--clay)" : "var(--rule)"}`,
              opacity: paused ? 0.65 : 1,
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm" style={{ color: "var(--ink)" }}>{s.name}</span>
                  {s.category && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--brass-soft)", color: "var(--brass)" }}>{s.category}</span>
                  )}
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                    style={{ background: paused ? "var(--rule)" : "var(--green-soft)", color: paused ? "var(--ink-soft)" : "var(--green)" }}
                  >
                    {paused ? "停止中" : "稼働中"}
                  </span>
                </div>
                <div className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>
                  {intervalLabel(s)} ・ 初回 {fmtDate(s.firstPaymentDate)} ・ リマインド{s.reminderDays}日前
                </div>
                {s.memo && <div className="text-xs mt-1 truncate" style={{ color: "var(--ink-soft)" }}>{s.memo}</div>}
              </div>
              <div className="text-right shrink-0">
                <div className="mono font-bold text-lg" style={{ color: "var(--ink)" }}>{fmtYen(s.amount)}</div>
                <div className="text-xs mt-0.5" style={{ color: reminding ? "var(--clay)" : "var(--ink-soft)" }}>
                  {paused ? `次回(仮) ${fmtDate(s.nextPaymentDate)}` : `支払いまで${d}日（${fmtDate(s.nextPaymentDate)}）`}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 mt-3 pt-3" style={{ borderTop: "1px solid var(--rule)" }}>
              <IconButton icon={paused ? Play : Pause} label={paused ? "再開" : "停止"} onClick={() => onTogglePause(s)} />
              <IconButton icon={Edit2} label="編集" onClick={() => onEdit(s)} />
              <IconButton icon={Trash2} label="削除" tone="clay" onClick={() => { if (confirm(`「${s.name}」を削除しますか？`)) onDelete(s.id); }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SubsHistory({ history, onDelete }) {
  const groups = useMemo(() => {
    const sorted = [...history].sort((a, b) => (a.date < b.date ? 1 : -1));
    const map = {};
    sorted.forEach((h) => {
      const key = h.date.slice(0, 7);
      if (!map[key]) map[key] = [];
      map[key].push(h);
    });
    return Object.entries(map).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [history]);

  if (history.length === 0) {
    return <EmptyState text="支払い履歴はまだありません。稼働中のサブスクの支払日が来ると、自動でここに記録されます。" />;
  }

  return (
    <div className="space-y-4">
      {groups.map(([month, items]) => {
        const subtotal = items.reduce((s, h) => s + Number(h.amount), 0);
        const [y, m] = month.split("-");
        return (
          <div key={month}>
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-xs font-bold" style={{ color: "var(--ink-soft)" }}>{y}年{Number(m)}月</span>
              <span className="mono text-xs font-bold" style={{ color: "var(--ink)" }}>{fmtYen(subtotal)}</span>
            </div>
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--rule)", background: "var(--paper-alt)" }}>
              {items.map((h, i) => (
                <div key={h.id} className="flex items-center justify-between px-4 py-3" style={{ borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}>
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate" style={{ color: "var(--ink)" }}>{h.name}</div>
                    <div className="text-xs mono" style={{ color: "var(--ink-soft)" }}>{fmtDate(h.date)}{h.category ? ` ・ ${h.category}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="mono font-bold" style={{ color: "var(--ink)" }}>{fmtYen(h.amount)}</span>
                    <button onClick={() => onDelete(h.id)} style={{ color: "var(--ink-soft)" }}><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SubsAnalysis({ history, today }) {
  const [mode, setMode] = useState("month"); // month | range
  const [range, setRange] = useState({ start: addDays(today, -365), end: today });

  const thisMonthKey = today.slice(0, 7);
  const entries = useMemo(() => {
    if (mode === "month") return history.filter((h) => h.date.slice(0, 7) === thisMonthKey);
    return history.filter((h) => h.date >= range.start && h.date <= range.end);
  }, [mode, history, thisMonthKey, range]);

  const { segments, total } = useMemo(() => {
    const map = {};
    entries.forEach((h) => {
      const key = h.subscriptionId || h.name;
      if (!map[key]) map[key] = { name: h.name, value: 0 };
      map[key].value += Number(h.amount);
    });
    const arr = Object.values(map).sort((a, b) => b.value - a.value);
    const t = arr.reduce((s, x) => s + x.value, 0);
    return { segments: arr.map((x, i) => ({ ...x, color: PALETTE[i % PALETTE.length] })), total: t };
  }, [entries]);

  return (
    <div>
      <div className="flex gap-1 p-1 rounded-lg mb-4" style={{ background: "var(--paper-alt)", border: "1px solid var(--rule)" }}>
        <button
          onClick={() => setMode("month")}
          className="flex-1 text-xs font-bold py-2 rounded-md"
          style={{ background: mode === "month" ? "var(--brass)" : "transparent", color: mode === "month" ? "white" : "var(--ink-soft)" }}
        >
          月間（今月）
        </button>
        <button
          onClick={() => setMode("range")}
          className="flex-1 text-xs font-bold py-2 rounded-md"
          style={{ background: mode === "range" ? "var(--brass)" : "transparent", color: mode === "range" ? "white" : "var(--ink-soft)" }}
        >
          任意の期間
        </button>
      </div>

      {mode === "range" && (
        <div className="flex items-center gap-2 mb-4">
          <input type="date" value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} className="input mono text-xs" />
          <span className="text-xs" style={{ color: "var(--ink-soft)" }}>〜</span>
          <input type="date" value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} className="input mono text-xs" />
        </div>
      )}

      <p className="text-[11px] mb-4" style={{ color: "var(--ink-soft)" }}>支払い履歴に記録された実際の支払いのみを集計しています。</p>

      {segments.length === 0 ? (
        <EmptyState text="この期間の支払い履歴がありません。" />
      ) : (
        <>
          <div className="flex justify-center mb-5">
            <DonutChart segments={segments} total={total} />
          </div>
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--rule)", background: "var(--paper-alt)" }}>
            {segments.map((seg, i) => (
              <div key={seg.name + i} className="flex items-center justify-between px-4 py-3" style={{ borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: seg.color }} />
                  <span className="text-sm truncate" style={{ color: "var(--ink)" }}>{seg.name}</span>
                </div>
                <span className="mono text-sm font-bold shrink-0" style={{ color: "var(--ink)" }}>{fmtYen(seg.value)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DonutChart({ segments, total }) {
  const size = 200, stroke = 30, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  let offsetAcc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--rule)" strokeWidth={stroke} />
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {segments.map((seg, i) => {
          const frac = total > 0 ? seg.value / total : 0;
          const dash = frac * c;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offsetAcc}
            />
          );
          offsetAcc += dash;
          return el;
        })}
      </g>
      <text x="50%" y="46%" textAnchor="middle" style={{ fontSize: 12, fill: "var(--ink-soft)", fontFamily: "'Zen Kaku Gothic New',sans-serif" }}>合計</text>
      <text x="50%" y="60%" textAnchor="middle" className="mono" style={{ fontSize: 20, fontWeight: 700, fill: "var(--ink)" }}>{fmtYen(total)}</text>
    </svg>
  );
}

function IconButton({ icon: Icon, label, onClick, tone }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded"
      style={{ color: tone === "clay" ? "var(--clay)" : "var(--ink-soft)", background: "var(--paper)" }}
    >
      <Icon size={13} /> {label}
    </button>
  );
}

function EmptyState({ text }) {
  return (
    <div className="text-sm rounded-lg p-8 text-center" style={{ background: "var(--paper-alt)", border: "1px dashed var(--rule)", color: "var(--ink-soft)" }}>
      {text}
    </div>
  );
}

function SubModal({ mode, initial, onCancel, onSave }) {
  const isResume = mode === "resume";
  const [form, setForm] = useState(
    initial || {
      name: "", amount: "", category: SUB_CATEGORIES[0],
      firstPaymentDate: todayStr(), intervalValue: 1, intervalUnit: "month",
      reminderDays: 3, memo: "",
    }
  );
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.name.trim() && Number(form.amount) > 0 && form.firstPaymentDate && Number(form.intervalValue) > 0;

  return (
    <Modal onCancel={onCancel} title={isResume ? "サブスクを再開" : mode === "edit" ? "サブスクを編集" : "サブスクを追加"}>
      {isResume && (
        <p className="text-xs mb-3 px-3 py-2 rounded" style={{ background: "var(--brass-soft)", color: "var(--brass)" }}>
          支払日や間隔を編集しても同じサブスクとして記録されます。再開後の初回支払日を確認してください。
        </p>
      )}
      <Field label="名前">
        <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="例：Netflix" className="input" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="金額">
          <input type="number" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="1490" className="input mono" />
        </Field>
        <Field label="カテゴリ">
          <select value={form.category} onChange={(e) => set("category", e.target.value)} className="input">
            {SUB_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <Field label="初回支払い日">
        <input type="date" value={form.firstPaymentDate} onChange={(e) => set("firstPaymentDate", e.target.value)} className="input mono" />
      </Field>
      <Field label="支払い周期">
        <div className="flex gap-2">
          <input type="number" min="1" value={form.intervalValue} onChange={(e) => set("intervalValue", e.target.value)} className="input mono w-20" />
          <select value={form.intervalUnit} onChange={(e) => set("intervalUnit", e.target.value)} className="input flex-1">
            <option value="day">日ごと</option>
            <option value="week">週間ごと</option>
            <option value="month">ヶ月ごと</option>
            <option value="year">年ごと</option>
          </select>
        </div>
        <p className="text-[11px] mt-1" style={{ color: "var(--ink-soft)" }}>例：1週間の無料体験、6ヶ月プランなども設定できます</p>
      </Field>
      <Field label="何日前にリマインドするか">
        <input type="number" min="0" value={form.reminderDays} onChange={(e) => set("reminderDays", e.target.value)} className="input mono" />
      </Field>
      <Field label="メモ（任意）">
        <input value={form.memo} onChange={(e) => set("memo", e.target.value)} className="input" />
      </Field>
      <ModalActions onCancel={onCancel} onSave={() => valid && onSave(form)} disabled={!valid} saveLabel={isResume ? "再開する" : "保存"} />
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Calendar                                                              */
/* ------------------------------------------------------------------ */

function buildCalendarGrid(year, month) {
  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function CalendarTab({ subs, history, txns, today, onAddTxn }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed
  const [selectedDate, setSelectedDate] = useState(today);

  const monthKey = `${year}-${pad2(month + 1)}`;
  const cells = useMemo(() => buildCalendarGrid(year, month), [year, month]);

  const dayEvents = useMemo(() => {
    const map = {};
    const push = (dateStr, ev) => {
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(ev);
    };
    history.forEach((h) => {
      if (h.date.slice(0, 7) === monthKey) push(h.date, { type: "sub", label: h.name, amount: Number(h.amount) });
    });
    subs.forEach((s) => {
      if (s.status === "active" && s.nextPaymentDate.slice(0, 7) === monthKey) {
        push(s.nextPaymentDate, { type: "sub-upcoming", label: s.name, amount: Number(s.amount) });
      }
    });
    txns.forEach((t) => {
      if (t.date.slice(0, 7) === monthKey) push(t.date, { type: t.type, label: t.category, amount: Number(t.amount) });
    });
    return map;
  }, [monthKey, history, subs, txns]);

  const incomeTotal = useMemo(() => txns.filter((t) => t.type === "income" && t.date.slice(0, 7) === monthKey).reduce((s, t) => s + Number(t.amount), 0), [txns, monthKey]);
  const expenseTotal = useMemo(() => txns.filter((t) => t.type === "expense" && t.date.slice(0, 7) === monthKey).reduce((s, t) => s + Number(t.amount), 0), [txns, monthKey]);
  const subTotal = useMemo(() => {
    const paid = history.filter((h) => h.date.slice(0, 7) === monthKey).reduce((s, h) => s + Number(h.amount), 0);
    const upcoming = subs.filter((s) => s.status === "active" && s.nextPaymentDate.slice(0, 7) === monthKey).reduce((s, x) => s + Number(x.amount), 0);
    return paid + upcoming;
  }, [history, subs, monthKey]);

  const goMonth = (delta) => {
    let m = month + delta, y = year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setMonth(m);
    setYear(y);
  };

  const EVENT_STYLE = {
    sub: { background: "var(--brass)", color: "white" },
    "sub-upcoming": { background: "var(--brass-soft)", color: "var(--brass)" },
    income: { background: "var(--green-soft)", color: "var(--green)" },
    expense: { background: "var(--clay-soft)", color: "var(--clay)" },
  };

  const selectedEvents = dayEvents[selectedDate] || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => goMonth(-1)} className="p-1.5 rounded" style={{ color: "var(--ink-soft)" }}><ChevronLeft size={18} /></button>
        <h2 className="serif text-lg font-bold" style={{ color: "var(--ink)" }}>{year}年{month + 1}月</h2>
        <button onClick={() => goMonth(1)} className="p-1.5 rounded" style={{ color: "var(--ink-soft)" }}><ChevronRight size={18} /></button>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <StatCard label="収入" value={fmtYen(incomeTotal)} accent="var(--green)" />
        <StatCard label="支出" value={fmtYen(expenseTotal)} accent="var(--clay)" />
        <StatCard label="サブスク" value={fmtYen(subTotal)} accent="var(--brass)" />
      </div>

      <div className="flex items-center gap-3 flex-wrap text-[10px] mb-2 px-1" style={{ color: "var(--ink-soft)" }}>
        <LegendDot color="var(--brass)" label="サブスク（実績）" />
        <LegendDot color="var(--brass-soft)" label="サブスク（予定）" outline="var(--brass)" />
        <LegendDot color="var(--green-soft)" label="収入" outline="var(--green)" />
        <LegendDot color="var(--clay-soft)" label="支出" outline="var(--clay)" />
      </div>

      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--rule)", background: "var(--paper-alt)" }}>
        <div className="grid grid-cols-7">
          {WEEKDAY_LABELS.map((w, i) => (
            <div key={w} className="text-center text-[11px] font-bold py-1.5" style={{ color: i === 0 ? "var(--clay)" : "var(--ink-soft)", borderBottom: "1px solid var(--rule)" }}>{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            if (d === null) return <div key={i} className="border-r border-b" style={{ borderColor: "var(--rule)", minHeight: 64 }} />;
            const dateStr = `${year}-${pad2(month + 1)}-${pad2(d)}`;
            const events = dayEvents[dateStr] || [];
            const isToday = dateStr === today;
            const isSelected = dateStr === selectedDate;
            return (
              <button
                key={i}
                onClick={() => setSelectedDate(dateStr)}
                className="text-left p-1 border-r border-b flex flex-col gap-0.5 overflow-hidden"
                style={{ borderColor: "var(--rule)", minHeight: 64, background: isSelected ? "var(--paper)" : "transparent" }}
              >
                <span
                  className="mono text-[11px] w-4 h-4 flex items-center justify-center rounded-full"
                  style={{ background: isToday ? "var(--ink)" : "transparent", color: isToday ? "white" : "var(--ink)" }}
                >
                  {d}
                </span>
                {events.slice(0, 2).map((ev, j) => (
                  <span key={j} className="text-[9px] px-1 rounded truncate" style={EVENT_STYLE[ev.type]}>{ev.label}</span>
                ))}
                {events.length > 2 && <span className="text-[9px]" style={{ color: "var(--ink-soft)" }}>+{events.length - 2}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold" style={{ color: "var(--ink)" }}>{fmtDate(selectedDate)}の記録</h3>
          <div className="flex gap-1.5">
            <button onClick={() => onAddTxn("income", selectedDate)} className="text-[11px] font-bold px-2 py-1 rounded" style={{ background: "var(--green-soft)", color: "var(--green)" }}>+収入</button>
            <button onClick={() => onAddTxn("expense", selectedDate)} className="text-[11px] font-bold px-2 py-1 rounded" style={{ background: "var(--clay-soft)", color: "var(--clay)" }}>+支出</button>
          </div>
        </div>
        {selectedEvents.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--ink-soft)" }}>この日の記録はありません。</p>
        ) : (
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--rule)", background: "var(--paper-alt)" }}>
            {selectedEvents.map((ev, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2.5" style={{ borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={EVENT_STYLE[ev.type]}>
                    {ev.type === "sub" ? "サブスク" : ev.type === "sub-upcoming" ? "サブスク予定" : ev.type === "income" ? "収入" : "支出"}
                  </span>
                  <span className="text-sm truncate" style={{ color: "var(--ink)" }}>{ev.label}</span>
                </div>
                <span className="mono text-sm font-bold shrink-0" style={{ color: "var(--ink)" }}>{fmtYen(ev.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LegendDot({ color, outline, label }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: color, border: outline ? `1px solid ${outline}` : "none" }} />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Transactions                                                         */
/* ------------------------------------------------------------------ */

function TxnsTab({ txns, monthIncome, monthExpense, freeMoney, onAdd, onDelete }) {
  const sorted = useMemo(() => [...txns].sort((a, b) => (a.date < b.date ? 1 : -1)), [txns]);
  return (
    <div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <StatCard label="今月の収入" value={fmtYen(monthIncome)} accent="var(--green)" />
        <StatCard label="今月の支出" value={fmtYen(monthExpense)} accent="var(--clay)" />
        <StatCard label="収支" value={fmtYen(freeMoney)} />
      </div>
      <div className="flex gap-2 mb-4">
        <button onClick={() => onAdd("income")} className="flex-1 flex items-center justify-center gap-1 text-sm font-bold px-3 py-2.5 rounded-lg" style={{ background: "var(--green-soft)", color: "var(--green)" }}>
          <Plus size={15} /> 収入を追加
        </button>
        <button onClick={() => onAdd("expense")} className="flex-1 flex items-center justify-center gap-1 text-sm font-bold px-3 py-2.5 rounded-lg" style={{ background: "var(--clay-soft)", color: "var(--clay)" }}>
          <Plus size={15} /> 支出を追加
        </button>
      </div>

      {sorted.length === 0 ? (
        <EmptyState text="収支の記録がありません。上のボタンから追加してください。" />
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--rule)", background: "var(--paper-alt)" }}>
          {sorted.map((t, i) => (
            <div key={t.id} className="flex items-center justify-between px-4 py-3" style={{ borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: t.type === "income" ? "var(--green-soft)" : "var(--clay-soft)", color: t.type === "income" ? "var(--green)" : "var(--clay)" }}>
                    {t.category}
                  </span>
                  <span className="text-xs mono" style={{ color: "var(--ink-soft)" }}>{fmtDate(t.date)}</span>
                </div>
                {t.note && <div className="text-xs mt-1 truncate" style={{ color: "var(--ink-soft)" }}>{t.note}</div>}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="mono font-bold" style={{ color: t.type === "income" ? "var(--green)" : "var(--clay)" }}>
                  {t.type === "income" ? "+" : "-"}{fmtYen(t.amount)}
                </span>
                <button onClick={() => onDelete(t.id)} style={{ color: "var(--ink-soft)" }}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TxnModal({ type, defaultDate, onCancel, onSave }) {
  const cats = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const [form, setForm] = useState({ type, category: cats[0], amount: "", date: defaultDate, note: "" });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const valid = Number(form.amount) > 0 && form.date;
  return (
    <Modal onCancel={onCancel} title={type === "income" ? "収入を追加" : "支出を追加"}>
      <Field label="カテゴリ">
        <select value={form.category} onChange={(e) => set("category", e.target.value)} className="input">
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="金額">
        <input type="number" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} className="input mono" />
      </Field>
      <Field label="日付">
        <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className="input mono" />
      </Field>
      <Field label="メモ（任意）">
        <input value={form.note} onChange={(e) => set("note", e.target.value)} className="input" />
      </Field>
      <ModalActions onCancel={onCancel} onSave={() => valid && onSave(form)} disabled={!valid} />
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Assets                                                                */
/* ------------------------------------------------------------------ */

function AssetsTab({ assets, onSave, totalValuation, totalGainLoss }) {
  const [draft, setDraft] = useState(assets);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setDraft(assets); }, [assets]);

  const setField = (key, field, val) => {
    setDraft((d) => ({ ...d, [key]: { ...d[key], [field]: val } }));
    setDirty(true);
  };

  const save = () => {
    const cleaned = {};
    ASSET_TYPES.forEach((t) => {
      cleaned[t.key] = {
        valuation: Number(draft[t.key]?.valuation) || 0,
        gainLoss: Number(draft[t.key]?.gainLoss) || 0,
      };
    });
    onSave(cleaned);
    setDirty(false);
  };

  return (
    <div>
      <div className="rounded-xl p-5 mb-5" style={{ background: "var(--brass)", color: "white" }}>
        <div className="text-xs opacity-85">資産評価額合計（自由に使えるお金には含みません）</div>
        <div className="mono text-3xl font-bold mt-1">{fmtYen(totalValuation)}</div>
        <div className="mono text-sm mt-1 opacity-90">評価損益 {totalGainLoss >= 0 ? "+" : ""}{fmtYen(totalGainLoss)}</div>
      </div>

      <div className="space-y-3">
        {ASSET_TYPES.map((t) => {
          const v = draft[t.key] || { valuation: 0, gainLoss: 0 };
          const gl = Number(v.gainLoss) || 0;
          return (
            <div key={t.key} className="rounded-lg p-4" style={{ background: "var(--paper-alt)", border: "1px solid var(--rule)" }}>
              <div className="text-sm font-bold mb-2" style={{ color: "var(--ink)" }}>{t.label}</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="資産評価額">
                  <input type="number" value={v.valuation} onChange={(e) => setField(t.key, "valuation", e.target.value)} className="input mono" />
                </Field>
                <Field label="評価損益">
                  <input type="number" value={v.gainLoss} onChange={(e) => setField(t.key, "gainLoss", e.target.value)} className="input mono" style={{ color: gl >= 0 ? "var(--green)" : "var(--clay)" }} />
                </Field>
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={save}
        disabled={!dirty}
        className="w-full mt-5 flex items-center justify-center gap-1.5 font-bold text-sm px-4 py-3 rounded-lg text-white"
        style={{ background: dirty ? "var(--ink)" : "var(--rule)", cursor: dirty ? "pointer" : "default" }}
      >
        <Check size={15} /> {dirty ? "資産情報を保存" : "保存済み"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared modal bits                                                     */
/* ------------------------------------------------------------------ */

function Modal({ title, children, onCancel }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: "rgba(27,42,74,0.45)" }} onClick={onCancel}>
      <div
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--paper-alt)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="serif text-lg font-bold" style={{ color: "var(--ink)" }}>{title}</h3>
          <button onClick={onCancel} style={{ color: "var(--ink-soft)" }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-bold mb-1" style={{ color: "var(--ink-soft)" }}>{label}</label>
      {children}
    </div>
  );
}

function ModalActions({ onCancel, onSave, disabled, saveLabel = "保存" }) {
  return (
    <div className="flex gap-2 mt-4">
      <button onClick={onCancel} className="flex-1 text-sm font-bold px-4 py-2.5 rounded-lg" style={{ background: "var(--paper)", color: "var(--ink-soft)", border: "1px solid var(--rule)" }}>
        キャンセル
      </button>
      <button
        onClick={onSave}
        disabled={disabled}
        className="flex-1 text-sm font-bold px-4 py-2.5 rounded-lg text-white"
        style={{ background: disabled ? "var(--rule)" : "var(--ink)" }}
      >
        {saveLabel}
      </button>
    </div>
  );
}
