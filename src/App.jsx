import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Home, RefreshCw, Wallet, TrendingUp, Bell, Pause, Play, Edit2, Trash2, Copy,
  Plus, X, ChevronRight, ChevronLeft, AlertCircle, Loader2, Check, Settings as SettingsIcon,
  Calendar as CalendarIcon, List, History as HistoryIcon, PieChart as PieChartIcon,
  Target, Search, FileDown, FileUp, Moon, Sun, FileBarChart2, Landmark, ArrowLeftRight
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const EXPENSE_CATEGORIES = ["食費", "日用品", "買い物", "交通費", "住居", "光熱費", "通信費", "娯楽", "医療", "その他"];
const INCOME_CATEGORIES = ["給与", "ボーナス", "副業", "お小遣い", "投資収益", "その他"];
const SUB_CATEGORIES = ["動画配信", "音楽", "ニュース・雑誌", "クラウド・ソフト", "フィットネス", "ゲーム", "その他"];
const ALL_CATEGORIES = [...new Set([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES])];

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
const shiftMonthKey = (key, delta) => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
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

function monthlyEquivalent(sub) {
  const v = Number(sub.intervalValue) || 1;
  let months;
  if (sub.intervalUnit === "day") months = v / 30;
  else if (sub.intervalUnit === "week") months = (v * 7) / 30;
  else if (sub.intervalUnit === "month") months = v;
  else months = v * 12;
  return months > 0 ? Number(sub.amount) / months : 0;
}

function getNextPaymentDate(sub) {
  return sub.lastRecordedDate ? addInterval(sub.lastRecordedDate, sub.intervalValue, sub.intervalUnit) : sub.firstPaymentDate;
}

function accrueAll(subs, today) {
  const historyAdded = [];
  const newSubs = subs.map((s) => {
    if (s.status !== "active") return s;
    let cursor = s.lastRecordedDate ? addInterval(s.lastRecordedDate, s.intervalValue, s.intervalUnit) : s.firstPaymentDate;
    let last = s.lastRecordedDate;
    let guard = 0;
    while (cursor <= today && guard < 1000) {
      historyAdded.push({ id: uid(), subscriptionId: s.id, name: s.name, category: s.category, paymentMethod: s.paymentMethod || "", accountId: s.accountId || "", amount: Number(s.amount), date: cursor });
      last = cursor;
      cursor = addInterval(cursor, s.intervalValue, s.intervalUnit);
      guard++;
    }
    return last !== s.lastRecordedDate ? { ...s, lastRecordedDate: last } : s;
  });
  return { newSubs, historyAdded };
}

function avatarColor(name) {
  let hash = 0;
  const str = name || "?";
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function accountBalance(account, txns, history, transfers) {
  let bal = Number(account.initialBalance) || 0;
  txns.forEach((t) => {
    if (t.accountId !== account.id) return;
    bal += t.type === "income" ? Number(t.amount) : -Number(t.amount);
  });
  history.forEach((h) => {
    if (h.accountId === account.id) bal -= Number(h.amount);
  });
  transfers.forEach((tr) => {
    if (tr.fromAccountId === account.id) bal -= Number(tr.amount);
    if (tr.toAccountId === account.id) bal += Number(tr.amount);
  });
  return bal;
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
  const [subTab, setSubTab] = useState("list");
  const [txnTab, setTxnTab] = useState("list");
  const [subs, setSubs] = useState([]);
  const [history, setHistory] = useState([]);
  const [txns, setTxns] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [budgets, setBudgets] = useState({});
  const [assetHistory, setAssetHistory] = useState([]);
  const [darkMode, setDarkMode] = useState(false);
  const [assets, setAssets] = useState(() => {
    const o = {};
    ASSET_TYPES.forEach((t) => (o[t.key] = { valuation: 0, gainLoss: 0 }));
    return o;
  });
  const [subModal, setSubModal] = useState(null);
  const [txnModal, setTxnModal] = useState(null);
  const [accountModal, setAccountModal] = useState(null);
  const [transferModal, setTransferModal] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saveError, setSaveError] = useState("");

  const today = todayStr();

  useEffect(() => {
    (async () => {
      const [rawSubs, t, a, h, b, ah, dm, acc, tr] = await Promise.all([
        loadKey("subscriptions", []),
        loadKey("transactions", []),
        loadKey("assets", null),
        loadKey("paymentHistory", []),
        loadKey("budgets", {}),
        loadKey("assetHistory", []),
        loadKey("darkMode", false),
        loadKey("accounts", []),
        loadKey("transfers", []),
      ]);
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
      setBudgets(b || {});
      setAssetHistory(ah || []);
      setDarkMode(!!dm);
      setAccounts(acc || []);
      setTransfers(tr || []);
      setLoading(false);
      saveKey("subscriptions", newSubs);
      if (historyAdded.length) saveKey("paymentHistory", newHistory);
    })();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    saveKey("darkMode", next);
  };

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
  const monthExpenseByCategory = useMemo(() => {
    const m = {};
    monthTxns.filter((t) => t.type === "expense").forEach((t) => { m[t.category] = (m[t.category] || 0) + Number(t.amount); });
    return m;
  }, [monthTxns]);
  const monthSubHistory = useMemo(() => history.filter((h) => h.date.slice(0, 7) === thisMonthKey), [history, thisMonthKey]);
  const monthSubActual = useMemo(() => monthSubHistory.reduce((s, h) => s + Number(h.amount), 0), [monthSubHistory]);
  const freeMoney = monthIncome - monthExpense - monthSubActual;

  const accountsWithBalance = useMemo(
    () => accounts.map((a) => ({ ...a, balance: accountBalance(a, txns, history, transfers) })),
    [accounts, txns, history, transfers]
  );
  const totalBalance = useMemo(() => accountsWithBalance.reduce((s, a) => s + a.balance, 0), [accountsWithBalance]);
  const unassignedCount = useMemo(
    () => txns.filter((t) => !t.accountId).length + history.filter((h) => !h.accountId).length,
    [txns, history]
  );

  const assetValuationTotal = useMemo(() => ASSET_TYPES.reduce((s, t) => s + (Number(assets[t.key]?.valuation) || 0), 0), [assets]);
  const assetGainLossTotal = useMemo(() => ASSET_TYPES.reduce((s, t) => s + (Number(assets[t.key]?.gainLoss) || 0), 0), [assets]);

  const paymentMethodSuggestions = useMemo(() => [...new Set(subs.map((s) => s.paymentMethod).filter(Boolean))], [subs]);

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

  const persistBudgets = useCallback(async (next) => {
    setBudgets(next);
    const ok = await saveKey("budgets", next);
    if (!ok) setSaveError("予算の保存に失敗しました。もう一度お試しください。");
  }, []);

  const persistAccounts = useCallback(async (next) => {
    setAccounts(next);
    const ok = await saveKey("accounts", next);
    if (!ok) setSaveError("口座の保存に失敗しました。もう一度お試しください。");
  }, []);

  const persistTransfers = useCallback(async (next) => {
    setTransfers(next);
    const ok = await saveKey("transfers", next);
    if (!ok) setSaveError("振替の保存に失敗しました。もう一度お試しください。");
  }, []);

  const persistAssets = useCallback(
    async (cleanedAssets) => {
      setAssets(cleanedAssets);
      const totalV = ASSET_TYPES.reduce((s, t) => s + (Number(cleanedAssets[t.key]?.valuation) || 0), 0);
      const totalG = ASSET_TYPES.reduce((s, t) => s + (Number(cleanedAssets[t.key]?.gainLoss) || 0), 0);
      const filtered = assetHistory.filter((h) => h.date !== todayStr());
      const newAssetHistory = [...filtered, { date: todayStr(), totalValuation: totalV, totalGainLoss: totalG }].sort((a, b) => (a.date < b.date ? -1 : 1));
      setAssetHistory(newAssetHistory);
      const ok1 = await saveKey("assets", cleanedAssets);
      const ok2 = await saveKey("assetHistory", newAssetHistory);
      if (!ok1 || !ok2) setSaveError("資産情報の保存に失敗しました。もう一度お試しください。");
    },
    [assetHistory]
  );

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
      setSubModal({ mode: "resume", data: { ...sub, status: "active", firstPaymentDate: today } });
    }
  };
  const duplicateSub = (sub) => {
    setSubModal({
      mode: "new",
      data: {
        name: `${sub.name}のコピー`, amount: sub.amount, category: sub.category, paymentMethod: sub.paymentMethod || "",
        accountId: sub.accountId || "", firstPaymentDate: today, intervalValue: sub.intervalValue, intervalUnit: sub.intervalUnit,
        reminderDays: sub.reminderDays, memo: sub.memo || "",
      },
    });
  };
  const deleteHistoryEntry = (id) => {
    if (confirm("この支払い履歴を削除しますか？")) persistHistory(history.filter((h) => h.id !== id));
  };

  const saveTxn = (data) => {
    if (data.id) {
      persistTxns(txns.map((t) => (t.id === data.id ? { ...t, ...data } : t)));
    } else {
      persistTxns([{ ...data, id: uid() }, ...txns]);
    }
    setTxnModal(null);
  };
  const deleteTxn = (id) => persistTxns(txns.filter((t) => t.id !== id));

  const saveAccount = (data) => {
    if (data.id) {
      persistAccounts(accounts.map((a) => (a.id === data.id ? { ...a, ...data } : a)));
      return;
    }
    const newAccount = { ...data, id: uid() };
    persistAccounts([...accounts, newAccount]);
    if (data.assignUnassigned) {
      persistTxns(txns.map((t) => (t.accountId ? t : { ...t, accountId: newAccount.id })));
      persistHistory(history.map((h) => (h.accountId ? h : { ...h, accountId: newAccount.id })));
    }
  };
  const deleteAccount = (id) => {
    if (!confirm("この口座を削除しますか？この口座に紐づく収支の記録は「未割当て」に戻ります。")) return;
    persistAccounts(accounts.filter((a) => a.id !== id));
    persistTxns(txns.map((t) => (t.accountId === id ? { ...t, accountId: "" } : t)));
    persistHistory(history.map((h) => (h.accountId === id ? { ...h, accountId: "" } : h)));
    persistTransfers(transfers.filter((tr) => tr.fromAccountId !== id && tr.toAccountId !== id));
  };
  const saveTransfer = (data) => {
    persistTransfers([{ ...data, id: uid() }, ...transfers]);
    setTransferModal(false);
  };
  const deleteTransfer = (id) => persistTransfers(transfers.filter((tr) => tr.id !== id));

  const exportData = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      subscriptions: subs, transactions: txns, assets, paymentHistory: history,
      budgets, assetHistory, darkMode, accounts, transfers,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `household-ledger-backup-${today}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const importData = (file) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        if (!confirm("現在のデータを上書きしてインポートします。よろしいですか？")) return;
        const newSubs = data.subscriptions || [];
        const newHistory = data.paymentHistory || [];
        const newTxns = data.transactions || [];
        const newAssets = data.assets || assets;
        const newBudgets = data.budgets || {};
        const newAssetHistory = data.assetHistory || [];
        const newAccounts = data.accounts || [];
        const newTransfers = data.transfers || [];
        setSubs(newSubs); setHistory(newHistory); setTxns(newTxns);
        setAssets(newAssets); setBudgets(newBudgets); setAssetHistory(newAssetHistory);
        setAccounts(newAccounts); setTransfers(newTransfers);
        await Promise.all([
          saveKey("subscriptions", newSubs), saveKey("paymentHistory", newHistory), saveKey("transactions", newTxns),
          saveKey("assets", newAssets), saveKey("budgets", newBudgets), saveKey("assetHistory", newAssetHistory),
          saveKey("accounts", newAccounts), saveKey("transfers", newTransfers),
        ]);
        alert("インポートが完了しました。");
      } catch {
        alert("ファイルの読み込みに失敗しました。正しいバックアップファイルか確認してください。");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen w-full">
      <header className="sticky top-0 z-30 border-b" style={{ borderColor: "var(--rule)", background: "var(--paper)" }}>
        <div className="max-w-5xl mx-auto px-4 pt-5 pb-3 flex items-start justify-between">
          <div>
            <div className="flex items-baseline gap-3">
              <h1 className="serif text-2xl md:text-3xl font-bold tracking-wide" style={{ color: "var(--ink)" }}>家計ノート</h1>
              <span className="mono text-xs" style={{ color: "var(--ink-soft)" }}>{fmtDate(today)}</span>
            </div>
            <p className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>収支・サブスク・資産をひとつの通帳で管理</p>
          </div>
          <button onClick={() => setSettingsOpen(true)} className="p-2 rounded-lg" style={{ color: "var(--ink-soft)", background: "var(--paper-alt)", border: "1px solid var(--rule)" }}>
            <SettingsIcon size={17} />
          </button>
        </div>
        <nav className="max-w-5xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {[
            { id: "home", label: "ホーム", icon: Home },
            { id: "subs", label: "サブスク", icon: RefreshCw, badge: remindingSubs.length },
            { id: "calendar", label: "カレンダー", icon: CalendarIcon },
            { id: "txns", label: "収支", icon: Wallet },
            { id: "assets", label: "資産", icon: TrendingUp },
            { id: "report", label: "レポート", icon: FileBarChart2 },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="relative flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium whitespace-nowrap"
                style={{ color: active ? "var(--ink)" : "var(--ink-soft)", borderBottom: active ? "2px solid var(--brass)" : "2px solid transparent" }}
              >
                <Icon size={15} />
                {t.label}
                {!!t.badge && (
                  <span className="mono ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full text-white" style={{ background: "var(--clay)" }}>{t.badge}</span>
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
                totalBalance={totalBalance} accountsWithBalance={accountsWithBalance}
                freeMoney={freeMoney} monthIncome={monthIncome} monthExpense={monthExpense} monthSubActual={monthSubActual}
                activeMonthlyEstimate={activeMonthlyEstimate} assetValuationTotal={assetValuationTotal} assetGainLossTotal={assetGainLossTotal}
                remindingSubs={remindingSubs} today={today} goSubs={() => setTab("subs")} goAccounts={() => { setTab("txns"); setTxnTab("accounts"); }}
                onQuickAdd={(type) => setTxnModal({ type, date: today })}
              />
            )}
            {tab === "subs" && (
              <SubsTab
                subTab={subTab} setSubTab={setSubTab} subs={enrichedSubs} history={history} today={today}
                activeMonthlyEstimate={activeMonthlyEstimate} paymentMethodSuggestions={paymentMethodSuggestions}
                onAdd={() => setSubModal({ mode: "new", data: null })} onEdit={(s) => setSubModal({ mode: "edit", data: s })}
                onDelete={deleteSub} onTogglePause={togglePause} onDuplicate={duplicateSub} onDeleteHistory={deleteHistoryEntry}
              />
            )}
            {tab === "calendar" && (
              <CalendarTab subs={enrichedSubs} history={history} txns={txns} today={today} onAddTxn={(type, date) => setTxnModal({ type, date })} />
            )}
            {tab === "txns" && (
              <TxnsTab
                txnTab={txnTab} setTxnTab={setTxnTab} txns={txns} monthIncome={monthIncome} monthExpense={monthExpense} freeMoney={freeMoney}
                budgets={budgets} monthExpenseByCategory={monthExpenseByCategory} onSaveBudgets={persistBudgets}
                onAdd={(type) => setTxnModal({ type, date: today })} onEdit={(t) => setTxnModal({ type: t.type, date: t.date, initial: t })}
                onDelete={deleteTxn}
                accounts={accountsWithBalance} totalBalance={totalBalance} unassignedCount={unassignedCount}
                onAddAccount={() => setAccountModal({ mode: "new", data: null })}
                onEditAccount={(a) => setAccountModal({ mode: "edit", data: a })}
                onDeleteAccount={deleteAccount}
                onAddTransfer={() => setTransferModal(true)}
                transfers={transfers} onDeleteTransfer={deleteTransfer}
              />
            )}
            {tab === "assets" && (
              <AssetsTab assets={assets} assetHistory={assetHistory} onSave={persistAssets} totalValuation={assetValuationTotal} totalGainLoss={assetGainLossTotal} />
            )}
            {tab === "report" && (
              <ReportTab today={today} txns={txns} history={history} subs={enrichedSubs} assetHistory={assetHistory} assetValuationTotal={assetValuationTotal} />
            )}
          </>
        )}
      </main>

      {subModal && (
        <SubModal mode={subModal.mode} initial={subModal.data} paymentMethodSuggestions={paymentMethodSuggestions} accounts={accounts} onCancel={() => setSubModal(null)} onSave={saveSub} />
      )}
      {txnModal && (
        <TxnModal type={txnModal.type} defaultDate={txnModal.date || today} initial={txnModal.initial} accounts={accountsWithBalance} onCancel={() => setTxnModal(null)} onSave={saveTxn} />
      )}
      {accountModal && (
        <AccountModal
          mode={accountModal.mode} initial={accountModal.data} isFirstAccount={accounts.length === 0} unassignedCount={unassignedCount}
          onCancel={() => setAccountModal(null)} onSave={(data) => { saveAccount(data); setAccountModal(null); }}
        />
      )}
      {transferModal && (
        <TransferModal accounts={accountsWithBalance} today={today} onCancel={() => setTransferModal(false)} onSave={saveTransfer} />
      )}
      {settingsOpen && (
        <SettingsModal
          darkMode={darkMode} onToggleDark={toggleDarkMode} onClose={() => setSettingsOpen(false)}
          onExport={exportData} onImportFile={importData}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                          */
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

function EmptyState({ text }) {
  return (
    <div className="text-sm rounded-lg p-8 text-center" style={{ background: "var(--paper-alt)", border: "1px dashed var(--rule)", color: "var(--ink-soft)" }}>
      {text}
    </div>
  );
}

function IconButton({ icon: Icon, label, onClick, tone }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded" style={{ color: tone === "clay" ? "var(--clay)" : "var(--ink-soft)", background: "var(--paper)" }}>
      <Icon size={13} /> {label}
    </button>
  );
}

function Avatar({ name, size = 32 }) {
  const color = avatarColor(name);
  const letter = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      className="mono flex items-center justify-center rounded-full shrink-0 font-bold text-white"
      style={{ width: size, height: size, background: color, fontSize: size * 0.42 }}
    >
      {letter}
    </div>
  );
}

function Switch({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-10 h-6 rounded-full relative shrink-0"
      style={{ background: checked ? "var(--ink)" : "var(--rule)" }}
    >
      <span
        className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform"
        style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}

function Modal({ title, children, onCancel }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: "rgba(10,14,22,0.55)" }} onClick={onCancel}>
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto" style={{ background: "var(--paper-alt)" }} onClick={(e) => e.stopPropagation()}>
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
      <button onClick={onSave} disabled={disabled} className="flex-1 text-sm font-bold px-4 py-2.5 rounded-lg text-white" style={{ background: disabled ? "var(--rule)" : "var(--ink)" }}>
        {saveLabel}
      </button>
    </div>
  );
}

function SegButton({ active, onClick, icon: Icon, label, badge }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-2 rounded-md"
      style={{ background: active ? "var(--ink)" : "transparent", color: active ? "white" : "var(--ink-soft)" }}
    >
      <Icon size={13} /> {label}
      {!!badge && <span className="mono text-[9px] px-1 rounded-full text-white" style={{ background: "var(--clay)" }}>{badge}</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Settings modal (dark mode + backup/restore)                          */
/* ------------------------------------------------------------------ */

function SettingsModal({ darkMode, onToggleDark, onClose, onExport, onImportFile }) {
  const fileRef = useRef(null);
  return (
    <Modal title="設定" onCancel={onClose}>
      <div className="flex items-center justify-between mb-4 rounded-lg p-3" style={{ background: "var(--paper)", border: "1px solid var(--rule)" }}>
        <div className="flex items-center gap-2 text-sm font-bold" style={{ color: "var(--ink)" }}>
          {darkMode ? <Moon size={15} /> : <Sun size={15} />} ダークモード
        </div>
        <Switch checked={darkMode} onChange={onToggleDark} />
      </div>

      <div className="space-y-2 mb-2">
        <button onClick={onExport} className="w-full flex items-center gap-2 text-sm font-bold px-4 py-3 rounded-lg" style={{ background: "var(--paper)", border: "1px solid var(--rule)", color: "var(--ink)" }}>
          <FileDown size={16} /> データをエクスポート（JSON）
        </button>
        <button onClick={() => fileRef.current?.click()} className="w-full flex items-center gap-2 text-sm font-bold px-4 py-3 rounded-lg" style={{ background: "var(--paper)", border: "1px solid var(--rule)", color: "var(--ink)" }}>
          <FileUp size={16} /> データをインポート（JSON）
        </button>
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = ""; }} />
      </div>

      <p className="text-[11px] mt-3 leading-relaxed" style={{ color: "var(--ink-soft)" }}>
        データはこの端末のブラウザにのみ保存されています。機種変更やブラウザの変更・キャッシュ削除の前に、必ずエクスポートしてバックアップを取ってください。
      </p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Home                                                                 */
/* ------------------------------------------------------------------ */

function HomeTab({ totalBalance, accountsWithBalance, freeMoney, monthIncome, monthExpense, monthSubActual, activeMonthlyEstimate, assetValuationTotal, assetGainLossTotal, remindingSubs, today, goSubs, goAccounts, onQuickAdd }) {
  const hasAccounts = accountsWithBalance && accountsWithBalance.length > 0;
  return (
    <div className="space-y-6">
      <section>
        <div className="rounded-xl p-5 perforated" style={{ background: "var(--ink)", color: "white" }}>
          <div className="text-xs opacity-70">現在の所持金合計（登録した口座の残高）</div>
          {hasAccounts ? (
            <div className="mono text-4xl font-bold mt-1">{fmtYen(totalBalance)}</div>
          ) : (
            <>
              <div className="mono text-2xl font-bold mt-1 opacity-70">未設定</div>
              <button onClick={goAccounts} className="text-xs font-bold mt-2 px-3 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.14)" }}>口座を登録する →</button>
            </>
          )}
          <div className="mt-3 pt-3 flex flex-col gap-1" style={{ borderTop: "1px solid rgba(255,255,255,0.15)" }}>
            <div className="text-[11px] opacity-70">今月の収支（サブスク込み） <span className="mono font-bold" style={{ opacity: 1 }}>{fmtYen(freeMoney)}</span></div>
            <div className="flex gap-4 text-xs opacity-80 flex-wrap">
              <span>収入 {fmtYen(monthIncome)}</span>
              <span>支出 {fmtYen(monthExpense)}</span>
              <span>サブスク {fmtYen(monthSubActual)}</span>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => onQuickAdd("income")} className="flex-1 text-xs font-bold py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.14)" }}>+収入</button>
            <button onClick={() => onQuickAdd("expense")} className="flex-1 text-xs font-bold py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.14)" }}>+支出</button>
          </div>
        </div>
      </section>

      {hasAccounts && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold" style={{ color: "var(--ink)" }}>口座別残高</h2>
            <button onClick={goAccounts} className="text-xs flex items-center gap-0.5" style={{ color: "var(--brass)" }}>口座を管理 <ChevronRight size={13} /></button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {accountsWithBalance.map((a) => (
              <div key={a.id} className="rounded-lg p-3" style={{ background: "var(--paper-alt)", border: "1px solid var(--rule)" }}>
                <div className="text-xs truncate" style={{ color: "var(--ink-soft)" }}>{a.name}</div>
                <div className="mono font-bold" style={{ color: a.balance < 0 ? "var(--clay)" : "var(--ink)" }}>{fmtYen(a.balance)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

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
          <h2 className="text-sm font-bold flex items-center gap-1.5" style={{ color: "var(--ink)" }}><Bell size={15} /> 支払いリマインド</h2>
          <button onClick={goSubs} className="text-xs flex items-center gap-0.5" style={{ color: "var(--brass)" }}>サブスク一覧 <ChevronRight size={13} /></button>
        </div>
        {remindingSubs.length === 0 ? (
          <div className="text-sm rounded-lg p-4" style={{ background: "var(--paper-alt)", border: "1px dashed var(--rule)", color: "var(--ink-soft)" }}>今のところ近づいている支払いはありません。</div>
        ) : (
          <div className="space-y-2">
            {remindingSubs.map((s) => {
              const d = daysBetween(today, s.nextPaymentDate);
              return (
                <div key={s.id} className="flex items-center gap-3 rounded-lg px-4 py-3" style={{ background: "var(--clay-soft)", border: "1px solid var(--clay)" }}>
                  <Avatar name={s.name} size={30} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate" style={{ color: "var(--ink)" }}>{s.name}</div>
                    <div className="text-xs" style={{ color: "var(--ink-soft)" }}>{fmtDate(s.nextPaymentDate)} 支払い予定</div>
                  </div>
                  <div className="text-right shrink-0">
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

function SubsTab({ subTab, setSubTab, subs, history, today, activeMonthlyEstimate, paymentMethodSuggestions, onAdd, onEdit, onDelete, onTogglePause, onDuplicate, onDeleteHistory }) {
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

      {subTab === "list" && <SubsList subs={subs} today={today} onEdit={onEdit} onDelete={onDelete} onTogglePause={onTogglePause} onDuplicate={onDuplicate} />}
      {subTab === "history" && <SubsHistory history={history} onDelete={onDeleteHistory} />}
      {subTab === "analysis" && <SubsAnalysis history={history} today={today} />}
    </div>
  );
}

function SubsList({ subs, today, onEdit, onDelete, onTogglePause, onDuplicate }) {
  if (subs.length === 0) return <EmptyState text="登録されているサブスクはありません。「追加」から登録してください。" />;
  return (
    <div className="space-y-2.5">
      {subs.map((s) => {
        const paused = s.status === "paused";
        const d = daysBetween(today, s.nextPaymentDate);
        const reminding = !paused && d >= 0 && d <= (Number(s.reminderDays) || 0);
        return (
          <div key={s.id} className="rounded-lg p-4" style={{ background: paused ? "var(--paper)" : "var(--paper-alt)", border: `1px solid ${reminding ? "var(--clay)" : "var(--rule)"}`, opacity: paused ? 0.65 : 1 }}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <Avatar name={s.name} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm" style={{ color: "var(--ink)" }}>{s.name}</span>
                    {s.category && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--brass-soft)", color: "var(--brass)" }}>{s.category}</span>}
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: paused ? "var(--rule)" : "var(--green-soft)", color: paused ? "var(--ink-soft)" : "var(--green)" }}>
                      {paused ? "停止中" : "稼働中"}
                    </span>
                  </div>
                  <div className="text-xs mt-1" style={{ color: "var(--ink-soft)" }}>
                    {intervalLabel(s)} ・ 初回 {fmtDate(s.firstPaymentDate)} ・ リマインド{s.reminderDays}日前
                    {s.paymentMethod && ` ・ ${s.paymentMethod}`}
                  </div>
                  {s.memo && <div className="text-xs mt-1 truncate" style={{ color: "var(--ink-soft)" }}>{s.memo}</div>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="mono font-bold text-lg" style={{ color: "var(--ink)" }}>{fmtYen(s.amount)}</div>
                <div className="text-xs mt-0.5" style={{ color: reminding ? "var(--clay)" : "var(--ink-soft)" }}>
                  {paused ? `次回(仮) ${fmtDate(s.nextPaymentDate)}` : `支払いまで${d}日（${fmtDate(s.nextPaymentDate)}）`}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 mt-3 pt-3 flex-wrap" style={{ borderTop: "1px solid var(--rule)" }}>
              <IconButton icon={paused ? Play : Pause} label={paused ? "再開" : "停止"} onClick={() => onTogglePause(s)} />
              <IconButton icon={Edit2} label="編集" onClick={() => onEdit(s)} />
              <IconButton icon={Copy} label="複製" onClick={() => onDuplicate(s)} />
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
    sorted.forEach((h) => { const key = h.date.slice(0, 7); (map[key] ||= []).push(h); });
    return Object.entries(map).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [history]);

  if (history.length === 0) return <EmptyState text="支払い履歴はまだありません。稼働中のサブスクの支払日が来ると、自動でここに記録されます。" />;

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
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={h.name} size={26} />
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate" style={{ color: "var(--ink)" }}>{h.name}</div>
                      <div className="text-xs mono" style={{ color: "var(--ink-soft)" }}>{fmtDate(h.date)}{h.category ? ` ・ ${h.category}` : ""}{h.paymentMethod ? ` ・ ${h.paymentMethod}` : ""}</div>
                    </div>
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
  const [mode, setMode] = useState("month");
  const [range, setRange] = useState({ start: addDays(today, -365), end: today });
  const [groupBy, setGroupBy] = useState("service");

  const thisMonthKey = today.slice(0, 7);
  const entries = useMemo(() => {
    if (mode === "month") return history.filter((h) => h.date.slice(0, 7) === thisMonthKey);
    return history.filter((h) => h.date >= range.start && h.date <= range.end);
  }, [mode, history, thisMonthKey, range]);

  const { segments, total } = useMemo(() => {
    const map = {};
    entries.forEach((h) => {
      const key = groupBy === "service" ? (h.subscriptionId || h.name) : (h.paymentMethod || "未設定");
      const label = groupBy === "service" ? h.name : (h.paymentMethod || "未設定");
      if (!map[key]) map[key] = { name: label, value: 0 };
      map[key].value += Number(h.amount);
    });
    const arr = Object.values(map).sort((a, b) => b.value - a.value);
    const t = arr.reduce((s, x) => s + x.value, 0);
    return { segments: arr.map((x, i) => ({ ...x, color: PALETTE[i % PALETTE.length] })), total: t };
  }, [entries, groupBy]);

  return (
    <div>
      <div className="flex gap-1 p-1 rounded-lg mb-3" style={{ background: "var(--paper-alt)", border: "1px solid var(--rule)" }}>
        <button onClick={() => setMode("month")} className="flex-1 text-xs font-bold py-2 rounded-md" style={{ background: mode === "month" ? "var(--brass)" : "transparent", color: mode === "month" ? "white" : "var(--ink-soft)" }}>月間（今月）</button>
        <button onClick={() => setMode("range")} className="flex-1 text-xs font-bold py-2 rounded-md" style={{ background: mode === "range" ? "var(--brass)" : "transparent", color: mode === "range" ? "white" : "var(--ink-soft)" }}>任意の期間</button>
      </div>

      {mode === "range" && (
        <div className="flex items-center gap-2 mb-3">
          <input type="date" value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} className="input mono text-xs" />
          <span className="text-xs" style={{ color: "var(--ink-soft)" }}>〜</span>
          <input type="date" value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} className="input mono text-xs" />
        </div>
      )}

      <div className="flex gap-1 p-1 rounded-lg mb-4" style={{ background: "var(--paper)", border: "1px solid var(--rule)" }}>
        <button onClick={() => setGroupBy("service")} className="flex-1 text-[11px] font-bold py-1.5 rounded-md" style={{ background: groupBy === "service" ? "var(--ink)" : "transparent", color: groupBy === "service" ? "white" : "var(--ink-soft)" }}>サービス別</button>
        <button onClick={() => setGroupBy("method")} className="flex-1 text-[11px] font-bold py-1.5 rounded-md" style={{ background: groupBy === "method" ? "var(--ink)" : "transparent", color: groupBy === "method" ? "white" : "var(--ink-soft)" }}>支払い方法別</button>
      </div>

      <p className="text-[11px] mb-4" style={{ color: "var(--ink-soft)" }}>支払い履歴に記録された実際の支払いのみを集計しています。</p>

      {segments.length === 0 ? (
        <EmptyState text="この期間の支払い履歴がありません。" />
      ) : (
        <>
          <div className="flex justify-center mb-5"><DonutChart segments={segments} total={total} /></div>
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
          const el = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={seg.color} strokeWidth={stroke} strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-offsetAcc} />;
          offsetAcc += dash;
          return el;
        })}
      </g>
      <text x="50%" y="46%" textAnchor="middle" style={{ fontSize: 12, fill: "var(--ink-soft)", fontFamily: "'Zen Kaku Gothic New',sans-serif" }}>合計</text>
      <text x="50%" y="60%" textAnchor="middle" className="mono" style={{ fontSize: 20, fontWeight: 700, fill: "var(--ink)" }}>{fmtYen(total)}</text>
    </svg>
  );
}

function SubModal({ mode, initial, paymentMethodSuggestions, accounts, onCancel, onSave }) {
  const isResume = mode === "resume";
  const [form, setForm] = useState(
    initial || { name: "", amount: "", category: SUB_CATEGORIES[0], paymentMethod: "", firstPaymentDate: todayStr(), intervalValue: 1, intervalUnit: "month", reminderDays: 3, memo: "" }
  );
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.name.trim() && Number(form.amount) > 0 && form.firstPaymentDate && Number(form.intervalValue) > 0;

  return (
    <Modal onCancel={onCancel} title={isResume ? "サブスクを再開" : mode === "edit" ? "サブスクを編集" : "サブスクを追加"}>
      {isResume && (
        <p className="text-xs mb-3 px-3 py-2 rounded" style={{ background: "var(--brass-soft)", color: "var(--brass)" }}>支払日や間隔を編集しても同じサブスクとして記録されます。再開後の初回支払日を確認してください。</p>
      )}
      <Field label="名前"><input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="例：Netflix" className="input" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="金額"><input type="number" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="1490" className="input mono" /></Field>
        <Field label="カテゴリ">
          <select value={form.category} onChange={(e) => set("category", e.target.value)} className="input">
            {SUB_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <Field label="支払い方法（任意）">
        <input list="payment-methods" value={form.paymentMethod || ""} onChange={(e) => set("paymentMethod", e.target.value)} placeholder="例：楽天カード" className="input" />
        <datalist id="payment-methods">
          {paymentMethodSuggestions?.map((m) => <option key={m} value={m} />)}
        </datalist>
      </Field>
      {accounts && accounts.length > 0 && (
        <Field label="支払い元口座（任意）">
          <select value={form.accountId || ""} onChange={(e) => set("accountId", e.target.value)} className="input">
            <option value="">未割当て（所持金に反映しません）</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="初回支払い日"><input type="date" value={form.firstPaymentDate} onChange={(e) => set("firstPaymentDate", e.target.value)} className="input mono" /></Field>
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
      <Field label="何日前にリマインドするか"><input type="number" min="0" value={form.reminderDays} onChange={(e) => set("reminderDays", e.target.value)} className="input mono" /></Field>
      <Field label="メモ（任意）"><input value={form.memo} onChange={(e) => set("memo", e.target.value)} className="input" /></Field>
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
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState(today);

  const monthKey = `${year}-${pad2(month + 1)}`;
  const cells = useMemo(() => buildCalendarGrid(year, month), [year, month]);

  const dayEvents = useMemo(() => {
    const map = {};
    const push = (dateStr, ev) => { (map[dateStr] ||= []).push(ev); };
    history.forEach((h) => { if (h.date.slice(0, 7) === monthKey) push(h.date, { type: "sub", label: h.name, amount: Number(h.amount) }); });
    subs.forEach((s) => { if (s.status === "active" && s.nextPaymentDate.slice(0, 7) === monthKey) push(s.nextPaymentDate, { type: "sub-upcoming", label: s.name, amount: Number(s.amount) }); });
    txns.forEach((t) => { if (t.date.slice(0, 7) === monthKey) push(t.date, { type: t.type, label: t.category, amount: Number(t.amount) }); });
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
    setMonth(m); setYear(y);
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
          {WEEKDAY_LABELS.map((w, i) => <div key={w} className="text-center text-[11px] font-bold py-1.5" style={{ color: i === 0 ? "var(--clay)" : "var(--ink-soft)", borderBottom: "1px solid var(--rule)" }}>{w}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            if (d === null) return <div key={i} className="border-r border-b" style={{ borderColor: "var(--rule)", minHeight: 64 }} />;
            const dateStr = `${year}-${pad2(month + 1)}-${pad2(d)}`;
            const events = dayEvents[dateStr] || [];
            const isToday = dateStr === today;
            const isSelected = dateStr === selectedDate;
            return (
              <button key={i} onClick={() => setSelectedDate(dateStr)} className="text-left p-1 border-r border-b flex flex-col gap-0.5 overflow-hidden" style={{ borderColor: "var(--rule)", minHeight: 64, background: isSelected ? "var(--paper)" : "transparent" }}>
                <span className="mono text-[11px] w-4 h-4 flex items-center justify-center rounded-full" style={{ background: isToday ? "var(--ink)" : "transparent", color: isToday ? "white" : "var(--ink)" }}>{d}</span>
                {events.slice(0, 2).map((ev, j) => <span key={j} className="text-[9px] px-1 rounded truncate" style={EVENT_STYLE[ev.type]}>{ev.label}</span>)}
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
/* Transactions (list+search / budget)                                  */
/* ------------------------------------------------------------------ */

function TxnsTab({
  txnTab, setTxnTab, txns, monthIncome, monthExpense, freeMoney, budgets, monthExpenseByCategory, onSaveBudgets, onAdd, onEdit, onDelete,
  accounts, totalBalance, unassignedCount, onAddAccount, onEditAccount, onDeleteAccount, onAddTransfer, transfers, onDeleteTransfer,
}) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <StatCard label="今月の収入" value={fmtYen(monthIncome)} accent="var(--green)" />
        <StatCard label="今月の支出" value={fmtYen(monthExpense)} accent="var(--clay)" />
        <StatCard label="収支" value={fmtYen(freeMoney)} />
      </div>

      <div className="flex gap-1 p-1 rounded-lg mb-4" style={{ background: "var(--paper-alt)", border: "1px solid var(--rule)" }}>
        <SegButton active={txnTab === "list"} onClick={() => setTxnTab("list")} icon={List} label="記録" />
        <SegButton active={txnTab === "accounts"} onClick={() => setTxnTab("accounts")} icon={Landmark} label="口座" badge={unassignedCount > 0 && txnTab !== "accounts" ? unassignedCount : 0} />
        <SegButton active={txnTab === "budget"} onClick={() => setTxnTab("budget")} icon={Target} label="予算" />
      </div>

      {txnTab === "list" && <TxnsList txns={txns} accounts={accounts} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} />}
      {txnTab === "budget" && <BudgetPanel budgets={budgets} monthExpenseByCategory={monthExpenseByCategory} onSave={onSaveBudgets} />}
      {txnTab === "accounts" && (
        <AccountsPanel
          accounts={accounts} totalBalance={totalBalance} unassignedCount={unassignedCount}
          onAdd={onAddAccount} onEdit={onEditAccount} onDelete={onDeleteAccount}
          onAddTransfer={onAddTransfer} transfers={transfers} onDeleteTransfer={onDeleteTransfer}
        />
      )}
    </div>
  );
}

function TxnsList({ txns, accounts, onAdd, onEdit, onDelete }) {
  const accountName = (id) => accounts?.find((a) => a.id === id)?.name || "";
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");

  const categories = filterType === "income" ? INCOME_CATEGORIES : filterType === "expense" ? EXPENSE_CATEGORIES : ALL_CATEGORIES;

  const filtered = useMemo(() => {
    return txns
      .filter((t) => {
        if (filterType !== "all" && t.type !== filterType) return false;
        if (filterCategory !== "all" && t.category !== filterCategory) return false;
        if (search && !t.category.includes(search) && !(t.note || "").includes(search)) return false;
        return true;
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [txns, search, filterType, filterCategory]);

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <button onClick={() => onAdd("income")} className="flex-1 flex items-center justify-center gap-1 text-sm font-bold px-3 py-2.5 rounded-lg" style={{ background: "var(--green-soft)", color: "var(--green)" }}><Plus size={15} /> 収入を追加</button>
        <button onClick={() => onAdd("expense")} className="flex-1 flex items-center justify-center gap-1 text-sm font-bold px-3 py-2.5 rounded-lg" style={{ background: "var(--clay-soft)", color: "var(--clay)" }}><Plus size={15} /> 支出を追加</button>
      </div>

      <div className="rounded-lg p-2.5 mb-3 space-y-2" style={{ background: "var(--paper-alt)", border: "1px solid var(--rule)" }}>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--ink-soft)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="カテゴリ・メモで検索" className="input pl-7 text-xs" />
        </div>
        <div className="flex gap-2">
          <select value={filterType} onChange={(e) => { setFilterType(e.target.value); setFilterCategory("all"); }} className="input text-xs flex-1">
            <option value="all">すべて</option>
            <option value="income">収入</option>
            <option value="expense">支出</option>
          </select>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="input text-xs flex-1">
            <option value="all">全カテゴリ</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState text={txns.length === 0 ? "収支の記録がありません。上のボタンから追加してください。" : "条件に一致する記録がありません。"} />
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--rule)", background: "var(--paper-alt)" }}>
          {filtered.map((t, i) => (
            <div key={t.id} className="flex items-center justify-between px-4 py-3" style={{ borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: t.type === "income" ? "var(--green-soft)" : "var(--clay-soft)", color: t.type === "income" ? "var(--green)" : "var(--clay)" }}>{t.category}</span>
                  <span className="text-xs mono" style={{ color: "var(--ink-soft)" }}>{fmtDate(t.date)}</span>
                </div>
                {(t.note || accountName(t.accountId)) && (
                  <div className="text-xs mt-1 truncate" style={{ color: "var(--ink-soft)" }}>
                    {accountName(t.accountId) && <span className="mono">[{accountName(t.accountId)}] </span>}
                    {t.note}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <span className="mono font-bold" style={{ color: t.type === "income" ? "var(--green)" : "var(--clay)" }}>{t.type === "income" ? "+" : "-"}{fmtYen(t.amount)}</span>
                <button onClick={() => onEdit(t)} style={{ color: "var(--ink-soft)" }}><Edit2 size={14} /></button>
                <button onClick={() => onDelete(t.id)} style={{ color: "var(--ink-soft)" }}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BudgetPanel({ budgets, monthExpenseByCategory, onSave }) {
  const [draft, setDraft] = useState(budgets);
  useEffect(() => { setDraft(budgets); }, [budgets]);
  const setVal = (cat, v) => setDraft((d) => ({ ...d, [cat]: v }));
  const save = () => onSave(Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, Number(draft[c]) || 0])));

  return (
    <div>
      <p className="text-xs mb-3" style={{ color: "var(--ink-soft)" }}>カテゴリごとに今月の予算上限を設定できます（0円または未入力の場合は表示のみ非表示になります）。</p>
      <div className="space-y-2.5">
        {EXPENSE_CATEGORIES.map((cat) => {
          const limit = Number(budgets[cat]) || 0;
          const used = monthExpenseByCategory[cat] || 0;
          const ratio = limit > 0 ? used / limit : 0;
          const over = limit > 0 && used > limit;
          const barColor = !limit ? "var(--rule)" : over ? "var(--clay)" : ratio > 0.8 ? "var(--brass)" : "var(--green)";
          return (
            <div key={cat} className="rounded-lg p-3" style={{ background: "var(--paper-alt)", border: "1px solid var(--rule)" }}>
              <div className="flex items-center justify-between mb-1.5 gap-2">
                <span className="text-sm font-bold" style={{ color: "var(--ink)" }}>{cat}</span>
                <input type="number" min="0" value={draft[cat] ?? ""} onChange={(e) => setVal(cat, e.target.value)} placeholder="未設定" className="input mono w-28 text-right text-xs py-1" />
              </div>
              {limit > 0 && (
                <>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--rule)" }}>
                    <div style={{ width: `${Math.min(ratio * 100, 100)}%`, background: barColor, height: "100%" }} />
                  </div>
                  <div className="text-[11px] mt-1 mono" style={{ color: over ? "var(--clay)" : "var(--ink-soft)" }}>{fmtYen(used)} / {fmtYen(limit)}{over ? "（予算超過）" : ""}</div>
                </>
              )}
            </div>
          );
        })}
      </div>
      <button onClick={save} className="w-full mt-4 font-bold text-sm px-4 py-2.5 rounded-lg text-white" style={{ background: "var(--ink)" }}>予算を保存</button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Accounts (wallets / bank accounts) & transfers                        */
/* ------------------------------------------------------------------ */

function AccountsPanel({ accounts, totalBalance, unassignedCount, onAdd, onEdit, onDelete, onAddTransfer, transfers, onDeleteTransfer }) {
  const accountName = (id) => accounts.find((a) => a.id === id)?.name || "削除済みの口座";
  const sortedTransfers = useMemo(() => [...transfers].sort((a, b) => (a.date < b.date ? 1 : -1)), [transfers]);

  return (
    <div>
      <div className="rounded-xl p-5 mb-4" style={{ background: "var(--ink)", color: "white" }}>
        <div className="text-xs opacity-70">口座残高の合計</div>
        <div className="mono text-3xl font-bold mt-1">{fmtYen(totalBalance)}</div>
      </div>

      {unassignedCount > 0 && (
        <div className="flex items-center gap-2 text-xs mb-4 px-3 py-2 rounded-lg" style={{ background: "var(--brass-soft)", color: "var(--brass)" }}>
          <AlertCircle size={14} /> 口座が未設定の収支・サブスク支払いが{unassignedCount}件あります。記録の編集画面から口座を割り当てられます。
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <button onClick={onAdd} className="flex-1 flex items-center justify-center gap-1 text-sm font-bold px-3 py-2.5 rounded-lg text-white" style={{ background: "var(--ink)" }}><Plus size={15} /> 口座を追加</button>
        <button onClick={onAddTransfer} disabled={accounts.length < 2} className="flex-1 flex items-center justify-center gap-1 text-sm font-bold px-3 py-2.5 rounded-lg" style={{ background: accounts.length < 2 ? "var(--rule)" : "var(--brass-soft)", color: accounts.length < 2 ? "var(--ink-soft)" : "var(--brass)" }}>
          <ArrowLeftRight size={15} /> 振替
        </button>
      </div>

      {accounts.length === 0 ? (
        <EmptyState text="口座が登録されていません。「口座を追加」から、財布や銀行口座などを登録してください。" />
      ) : (
        <div className="space-y-2.5 mb-6">
          {accounts.map((a) => (
            <div key={a.id} className="rounded-lg p-4 flex items-center justify-between gap-3" style={{ background: "var(--paper-alt)", border: "1px solid var(--rule)" }}>
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar name={a.name} />
                <div className="min-w-0">
                  <div className="font-bold text-sm truncate" style={{ color: "var(--ink)" }}>{a.name}</div>
                  {a.memo && <div className="text-xs truncate" style={{ color: "var(--ink-soft)" }}>{a.memo}</div>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="mono font-bold" style={{ color: a.balance < 0 ? "var(--clay)" : "var(--ink)" }}>{fmtYen(a.balance)}</span>
                <button onClick={() => onEdit(a)} style={{ color: "var(--ink-soft)" }}><Edit2 size={14} /></button>
                <button onClick={() => onDelete(a.id)} style={{ color: "var(--ink-soft)" }}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {sortedTransfers.length > 0 && (
        <div>
          <h3 className="text-sm font-bold mb-2" style={{ color: "var(--ink)" }}>振替履歴</h3>
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--rule)", background: "var(--paper-alt)" }}>
            {sortedTransfers.map((tr, i) => (
              <div key={tr.id} className="flex items-center justify-between px-4 py-3" style={{ borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}>
                <div className="min-w-0">
                  <div className="text-sm truncate" style={{ color: "var(--ink)" }}>{accountName(tr.fromAccountId)} → {accountName(tr.toAccountId)}</div>
                  <div className="text-xs mono" style={{ color: "var(--ink-soft)" }}>{fmtDate(tr.date)}{tr.note ? ` ・ ${tr.note}` : ""}</div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="mono font-bold" style={{ color: "var(--ink)" }}>{fmtYen(tr.amount)}</span>
                  <button onClick={() => onDeleteTransfer(tr.id)} style={{ color: "var(--ink-soft)" }}><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AccountModal({ mode, initial, isFirstAccount, unassignedCount, onCancel, onSave }) {
  const [form, setForm] = useState(initial || { name: "", initialBalance: "", memo: "", assignUnassigned: isFirstAccount && unassignedCount > 0 });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.name.trim();
  return (
    <Modal onCancel={onCancel} title={mode === "edit" ? "口座を編集" : "口座を追加"}>
      <Field label="口座名"><input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="例：財布、〇〇銀行" className="input" /></Field>
      <Field label={mode === "edit" ? "初期残高" : "現在の残高（登録時点）"}>
        <input type="number" value={form.initialBalance} onChange={(e) => set("initialBalance", e.target.value)} placeholder="0" className="input mono" />
      </Field>
      <Field label="メモ（任意）"><input value={form.memo || ""} onChange={(e) => set("memo", e.target.value)} className="input" /></Field>
      {mode !== "edit" && isFirstAccount && unassignedCount > 0 && (
        <label className="flex items-start gap-2 text-xs mb-3 px-3 py-2 rounded-lg cursor-pointer" style={{ background: "var(--brass-soft)", color: "var(--brass)" }}>
          <input type="checkbox" checked={!!form.assignUnassigned} onChange={(e) => set("assignUnassigned", e.target.checked)} className="mt-0.5" />
          既存の口座未設定の収支・サブスク支払い（{unassignedCount}件）をこの口座に割り当てる
        </label>
      )}
      <ModalActions onCancel={onCancel} onSave={() => valid && onSave(form)} disabled={!valid} />
    </Modal>
  );
}

function TransferModal({ accounts, today, onCancel, onSave }) {
  const [form, setForm] = useState({ fromAccountId: accounts[0]?.id || "", toAccountId: accounts[1]?.id || "", amount: "", date: today, note: "" });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const valid = Number(form.amount) > 0 && form.fromAccountId && form.toAccountId && form.fromAccountId !== form.toAccountId;
  return (
    <Modal onCancel={onCancel} title="口座間の振替">
      <Field label="振替元">
        <select value={form.fromAccountId} onChange={(e) => set("fromAccountId", e.target.value)} className="input">
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}（{fmtYen(a.balance)}）</option>)}
        </select>
      </Field>
      <Field label="振替先">
        <select value={form.toAccountId} onChange={(e) => set("toAccountId", e.target.value)} className="input">
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}（{fmtYen(a.balance)}）</option>)}
        </select>
      </Field>
      {form.fromAccountId === form.toAccountId && (
        <p className="text-xs mb-3" style={{ color: "var(--clay)" }}>振替元と振替先は別の口座にしてください。</p>
      )}
      <Field label="金額"><input type="number" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} className="input mono" /></Field>
      <Field label="日付"><input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className="input mono" /></Field>
      <Field label="メモ（任意）"><input value={form.note} onChange={(e) => set("note", e.target.value)} className="input" /></Field>
      <ModalActions onCancel={onCancel} onSave={() => valid && onSave(form)} disabled={!valid} />
    </Modal>
  );
}

function TxnModal({ type, defaultDate, initial, accounts, onCancel, onSave }) {
  const cats = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const defaultAccountId = accounts && accounts.length === 1 ? accounts[0].id : "";
  const [form, setForm] = useState(initial ? { ...initial } : { type, category: cats[0], amount: "", date: defaultDate, note: "", accountId: defaultAccountId });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const valid = Number(form.amount) > 0 && form.date;
  return (
    <Modal onCancel={onCancel} title={initial ? "記録を編集" : type === "income" ? "収入を追加" : "支出を追加"}>
      <Field label="カテゴリ">
        <select value={form.category} onChange={(e) => set("category", e.target.value)} className="input">
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="金額"><input type="number" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} className="input mono" /></Field>
      <Field label="日付"><input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className="input mono" /></Field>
      {accounts && accounts.length > 0 && (
        <Field label="口座">
          <select value={form.accountId || ""} onChange={(e) => set("accountId", e.target.value)} className="input">
            <option value="">未割当て（所持金に反映しません）</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="メモ（任意）"><input value={form.note} onChange={(e) => set("note", e.target.value)} className="input" /></Field>
      <ModalActions onCancel={onCancel} onSave={() => valid && onSave(form)} disabled={!valid} saveLabel={initial ? "更新" : "保存"} />
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Assets                                                                */
/* ------------------------------------------------------------------ */

function LineChart({ data, color = "var(--ink)", height = 140 }) {
  if (!data || data.length === 0) return null;
  const width = 560, padding = 28;
  const values = data.map((d) => d.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const stepX = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 0;
  const points = data.map((d, i) => ({ x: padding + i * stepX, y: padding + (1 - (d.value - min) / range) * (height - padding * 2) }));
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaD = `${pathD} L${points[points.length - 1].x.toFixed(1)},${height - padding} L${points[0].x.toFixed(1)},${height - padding} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
      <path d={areaD} fill={color} opacity="0.08" />
      <path d={pathD} fill="none" stroke={color} strokeWidth="2" />
      {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={color} />)}
      <text x={padding} y={height - 6} style={{ fontSize: 10, fill: "var(--ink-soft)" }}>{fmtDate(data[0].date)}</text>
      <text x={width - padding} y={height - 6} textAnchor="end" style={{ fontSize: 10, fill: "var(--ink-soft)" }}>{fmtDate(data[data.length - 1].date)}</text>
    </svg>
  );
}

function AssetsTab({ assets, assetHistory, onSave, totalValuation, totalGainLoss }) {
  const [draft, setDraft] = useState(assets);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDraft(assets); }, [assets]);

  const setField = (key, field, val) => { setDraft((d) => ({ ...d, [key]: { ...d[key], [field]: val } })); setDirty(true); };
  const save = () => {
    const cleaned = {};
    ASSET_TYPES.forEach((t) => { cleaned[t.key] = { valuation: Number(draft[t.key]?.valuation) || 0, gainLoss: Number(draft[t.key]?.gainLoss) || 0 }; });
    onSave(cleaned);
    setDirty(false);
  };

  const chartData = useMemo(() => assetHistory.map((h) => ({ date: h.date, value: h.totalValuation })), [assetHistory]);
  const prevSnapshot = assetHistory.length > 1 ? assetHistory[assetHistory.length - 2] : null;
  const diff = prevSnapshot ? totalValuation - prevSnapshot.totalValuation : null;

  return (
    <div>
      <div className="rounded-xl p-5 mb-4" style={{ background: "var(--brass)", color: "white" }}>
        <div className="text-xs opacity-85">資産評価額合計（自由に使えるお金には含みません）</div>
        <div className="mono text-3xl font-bold mt-1">{fmtYen(totalValuation)}</div>
        <div className="mono text-sm mt-1 opacity-90">評価損益 {totalGainLoss >= 0 ? "+" : ""}{fmtYen(totalGainLoss)}</div>
        {diff !== null && <div className="mono text-xs mt-1 opacity-80">前回記録比 {diff >= 0 ? "+" : ""}{fmtYen(diff)}</div>}
      </div>

      {chartData.length >= 2 && (
        <div className="rounded-lg p-3 mb-5" style={{ background: "var(--paper-alt)", border: "1px solid var(--rule)" }}>
          <div className="text-xs font-bold mb-1" style={{ color: "var(--ink-soft)" }}>資産評価額の推移</div>
          <LineChart data={chartData} color="var(--brass)" />
        </div>
      )}

      <div className="space-y-3">
        {ASSET_TYPES.map((t) => {
          const v = draft[t.key] || { valuation: 0, gainLoss: 0 };
          const gl = Number(v.gainLoss) || 0;
          return (
            <div key={t.key} className="rounded-lg p-4" style={{ background: "var(--paper-alt)", border: "1px solid var(--rule)" }}>
              <div className="text-sm font-bold mb-2" style={{ color: "var(--ink)" }}>{t.label}</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="資産評価額"><input type="number" value={v.valuation} onChange={(e) => setField(t.key, "valuation", e.target.value)} className="input mono" /></Field>
                <Field label="評価損益"><input type="number" value={v.gainLoss} onChange={(e) => setField(t.key, "gainLoss", e.target.value)} className="input mono" style={{ color: gl >= 0 ? "var(--green)" : "var(--clay)" }} /></Field>
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={save} disabled={!dirty} className="w-full mt-5 flex items-center justify-center gap-1.5 font-bold text-sm px-4 py-3 rounded-lg text-white" style={{ background: dirty ? "var(--ink)" : "var(--rule)", cursor: dirty ? "pointer" : "default" }}>
        <Check size={15} /> {dirty ? "資産情報を保存" : "保存済み"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Monthly report                                                        */
/* ------------------------------------------------------------------ */

function ReportTab({ today, txns, history, subs, assetHistory, assetValuationTotal }) {
  const thisMonthKey = today.slice(0, 7);
  const prevMonthKey = shiftMonthKey(thisMonthKey, -1);

  const sumFor = (list, key, type) => list.filter((x) => x.date.slice(0, 7) === key && (!type || x.type === type)).reduce((s, x) => s + Number(x.amount), 0);

  const thisIncome = sumFor(txns, thisMonthKey, "income");
  const thisExpense = sumFor(txns, thisMonthKey, "expense");
  const thisSub = sumFor(history, thisMonthKey);
  const prevIncome = sumFor(txns, prevMonthKey, "income");
  const prevExpense = sumFor(txns, prevMonthKey, "expense");
  const prevSub = sumFor(history, prevMonthKey);
  const thisNet = thisIncome - thisExpense - thisSub;
  const prevNet = prevIncome - prevExpense - prevSub;

  const topExpenseCategories = useMemo(() => {
    const m = {};
    txns.filter((t) => t.type === "expense" && t.date.slice(0, 7) === thisMonthKey).forEach((t) => { m[t.category] = (m[t.category] || 0) + Number(t.amount); });
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5);
  }, [txns, thisMonthKey]);

  const topSubs = useMemo(() => {
    const m = {};
    history.filter((h) => h.date.slice(0, 7) === thisMonthKey).forEach((h) => { m[h.name] = (m[h.name] || 0) + Number(h.amount); });
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5);
  }, [history, thisMonthKey]);

  const maxExpenseCat = topExpenseCategories[0]?.value || 1;
  const maxSub = topSubs[0]?.value || 1;

  const prevAssetSnapshot = useMemo(() => {
    const candidates = assetHistory.filter((h) => h.date < `${thisMonthKey}-01`);
    return candidates.length ? candidates[candidates.length - 1] : null;
  }, [assetHistory, thisMonthKey]);
  const assetDiff = prevAssetSnapshot ? assetValuationTotal - prevAssetSnapshot.totalValuation : null;

  const Delta = ({ value, invert }) => {
    if (value === 0) return <span className="mono text-xs" style={{ color: "var(--ink-soft)" }}>±0</span>;
    const good = invert ? value < 0 : value > 0;
    return <span className="mono text-xs font-bold" style={{ color: good ? "var(--green)" : "var(--clay)" }}>{value > 0 ? "+" : ""}{fmtYen(value)}</span>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="serif text-lg font-bold mb-1" style={{ color: "var(--ink)" }}>{thisMonthKey.replace("-", "年")}月のレポート</h2>
        <p className="text-xs" style={{ color: "var(--ink-soft)" }}>先月（{prevMonthKey.replace("-", "年")}月）との比較</p>
      </div>

      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--rule)", background: "var(--paper-alt)" }}>
        {[
          { label: "収入", now: thisIncome, prev: prevIncome, invert: false },
          { label: "支出", now: thisExpense, prev: prevExpense, invert: true },
          { label: "サブスク支払い", now: thisSub, prev: prevSub, invert: true },
          { label: "自由に使えるお金", now: thisNet, prev: prevNet, invert: false },
        ].map((row, i) => (
          <div key={row.label} className="flex items-center justify-between px-4 py-3" style={{ borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}>
            <span className="text-sm" style={{ color: "var(--ink)" }}>{row.label}</span>
            <div className="text-right">
              <div className="mono font-bold" style={{ color: "var(--ink)" }}>{fmtYen(row.now)}</div>
              <Delta value={row.now - row.prev} invert={row.invert} />
            </div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-bold mb-2" style={{ color: "var(--ink)" }}>支出カテゴリ トップ5（今月）</h3>
        {topExpenseCategories.length === 0 ? <EmptyState text="今月の支出記録がありません。" /> : (
          <div className="space-y-2">
            {topExpenseCategories.map((c) => (
              <div key={c.name}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span style={{ color: "var(--ink)" }}>{c.name}</span>
                  <span className="mono font-bold" style={{ color: "var(--ink)" }}>{fmtYen(c.value)}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--rule)" }}>
                  <div style={{ width: `${(c.value / maxExpenseCat) * 100}%`, background: "var(--clay)", height: "100%" }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-bold mb-2" style={{ color: "var(--ink)" }}>サブスク支払い トップ5（今月）</h3>
        {topSubs.length === 0 ? <EmptyState text="今月のサブスク支払い履歴がありません。" /> : (
          <div className="space-y-2">
            {topSubs.map((c) => (
              <div key={c.name}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span style={{ color: "var(--ink)" }}>{c.name}</span>
                  <span className="mono font-bold" style={{ color: "var(--ink)" }}>{fmtYen(c.value)}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--rule)" }}>
                  <div style={{ width: `${(c.value / maxSub) * 100}%`, background: "var(--brass)", height: "100%" }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg p-4" style={{ background: "var(--brass-soft)", border: "1px solid var(--brass)" }}>
        <div className="text-xs" style={{ color: "var(--brass)" }}>資産評価額（現在）</div>
        <div className="mono text-xl font-bold mt-1" style={{ color: "var(--ink)" }}>{fmtYen(assetValuationTotal)}</div>
        {assetDiff !== null ? (
          <div className="mono text-xs mt-1" style={{ color: assetDiff >= 0 ? "var(--green)" : "var(--clay)" }}>先月末比 {assetDiff >= 0 ? "+" : ""}{fmtYen(assetDiff)}</div>
        ) : (
          <div className="text-[11px] mt-1" style={{ color: "var(--ink-soft)" }}>先月の記録がまだありません。</div>
        )}
      </div>
    </div>
  );
}
