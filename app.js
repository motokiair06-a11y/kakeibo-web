/* ==================================================================
   家計ノート - app.js (ビルド不要のプレーンJS版)
   ================================================================== */

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------------- 定数 ---------------- */

const DEFAULT_CATEGORIES = [
  { name: "食費", type: "expense", color: "#C15B4A", budget: 40000 },
  { name: "住居費", type: "expense", color: "#4A6C8C", budget: 70000 },
  { name: "交通費", type: "expense", color: "#8C7A4A", budget: 10000 },
  { name: "娯楽費", type: "expense", color: "#7A4A8C", budget: 15000 },
  { name: "日用品", type: "expense", color: "#4A8C6E", budget: 12000 },
  { name: "サブスク", type: "expense", color: "#B8935F", budget: 8000 },
  { name: "医療費", type: "expense", color: "#8C4A4A", budget: 6000 },
  { name: "給与", type: "income", color: "#29695A", budget: 0 },
  { name: "副収入", type: "income", color: "#4FB894", budget: 0 },
  { name: "その他", type: "expense", color: "#6B6B6B", budget: 5000 },
];
const DEFAULT_ACCOUNTS = [
  { name: "財布", type: "cash", balance: 0 },
  { name: "普通預金", type: "bank", balance: 0 },
];
const PAYMENT_METHODS = ["現金", "クレジットカード", "銀行振込", "電子マネー", "その他"];
const TABS = [
  { id: "dashboard", label: "ダッシュボード", icon: "📊" },
  { id: "transactions", label: "記録", icon: "💰" },
  { id: "subscriptions", label: "サブスク", icon: "🔁" },
  { id: "budget", label: "予算", icon: "🎯" },
  { id: "accounts", label: "資産", icon: "🏦" },
  { id: "reports", label: "レポート", icon: "📈" },
  { id: "settings", label: "設定", icon: "⚙️" },
];

/* ---------------- ヘルパー ---------------- */

const esc = (s) => (s == null ? "" : String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
const yen = (n) => "¥" + Math.round(Number(n) || 0).toLocaleString("ja-JP");
const todayISO = () => new Date().toISOString().slice(0, 10);
const ymKey = (d) => d.slice(0, 7);
const monthLabel = (ym) => { const [y, m] = ym.split("-"); return `${y}年${parseInt(m, 10)}月`; };
function addMonths(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function daysUntil(dateStr) {
  const t = new Date(todayISO());
  const d = new Date(dateStr);
  return Math.round((d - t) / 86400000);
}
function nextBillingDate(sub) {
  const today = new Date(todayISO());
  if (sub.cycle === "monthly") {
    let day = Math.min(sub.billing_day || 1, 28);
    let c = new Date(today.getFullYear(), today.getMonth(), day);
    if (c < today) c = new Date(today.getFullYear(), today.getMonth() + 1, day);
    return c.toISOString().slice(0, 10);
  } else {
    const [mm, dd] = (sub.billing_month_day || "01-01").split("-").map(Number);
    let c = new Date(today.getFullYear(), mm - 1, dd);
    if (c < today) c = new Date(today.getFullYear() + 1, mm - 1, dd);
    return c.toISOString().slice(0, 10);
  }
}
function advanceBillingDate(sub, fromDateStr) {
  const d = new Date(fromDateStr);
  if (sub.cycle === "monthly") {
    const day = Math.min(sub.billing_day || 1, 28);
    return new Date(d.getFullYear(), d.getMonth() + 1, day).toISOString().slice(0, 10);
  }
  return new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()).toISOString().slice(0, 10);
}
function monthlyCost(sub) { return sub.cycle === "monthly" ? Number(sub.amount) : Number(sub.amount) / 12; }

function buildCashFlowProjection({ startBalance, transactions, subscriptions, targetDate, includePending }) {
  const today = todayISO();
  const events = [];
  transactions.forEach((t) => {
    if (t.date > today && t.date <= targetDate) {
      if (t.status === "pending" && !includePending) return;
      events.push({ date: t.date, amount: t.type === "income" ? Number(t.amount) : -Number(t.amount), pending: t.status === "pending" });
    }
  });
  subscriptions.filter((s) => s.active !== false).forEach((s) => {
    let d = nextBillingDate(s), guard = 0;
    while (d <= targetDate && guard < 60) {
      events.push({ date: d, amount: -Number(s.amount), pending: false });
      d = advanceBillingDate(s, d); guard++;
    }
  });
  events.sort((a, b) => a.date.localeCompare(b.date));
  let running = startBalance;
  const points = [{ date: today, balance: running }];
  events.forEach((e) => { running += e.amount; points.push({ date: e.date, balance: running }); });
  const confirmedDelta = events.filter((e) => !e.pending).reduce((s, e) => s + e.amount, 0);
  const pendingDelta = events.filter((e) => e.pending).reduce((s, e) => s + e.amount, 0);
  return { points, final: running, confirmedDelta, pendingDelta, eventCount: events.length };
}

function stamp(name, color, size) {
  size = size || 32;
  return `<div class="stamp" style="width:${size}px;height:${size}px;background:${color || "#999"};font-size:${size * 0.42}px;">${esc(name ? name[0] : "?")}</div>`;
}

/* ---------------- 状態 ---------------- */

const state = {
  user: null,
  settings: null,
  categories: [], transactions: [], subscriptions: [], accounts: [],
  tab: "dashboard",
  month: ymKey(todayISO()),
  filterTag: "",
  modal: null, // { type, id, draft }
  toastTimer: null,
  charts: {},
  fundsTargetDate: todayISO(),
  fundsIncludePending: true,
};

/* ---------------- 初期化・認証 ---------------- */

async function init() {
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    await onLogin(data.session.user);
  } else {
    showAuth();
  }
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session) onLogin(session.user);
    if (event === "SIGNED_OUT") { state.user = null; location.reload(); }
  });
  document.getElementById("authForm").addEventListener("submit", handleAuthSubmit);
}

function showAuth() {
  document.getElementById("loadingScreen").style.display = "none";
  document.getElementById("authScreen").style.display = "flex";
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = document.getElementById("authEmail").value.trim();
  if (!email) return;
  const btn = document.getElementById("authSubmitBtn");
  btn.disabled = true; btn.textContent = "送信中…";
  const { error } = await supabaseClient.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href.split("#")[0] } });
  btn.disabled = false; btn.textContent = "ログインリンクを送る";
  if (error) {
    const errEl = document.getElementById("authError");
    errEl.textContent = "送信に失敗しました。メールアドレスを確認してください。";
    errEl.style.display = "block";
  } else {
    document.getElementById("authFormArea").style.display = "none";
    document.getElementById("authSent").style.display = "flex";
    document.getElementById("authSentMsg").textContent = `${email} 宛にログイン用リンクを送信しました。メールを開いてリンクをタップしてください。`;
  }
}

async function onLogin(user) {
  state.user = user;
  document.getElementById("authScreen").style.display = "none";
  document.getElementById("loadingScreen").style.display = "flex";

  let { data: s } = await supabaseClient.from("user_settings").select("*").eq("user_id", user.id).maybeSingle();
  if (!s) {
    const { data: created } = await supabaseClient.from("user_settings")
      .insert({ user_id: user.id, active_household_id: user.id, dark_mode: false }).select().single();
    s = created;
  }
  state.settings = s;
  if (s.dark_mode) document.body.classList.add("dark");

  await loadAllData(s.active_household_id);

  document.getElementById("loadingScreen").style.display = "none";
  document.getElementById("appRoot").style.display = "block";
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.settings) loadAllData(state.settings.active_household_id).then(render);
  });
  render();
}

async function loadAllData(hh) {
  const [{ data: cats }, { data: tx }, { data: subs }, { data: accs }] = await Promise.all([
    supabaseClient.from("categories").select("*").eq("household_id", hh).order("created_at"),
    supabaseClient.from("transactions").select("*").eq("household_id", hh).order("date", { ascending: false }),
    supabaseClient.from("subscriptions").select("*").eq("household_id", hh).order("created_at"),
    supabaseClient.from("accounts").select("*").eq("household_id", hh).order("created_at"),
  ]);

  let finalCats = cats || [];
  if (hh === state.user.id && finalCats.length === 0) {
    const { data: seeded } = await supabaseClient.from("categories")
      .insert(DEFAULT_CATEGORIES.map((c) => ({ ...c, household_id: hh, owner_id: state.user.id }))).select();
    finalCats = seeded || [];
  }
  let finalAccs = accs || [];
  if (hh === state.user.id && finalAccs.length === 0) {
    const { data: seeded } = await supabaseClient.from("accounts")
      .insert(DEFAULT_ACCOUNTS.map((a) => ({ ...a, household_id: hh, owner_id: state.user.id }))).select();
    finalAccs = seeded || [];
  }

  state.categories = finalCats;
  state.transactions = tx || [];
  state.subscriptions = subs || [];
  state.accounts = finalAccs;
}

/* ---------------- 派生データ ---------------- */

function catById(id) { return state.categories.find((c) => c.id === id); }

function getMonthTx() {
  return state.transactions.filter((t) => ymKey(t.date) === state.month && (!state.filterTag || (t.tags || []).includes(state.filterTag)));
}
function getAllTags() {
  const s = new Set();
  state.transactions.forEach((t) => (t.tags || []).forEach((tag) => s.add(tag)));
  return Array.from(s);
}
function getCategoryBreakdown(monthTx) {
  const map = {};
  monthTx.filter((t) => t.type === "expense" && t.status !== "pending").forEach((t) => { map[t.category_id] = (map[t.category_id] || 0) + Number(t.amount); });
  return Object.entries(map).map(([catId, amount]) => {
    const c = catById(catId);
    return { catId, name: c ? c.name : "不明", amount, color: c ? c.color : "#999" };
  }).sort((a, b) => b.amount - a.amount);
}
function getNetWorth() { return state.accounts.reduce((s, a) => s + Number(a.balance || 0), 0); }
function getTrend(month) {
  const arr = [];
  for (let i = 5; i >= 0; i--) {
    const ym = addMonths(month, -i);
    const txs = state.transactions.filter((t) => ymKey(t.date) === ym && t.status !== "pending");
    arr.push({
      label: ym.slice(5) + "月",
      income: txs.filter((t) => t.type === "income").reduce((s, t) => s + Number(t.amount), 0),
      expense: txs.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0),
    });
  }
  return arr;
}

/* ---------------- レンダリング(トップレベル) ---------------- */

function render() {
  document.getElementById("monthLabel").textContent = monthLabel(state.month);
  document.getElementById("darkToggleBtn").textContent = state.settings.dark_mode ? "☀️" : "🌙";
  document.getElementById("appRoot").classList.toggle("dark", !!state.settings.dark_mode);
  document.body.classList.toggle("dark", !!state.settings.dark_mode);

  renderBanner();
  renderTabbar();
  renderFab();
  renderTabContent();
  renderModal();
}

function renderBanner() {
  const el = document.getElementById("bannerArea");
  if (state.settings.active_household_id !== state.user.id) {
    el.innerHTML = `<div class="banner-shared">👪 共有家計簿を表示中(自分のデータではありません)</div>`;
  } else {
    el.innerHTML = "";
  }
}

function renderTabbar() {
  const el = document.getElementById("tabbar");
  el.innerHTML = TABS.map((t) => `
    <button class="tab-btn ${state.tab === t.id ? "active" : ""}" onclick="app.switchTab('${t.id}')">
      <span class="tab-icon">${t.icon}</span><span class="tab-label">${t.label}</span>
    </button>`).join("");
}

function renderFab() {
  const fab = document.getElementById("fabBtn");
  if (state.tab === "dashboard" || state.tab === "transactions") { fab.style.display = "flex"; fab.textContent = "＋"; fab.onclick = () => app.openTxModal(); }
  else if (state.tab === "subscriptions") { fab.style.display = "flex"; fab.textContent = "＋"; fab.onclick = () => app.openSubModal(); }
  else if (state.tab === "accounts") { fab.style.display = "flex"; fab.textContent = "＋"; fab.onclick = () => app.openAccModal(); }
  else { fab.style.display = "none"; }
}

function renderTabContent() {
  const el = document.getElementById("tabContent");
  switch (state.tab) {
    case "dashboard": el.innerHTML = renderDashboard(); afterDashboardRender(); break;
    case "transactions": el.innerHTML = renderTransactions(); break;
    case "subscriptions": el.innerHTML = renderSubscriptions(); break;
    case "budget": el.innerHTML = renderBudget(); break;
    case "accounts": el.innerHTML = renderAccounts(); break;
    case "reports": el.innerHTML = renderReports(); afterReportsRender(); break;
    case "settings": el.innerHTML = renderSettings(); break;
  }
}

function toast(msg) {
  const el = document.getElementById("toastRoot");
  el.innerHTML = `<div class="toast">${esc(msg)}</div>`;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { el.innerHTML = ""; }, 2200);
}

function makeChart(key, canvasId, config) {
  if (state.charts[key]) { state.charts[key].destroy(); }
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  state.charts[key] = new Chart(canvas.getContext("2d"), config);
}

/* ---------------- ダッシュボード ---------------- */

function renderDashboard() {
  const monthTx = getMonthTx();
  const monthIncome = monthTx.filter((t) => t.type === "income" && t.status !== "pending").reduce((s, t) => s + Number(t.amount), 0);
  const monthExpense = monthTx.filter((t) => t.type === "expense" && t.status !== "pending").reduce((s, t) => s + Number(t.amount), 0);
  const pendingIncome = monthTx.filter((t) => t.type === "income" && t.status === "pending").reduce((s, t) => s + Number(t.amount), 0);
  const pendingExpense = monthTx.filter((t) => t.type === "expense" && t.status === "pending").reduce((s, t) => s + Number(t.amount), 0);
  const prevMonth = addMonths(state.month, -1);
  const prevTx = state.transactions.filter((t) => ymKey(t.date) === prevMonth && t.status !== "pending");
  const prevExpense = prevTx.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const diffExpense = prevExpense > 0 ? ((monthExpense - prevExpense) / prevExpense) * 100 : null;
  const balance = monthIncome - monthExpense;
  const netWorth = getNetWorth();
  const subsMonthlyTotal = state.subscriptions.filter((s) => s.active !== false).reduce((s, sub) => s + monthlyCost(sub), 0);
  const subsShare = monthExpense > 0 ? (subsMonthlyTotal / monthExpense) * 100 : 0;
  const breakdown = getCategoryBreakdown(monthTx);

  const upcomingSubs = state.subscriptions.filter((s) => s.active !== false)
    .map((s) => ({ ...s, next: nextBillingDate(s) })).filter((s) => daysUntil(s.next) <= 7)
    .sort((a, b) => a.next.localeCompare(b.next));

  return `
  <div class="stack">
    <section class="hero-summary">
      <div class="hero-card">
        <span class="hero-label">今月の収支(確定分)</span>
        <span class="hero-value ${balance < 0 ? "neg" : ""}">${yen(balance)}</span>
        <div class="hero-sub-row">
          <span class="chip income">↑ 収入 ${yen(monthIncome)}</span>
          <span class="chip expense">↓ 支出 ${yen(monthExpense)}</span>
        </div>
        ${(pendingIncome > 0 || pendingExpense > 0) ? `<div class="hero-sub-row"><span class="chip pending">未確定 +${yen(pendingIncome)} / −${yen(pendingExpense)}</span></div>` : ""}
      </div>
      <div class="mini-cards">
        <div class="mini-card"><span class="mini-label">前月比(支出)</span><span class="mini-value ${diffExpense > 0 ? "neg" : diffExpense < 0 ? "pos" : ""}">${diffExpense === null ? "—" : `${diffExpense > 0 ? "+" : ""}${diffExpense.toFixed(1)}%`}</span></div>
        <div class="mini-card"><span class="mini-label">純資産(現在)</span><span class="mini-value">${yen(netWorth)}</span></div>
        <div class="mini-card"><span class="mini-label">サブスク月額</span><span class="mini-value">${yen(subsMonthlyTotal)}</span><span class="mini-note">支出の${subsShare.toFixed(0)}%</span></div>
      </div>
    </section>

    ${renderFundsPanel()}

    ${upcomingSubs.length > 0 ? `
    <section class="panel">
      <h2 class="panel-title">🔔 まもなく請求されるサブスク</h2>
      <ul class="simple-list">
        ${upcomingSubs.map((s) => `
          <li class="simple-list-row">
            ${stamp(s.name, catById(s.category_id) ? catById(s.category_id).color : "#B8935F", 26)}
            <div class="grow"><div class="row-title">${esc(s.name)}</div><div class="row-sub">${s.next}(${daysUntil(s.next) === 0 ? "今日" : `あと${daysUntil(s.next)}日`})</div></div>
            <span class="row-amount">${yen(s.amount)}</span>
          </li>`).join("")}
      </ul>
    </section>` : ""}

    <section class="panel">
      <h2 class="panel-title">カテゴリ別内訳(${monthLabel(state.month)})</h2>
      ${breakdown.length === 0 ? `<p class="empty-note">この月の支出記録はまだありません。</p>` : `
      <div class="pie-wrap">
        <div class="chart-box small"><canvas id="categoryPieCanvas"></canvas></div>
        <ul class="legend-list">
          ${breakdown.map((c) => `<li><span class="legend-dot" style="background:${c.color}"></span><span class="grow">${esc(c.name)}</span><span>${yen(c.amount)}</span></li>`).join("")}
        </ul>
      </div>`}
    </section>

    <section class="panel">
      <h2 class="panel-title">直近6ヶ月の推移</h2>
      <div class="chart-box"><canvas id="trendChartCanvas"></canvas></div>
    </section>
  </div>`;
}

function afterDashboardRender() {
  const monthTx = getMonthTx();
  const breakdown = getCategoryBreakdown(monthTx);
  if (breakdown.length > 0) {
    makeChart("categoryPie", "categoryPieCanvas", {
      type: "doughnut",
      data: { labels: breakdown.map((b) => b.name), datasets: [{ data: breakdown.map((b) => b.amount), backgroundColor: breakdown.map((b) => b.color), borderWidth: 0 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => yen(ctx.parsed) } } }, cutout: "60%" },
    });
  }
  const trend = getTrend(state.month);
  makeChart("trend", "trendChartCanvas", {
    type: "line",
    data: {
      labels: trend.map((t) => t.label),
      datasets: [
        { label: "収入", data: trend.map((t) => t.income), borderColor: "#29695A", backgroundColor: "#29695A", tension: 0.3 },
        { label: "支出", data: trend.map((t) => t.expense), borderColor: "#B5473F", backgroundColor: "#B5473F", tension: 0.3 },
      ],
    },
    options: { plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${yen(ctx.parsed.y)}` } } }, scales: { y: { ticks: { callback: (v) => Math.round(v / 1000) + "k" } } } },
  });
  renderFundsChart();
}

/* ---------------- 使える金額シミュレーション ---------------- */

function renderFundsPanel() {
  const netWorth = getNetWorth();
  const target = state.fundsTargetDate;
  const isValid = target > todayISO();
  let resultHtml = `<p class="empty-note">今日より後の日付を選んでください。</p>`;
  if (isValid) {
    const result = buildCashFlowProjection({ startBalance: netWorth, transactions: state.transactions, subscriptions: state.subscriptions, targetDate: target, includePending: state.fundsIncludePending });
    resultHtml = `
      <div class="funds-result">
        <span class="mini-label">${target} 時点で使える見込み</span>
        <span class="hero-value ${result.final < 0 ? "neg" : ""}" style="font-size:28px;">${yen(result.final)}</span>
        <div class="hero-sub-row">
          <span class="chip">現在 ${yen(netWorth)}</span>
          <span class="chip income">確定予定 ${result.confirmedDelta >= 0 ? "+" : ""}${yen(result.confirmedDelta)}</span>
          ${state.fundsIncludePending ? `<span class="chip pending">未確定予定 ${result.pendingDelta >= 0 ? "+" : ""}${yen(result.pendingDelta)}</span>` : ""}
        </div>
      </div>
      ${result.eventCount > 0 ? `<div class="chart-box small" style="margin-top:10px;"><canvas id="fundsChartCanvas"></canvas></div>` : ""}
    `;
  }
  const d = new Date(); const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  const in30 = new Date(); in30.setDate(in30.getDate() + 30); const in30days = in30.toISOString().slice(0, 10);

  return `
    <section class="panel">
      <h2 class="panel-title">いつ時点で使える金額?</h2>
      <div class="funds-controls">
        <input type="date" value="${target}" min="${todayISO()}" onchange="app.setFundsDate(this.value)" />
        <div class="tag-filter-row">
          <button class="tag-chip" onclick="app.setFundsDate('${endOfMonth}')">月末</button>
          <button class="tag-chip" onclick="app.setFundsDate('${in30days}')">30日後</button>
        </div>
      </div>
      <div class="setting-row" style="padding:4px 0 10px;">
        <span style="font-size:12.5px;">未確定の予定も含めて計算する</span>
        <button class="switch ${state.fundsIncludePending ? "on" : ""}" onclick="app.toggleFundsPending()"><span class="knob"></span></button>
      </div>
      ${resultHtml}
    </section>`;
}

function renderFundsChart() {
  const target = state.fundsTargetDate;
  if (target <= todayISO()) return;
  const netWorth = getNetWorth();
  const result = buildCashFlowProjection({ startBalance: netWorth, transactions: state.transactions, subscriptions: state.subscriptions, targetDate: target, includePending: state.fundsIncludePending });
  if (result.eventCount === 0) return;
  makeChart("funds", "fundsChartCanvas", {
    type: "line",
    data: { labels: result.points.map((p) => p.date.slice(5)), datasets: [{ label: "残高", data: result.points.map((p) => Math.round(p.balance)), borderColor: "#29695A", backgroundColor: "#29695A", stepped: "after" }] },
    options: { plugins: { tooltip: { callbacks: { label: (ctx) => yen(ctx.parsed.y) } } }, scales: { y: { ticks: { callback: (v) => Math.round(v / 1000) + "k" } } } },
  });
}

/* ---------------- 記録タブ ---------------- */

function renderTransactions() {
  const monthTx = [...getMonthTx()].sort((a, b) => b.date.localeCompare(a.date));
  const tags = getAllTags();
  return `
  <div class="stack">
    <div class="row-between">
      <h2 class="section-title">記録一覧</h2>
      <div class="btn-row">
        <button class="ghost-btn" onclick="document.getElementById('csvFileInput').click()">⬆ 読込</button>
        <button class="ghost-btn" onclick="app.exportCSV()">⬇ 書出</button>
      </div>
    </div>
    ${tags.length > 0 ? `
    <div class="tag-filter-row">
      <button class="tag-chip ${!state.filterTag ? "active" : ""}" onclick="app.setFilterTag('')">すべて</button>
      ${tags.map((t) => `<button class="tag-chip ${state.filterTag === t ? "active" : ""}" onclick="app.setFilterTag('${esc(t)}')">#${esc(t)}</button>`).join("")}
    </div>` : ""}
    ${monthTx.length === 0 ? `<p class="empty-note">記録がありません。右下の ＋ から追加できます。</p>` : `
    <ul class="tx-list">
      ${monthTx.map((t) => {
        const c = catById(t.category_id);
        return `<li class="tx-row" onclick="app.openTxModal('${t.id}')">
          ${stamp(c ? c.name : "?", c ? c.color : "#999")}
          <div class="grow">
            <div class="row-title">${esc(c ? c.name : "不明")}${t.memo ? " ・ " + esc(t.memo) : ""}${t.status === "pending" ? `<span class="badge-warn">予定</span>` : ""}</div>
            <div class="row-sub">${t.date}${t.method ? " ・ " + esc(t.method) : ""}${(t.tags || []).length ? " ・ " + t.tags.map((x) => "#" + esc(x)).join(" ") : ""}</div>
          </div>
          <span class="row-amount ${t.type === "income" ? "pos" : ""}">${t.type === "income" ? "+" : "−"}${yen(t.amount)}</span>
        </li>`;
      }).join("")}
    </ul>`}
  </div>`;
}

/* ---------------- サブスクタブ ---------------- */

function renderSubscriptions() {
  const subsMonthlyTotal = state.subscriptions.filter((s) => s.active !== false).reduce((s, sub) => s + monthlyCost(sub), 0);
  const monthTx = getMonthTx();
  const monthExpense = monthTx.filter((t) => t.type === "expense" && t.status !== "pending").reduce((s, t) => s + Number(t.amount), 0);
  const subsShare = monthExpense > 0 ? (subsMonthlyTotal / monthExpense) * 100 : 0;
  const withNext = state.subscriptions.map((s) => ({ ...s, next: nextBillingDate(s), unused: s.last_used ? daysUntil(s.last_used) < -60 : false })).sort((a, b) => a.next.localeCompare(b.next));

  return `
  <div class="stack">
    <section class="panel">
      <h2 class="panel-title">サブスク合計</h2>
      <div class="hero-sub-row" style="margin-top:4px;">
        <span class="chip expense">月額 ${yen(subsMonthlyTotal)}</span>
        <span class="chip">支出の${subsShare.toFixed(0)}%</span>
        <span class="chip">年間 ${yen(subsMonthlyTotal * 12)}</span>
      </div>
    </section>
    ${state.subscriptions.length === 0 ? `<p class="empty-note">登録されたサブスクはありません。右下の ＋ から追加できます。</p>` : `
    <ul class="tx-list">
      ${withNext.map((s) => {
        const c = catById(s.category_id); const d = daysUntil(s.next);
        return `<li class="tx-row" onclick="app.openSubModal('${s.id}')">
          ${stamp(s.name, c ? c.color : "#B8935F")}
          <div class="grow">
            <div class="row-title">${esc(s.name)}${s.active === false ? `<span class="badge-muted">停止中</span>` : ""}${s.unused ? `<span class="badge-warn">未使用?</span>` : ""}</div>
            <div class="row-sub">次回 ${s.next}(${d <= 0 ? "本日" : `あと${d}日`}) ・ ${s.cycle === "monthly" ? "毎月" : "毎年"}${s.method ? " ・ " + esc(s.method) : ""}</div>
          </div>
          <span class="row-amount">${yen(s.amount)}<span class="row-note">/${s.cycle === "monthly" ? "月" : "年"}</span></span>
        </li>`;
      }).join("")}
    </ul>`}
  </div>`;
}

/* ---------------- 予算タブ ---------------- */

function renderBudget() {
  const monthTx = getMonthTx();
  const breakdown = getCategoryBreakdown(monthTx);
  const spentByCat = Object.fromEntries(breakdown.map((c) => [c.catId, c.amount]));
  const expenseCats = state.categories.filter((c) => c.type === "expense");

  return `
  <div class="stack">
    <div class="row-between"><h2 class="section-title">カテゴリ別予算</h2><button class="ghost-btn" onclick="app.openCategoryModal()">✎ カテゴリ編集</button></div>
    <ul class="budget-list">
      ${expenseCats.map((c) => {
        const spent = spentByCat[c.id] || 0;
        const ratio = c.budget > 0 ? spent / c.budget : 0;
        const over = c.budget > 0 && spent > c.budget;
        const beads = Array.from({ length: 10 }).map((_, i) => `<span class="bead" style="background:${i < Math.round(Math.min(ratio, 1) * 10) ? (over ? "var(--danger)" : "var(--accent)") : "var(--bead-empty)"}"></span>`).join("");
        return `<li class="budget-row">
          <div class="budget-row-top">${stamp(c.name, c.color, 26)}<span class="grow row-title">${esc(c.name)}</span><span class="row-amount ${over ? "neg" : ""}">${yen(spent)} <span class="row-note">/ ${c.budget > 0 ? yen(c.budget) : "上限なし"}</span></span></div>
          ${c.budget > 0 ? `<div class="abacus-bar">${beads}</div>` : ""}
          ${over ? `<div class="budget-alert">⚠ 予算を${yen(spent - c.budget)}超過しています</div>` : ""}
        </li>`;
      }).join("")}
    </ul>
  </div>`;
}

/* ---------------- 資産タブ ---------------- */

function renderAccounts() {
  const typeLabel = { cash: "現金", bank: "銀行口座", card: "クレジットカード", asset: "資産・投資" };
  return `
  <div class="stack">
    <section class="panel"><h2 class="panel-title">純資産合計</h2><span class="hero-value" style="font-size:30px;">${yen(getNetWorth())}</span></section>
    <ul class="tx-list">
      ${state.accounts.map((a) => `
        <li class="tx-row" onclick="app.openAccModal('${a.id}')">
          ${stamp(a.name, "#4A6C8C")}
          <div class="grow"><div class="row-title">${esc(a.name)}</div><div class="row-sub">${typeLabel[a.type] || a.type}</div></div>
          <span class="row-amount ${a.balance < 0 ? "neg" : ""}">${yen(a.balance)}</span>
        </li>`).join("")}
    </ul>
  </div>`;
}

/* ---------------- レポートタブ ---------------- */

function renderReports() {
  const monthTx = getMonthTx();
  const breakdown = getCategoryBreakdown(monthTx);
  const monthIncome = monthTx.filter((t) => t.type === "income" && t.status !== "pending").reduce((s, t) => s + Number(t.amount), 0);
  const monthExpense = monthTx.filter((t) => t.type === "expense" && t.status !== "pending").reduce((s, t) => s + Number(t.amount), 0);
  const prevMonth = addMonths(state.month, -1);
  const prevTx = state.transactions.filter((t) => ymKey(t.date) === prevMonth && t.status !== "pending");
  const prevIncome = prevTx.filter((t) => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
  const prevExpense = prevTx.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const diffIncome = prevIncome > 0 ? ((monthIncome - prevIncome) / prevIncome) * 100 : null;
  const diffExpense = prevExpense > 0 ? ((monthExpense - prevExpense) / prevExpense) * 100 : null;

  return `
  <div class="stack">
    <section class="panel">
      <h2 class="panel-title">${monthLabel(prevMonth)} → ${monthLabel(state.month)} 比較</h2>
      <div class="compare-grid">
        <div><span class="mini-label">収入</span><span class="mini-value">${yen(monthIncome)}</span><span class="mini-note ${diffIncome > 0 ? "pos" : diffIncome < 0 ? "neg" : ""}">${diffIncome === null ? "—" : `${diffIncome > 0 ? "+" : ""}${diffIncome.toFixed(1)}%`}</span></div>
        <div><span class="mini-label">支出</span><span class="mini-value">${yen(monthExpense)}</span><span class="mini-note ${diffExpense > 0 ? "neg" : diffExpense < 0 ? "pos" : ""}">${diffExpense === null ? "—" : `${diffExpense > 0 ? "+" : ""}${diffExpense.toFixed(1)}%`}</span></div>
      </div>
    </section>
    <section class="panel">
      <h2 class="panel-title">支出ランキング(今月)</h2>
      ${breakdown.length === 0 ? `<p class="empty-note">データがありません。</p>` : `
      <ol class="ranking-list">
        ${breakdown.map((c, i) => `<li><span class="rank-num">${i + 1}</span><span class="legend-dot" style="background:${c.color}"></span><span class="grow">${esc(c.name)}</span><span>${yen(c.amount)}</span></li>`).join("")}
      </ol>`}
    </section>
    <section class="panel">
      <h2 class="panel-title">収支の推移(棒グラフ)</h2>
      <div class="chart-box"><canvas id="reportBarCanvas"></canvas></div>
    </section>
  </div>`;
}

function afterReportsRender() {
  const trend = getTrend(state.month);
  makeChart("reportBar", "reportBarCanvas", {
    type: "bar",
    data: { labels: trend.map((t) => t.label), datasets: [{ label: "収入", data: trend.map((t) => t.income), backgroundColor: "#29695A" }, { label: "支出", data: trend.map((t) => t.expense), backgroundColor: "#B5473F" }] },
    options: { plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${yen(ctx.parsed.y)}` } } }, scales: { y: { ticks: { callback: (v) => Math.round(v / 1000) + "k" } } } },
  });
}

/* ---------------- 設定タブ ---------------- */

function renderSettings() {
  const isOwn = state.settings.active_household_id === state.user.id;
  return `
  <div class="stack">
    <section class="panel">
      <h2 class="panel-title">表示</h2>
      <div class="setting-row"><span>ダークモード</span><button class="switch ${state.settings.dark_mode ? "on" : ""}" onclick="app.toggleDark()"><span class="knob"></span></button></div>
    </section>
    <section class="panel">
      <h2 class="panel-title">👪 家族と共有</h2>
      ${isOwn ? `
        <p class="empty-note" style="margin-top:0;">下の招待コードを家族に共有すると、あなたの家計簿を一緒に見たり編集したりできます。</p>
        <div class="invite-row"><code class="invite-code">${state.user.id}</code><button class="ghost-btn" onclick="app.copyInviteCode()">コピー</button></div>
        <p class="empty-note" style="margin-top:12px;margin-bottom:4px;">他の人の招待コードを持っている場合はここに入力:</p>
        <div class="invite-row"><input class="join-input" type="text" id="joinCodeInput" placeholder="招待コードを貼り付け" /><button class="ghost-btn" onclick="app.joinHousehold()">参加</button></div>
      ` : `
        <p class="empty-note" style="margin-top:0;">現在、共有家計簿を表示しています。</p>
        <button class="ghost-btn" onclick="app.leaveHousehold()">自分の家計簿に戻る</button>
      `}
    </section>
    <section class="panel">
      <h2 class="panel-title">データ管理</h2>
      <div class="btn-row" style="margin-top:8px;">
        <button class="ghost-btn" onclick="document.getElementById('csvFileInput').click()">⬆ CSV読込</button>
        <button class="ghost-btn" onclick="app.exportCSV()">⬇ CSV書出</button>
      </div>
    </section>
    <section class="panel">
      <h2 class="panel-title">アカウント</h2>
      <p class="empty-note" style="margin-top:0;">${esc(state.user.email)}</p>
      <button class="danger-btn" onclick="app.signOut()">🚪 ログアウト</button>
    </section>
    <p class="footnote">データはSupabaseに保存され、同じアカウントでログインしたスマホ・iPad・PCどれからでも同じ内容が見られます。</p>
  </div>`;
}

/* ==================================================================
   モーダル
   ================================================================== */

function renderModal() {
  const root = document.getElementById("modalRoot");
  if (!state.modal) { root.innerHTML = ""; return; }
  if (state.modal.type === "tx") root.innerHTML = renderTxModal();
  else if (state.modal.type === "sub") root.innerHTML = renderSubModal();
  else if (state.modal.type === "acc") root.innerHTML = renderAccModal();
  else if (state.modal.type === "categoryList") root.innerHTML = renderCategoryListModal();
  else if (state.modal.type === "categoryEdit") root.innerHTML = renderCategoryEditModal();
}

function modalShell(title, bodyHtml, wide) {
  return `
  <div class="modal-overlay" onclick="if(event.target===this) app.closeModal()">
    <div class="modal-panel ${wide ? "wide" : ""}">
      <div class="modal-header"><h3>${esc(title)}</h3><button class="icon-btn" onclick="app.closeModal()">✕</button></div>
      <div class="modal-body">${bodyHtml}</div>
    </div>
  </div>`;
}

/* --- 取引モーダル --- */

function renderTxModal() {
  const d = state.modal.draft;
  const cats = state.categories.filter((c) => c.type === d.type);
  return modalShell(state.modal.id ? "記録を編集" : "記録を追加", `
    <div class="segmented">
      <button class="${d.type === "expense" ? "active" : ""}" onclick="app.setTxType('expense')">支出</button>
      <button class="${d.type === "income" ? "active" : ""}" onclick="app.setTxType('income')">収入</button>
    </div>
    <label class="field"><span>金額</span><input type="number" inputmode="numeric" id="txAmount" value="${d.amount}" placeholder="0" /></label>
    <label class="field"><span>日付</span><input type="date" id="txDate" value="${d.date}" /></label>
    <label class="field"><span>状態</span>
      <div class="segmented">
        <button class="${d.status === "confirmed" ? "active" : ""}" onclick="app.setTxStatus('confirmed')">確定</button>
        <button class="${d.status === "pending" ? "active" : ""}" onclick="app.setTxStatus('pending')">未確定(予定)</button>
      </div>
    </label>
    <label class="field"><span>カテゴリ</span><select id="txCategory">${cats.map((c) => `<option value="${c.id}" ${c.id === d.category_id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
    <label class="field"><span>支払い方法</span><select id="txMethod">${PAYMENT_METHODS.map((m) => `<option ${m === d.method ? "selected" : ""}>${m}</option>`).join("")}</select></label>
    <label class="field"><span>メモ</span><input type="text" id="txMemo" value="${esc(d.memo)}" placeholder="任意" /></label>
    <label class="field"><span>タグ(スペース区切り)</span><input type="text" id="txTags" value="${esc(d.tagsStr)}" placeholder="旅行 飲み会" /></label>
    <div class="modal-actions">
      ${state.modal.id ? `<button class="danger-btn" onclick="app.deleteTx('${state.modal.id}')">🗑 削除</button>` : ""}
      <button class="primary-btn" onclick="app.saveTx()">✓ 保存</button>
    </div>
  `);
}

function captureTxDraft() {
  const d = state.modal.draft;
  const amountEl = document.getElementById("txAmount");
  if (amountEl) {
    d.amount = amountEl.value;
    d.date = document.getElementById("txDate").value;
    d.memo = document.getElementById("txMemo").value;
    d.tagsStr = document.getElementById("txTags").value;
    d.method = document.getElementById("txMethod").value;
  }
}

/* --- サブスクモーダル --- */

function renderSubModal() {
  const d = state.modal.draft;
  const cats = state.categories.filter((c) => c.type === "expense");
  return modalShell(state.modal.id ? "サブスクを編集" : "サブスクを追加", `
    <label class="field"><span>サービス名</span><input type="text" id="subName" value="${esc(d.name)}" placeholder="例:動画配信サービス" /></label>
    <label class="field"><span>金額</span><input type="number" inputmode="numeric" id="subAmount" value="${d.amount}" placeholder="0" /></label>
    <div class="segmented">
      <button class="${d.cycle === "monthly" ? "active" : ""}" onclick="app.setSubCycle('monthly')">毎月払い</button>
      <button class="${d.cycle === "yearly" ? "active" : ""}" onclick="app.setSubCycle('yearly')">毎年払い</button>
    </div>
    ${d.cycle === "monthly"
      ? `<label class="field"><span>請求日(毎月)</span><input type="number" min="1" max="28" id="subBillingDay" value="${d.billing_day}" /></label>`
      : `<label class="field"><span>請求日(月-日)</span><input type="text" id="subBillingMonthDay" value="${esc(d.billing_month_day)}" placeholder="MM-DD" /></label>`}
    <label class="field"><span>カテゴリ</span><select id="subCategory">${cats.map((c) => `<option value="${c.id}" ${c.id === d.category_id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
    <label class="field"><span>支払い方法</span><select id="subMethod">${PAYMENT_METHODS.map((m) => `<option ${m === d.method ? "selected" : ""}>${m}</option>`).join("")}</select></label>
    <label class="field"><span>最終利用日(見直しの目安)</span><input type="date" id="subLastUsed" value="${d.last_used || ""}" /></label>
    <div class="setting-row"><span>契約中</span><button class="switch ${d.active ? "on" : ""}" onclick="app.setSubActive(${!d.active})"><span class="knob"></span></button></div>
    <div class="modal-actions">
      ${state.modal.id ? `<button class="danger-btn" onclick="app.deleteSub('${state.modal.id}')">🗑 削除</button>` : ""}
      <button class="primary-btn" onclick="app.saveSub()">✓ 保存</button>
    </div>
  `);
}

function captureSubDraft() {
  const d = state.modal.draft;
  const nameEl = document.getElementById("subName");
  if (nameEl) {
    d.name = nameEl.value;
    d.amount = document.getElementById("subAmount").value;
    d.method = document.getElementById("subMethod").value;
    d.last_used = document.getElementById("subLastUsed").value;
    if (d.cycle === "monthly") d.billing_day = document.getElementById("subBillingDay").value;
    else d.billing_month_day = document.getElementById("subBillingMonthDay").value;
  }
}

/* --- 口座モーダル --- */

function renderAccModal() {
  const d = state.modal.draft;
  return modalShell(state.modal.id ? "口座を編集" : "口座を追加", `
    <label class="field"><span>名称</span><input type="text" id="accName" value="${esc(d.name)}" placeholder="例:普通預金" /></label>
    <label class="field"><span>種別</span>
      <select id="accType">
        <option value="cash" ${d.type === "cash" ? "selected" : ""}>現金</option>
        <option value="bank" ${d.type === "bank" ? "selected" : ""}>銀行口座</option>
        <option value="card" ${d.type === "card" ? "selected" : ""}>クレジットカード</option>
        <option value="asset" ${d.type === "asset" ? "selected" : ""}>資産・投資</option>
      </select>
    </label>
    <label class="field"><span>残高</span><input type="number" id="accBalance" value="${d.balance}" placeholder="0" /></label>
    <div class="modal-actions">
      ${state.modal.id ? `<button class="danger-btn" onclick="app.deleteAcc('${state.modal.id}')">🗑 削除</button>` : ""}
      <button class="primary-btn" onclick="app.saveAcc()">✓ 保存</button>
    </div>
  `);
}

/* --- カテゴリ管理モーダル --- */

function renderCategoryListModal() {
  return modalShell("カテゴリ管理", `
    <ul class="tx-list">
      ${state.categories.map((c) => `
        <li class="tx-row">
          ${stamp(c.name, c.color, 26)}
          <div class="grow"><div class="row-title">${esc(c.name)}</div><div class="row-sub">${c.type === "income" ? "収入" : "支出"}${c.type === "expense" ? " ・ 予算 " + (c.budget > 0 ? yen(c.budget) : "なし") : ""}</div></div>
          <button class="icon-btn" onclick="app.editCategory('${c.id}')">✎</button>
          <button class="icon-btn" onclick="app.deleteCategory('${c.id}')">🗑</button>
        </li>`).join("")}
    </ul>
    <button class="ghost-btn" style="margin-top:12px;" onclick="app.newCategory()">＋ カテゴリを追加</button>
  `, true);
}

function renderCategoryEditModal() {
  const d = state.modal.draft;
  return modalShell(state.modal.id ? "カテゴリを編集" : "カテゴリを追加", `
    <label class="field"><span>名前</span><input type="text" id="catName" value="${esc(d.name)}" /></label>
    <div class="segmented">
      <button class="${d.type === "expense" ? "active" : ""}" onclick="app.setCatType('expense')">支出</button>
      <button class="${d.type === "income" ? "active" : ""}" onclick="app.setCatType('income')">収入</button>
    </div>
    ${d.type === "expense" ? `<label class="field"><span>月間予算(0で上限なし)</span><input type="number" id="catBudget" value="${d.budget}" /></label>` : ""}
    <label class="field"><span>色</span><input type="color" id="catColor" value="${d.color}" /></label>
    <div class="modal-actions"><button class="primary-btn" onclick="app.saveCategoryEdit()">✓ 保存</button></div>
  `);
}

function captureCategoryDraft() {
  const d = state.modal.draft;
  const nameEl = document.getElementById("catName");
  if (nameEl) {
    d.name = nameEl.value;
    d.color = document.getElementById("catColor").value;
    if (d.type === "expense") { const b = document.getElementById("catBudget"); if (b) d.budget = b.value; }
  }
}

/* ==================================================================
   app オブジェクト(HTMLのonclickから呼ばれる公開API)
   ================================================================== */

const app = {
  switchTab(id) { state.tab = id; state.filterTag = ""; render(); },
  changeMonth(delta) { state.month = addMonths(state.month, delta); render(); },

  async toggleDark() {
    state.settings.dark_mode = !state.settings.dark_mode;
    render();
    await supabaseClient.from("user_settings").update({ dark_mode: state.settings.dark_mode }).eq("user_id", state.user.id);
  },

  setFilterTag(tag) { state.filterTag = tag; render(); },

  setFundsDate(v) { state.fundsTargetDate = v; render(); },
  toggleFundsPending() { state.fundsIncludePending = !state.fundsIncludePending; render(); },

  /* --- 取引 --- */
  openTxModal(id) {
    const tx = id ? state.transactions.find((t) => t.id === id) : null;
    const defaultType = tx ? tx.type : "expense";
    const defaultCat = tx ? tx.category_id : (state.categories.find((c) => c.type === defaultType) || {}).id;
    state.modal = {
      type: "tx", id: id || null,
      draft: {
        type: defaultType,
        date: tx ? tx.date : todayISO(),
        amount: tx ? tx.amount : "",
        category_id: defaultCat,
        memo: tx ? tx.memo || "" : "",
        method: tx ? tx.method || "現金" : "現金",
        tagsStr: tx ? (tx.tags || []).join(" ") : "",
        status: tx ? tx.status || "confirmed" : "confirmed",
      },
    };
    renderModal();
  },
  setTxType(type) { captureTxDraft(); state.modal.draft.type = type; const cats = state.categories.filter((c) => c.type === type); state.modal.draft.category_id = cats[0] ? cats[0].id : null; renderModal(); },
  setTxStatus(status) { captureTxDraft(); state.modal.draft.status = status; renderModal(); },
  async saveTx() {
    const d = state.modal.draft;
    const amount = Number(document.getElementById("txAmount").value);
    if (!amount || amount <= 0) { toast("金額を入力してください"); return; }
    const payload = {
      type: d.type,
      date: document.getElementById("txDate").value,
      amount,
      category_id: document.getElementById("txCategory").value,
      method: document.getElementById("txMethod").value,
      memo: document.getElementById("txMemo").value,
      tags: document.getElementById("txTags").value.split(/[\s,、]+/).map((s) => s.trim()).filter(Boolean),
      status: d.status,
    };
    try {
      if (state.modal.id) {
        const { data, error } = await supabaseClient.from("transactions").update(payload).eq("id", state.modal.id).select().single();
        if (error) throw error;
        state.transactions = state.transactions.map((t) => (t.id === state.modal.id ? data : t));
      } else {
        payload.household_id = state.settings.active_household_id;
        payload.owner_id = state.user.id;
        const { data, error } = await supabaseClient.from("transactions").insert(payload).select().single();
        if (error) throw error;
        state.transactions = [data, ...state.transactions];
      }
      state.modal = null; render(); toast("記録を保存しました");
    } catch (e) { console.error(e); toast("保存に失敗しました"); }
  },
  async deleteTx(id) {
    const { error } = await supabaseClient.from("transactions").delete().eq("id", id);
    if (!error) { state.transactions = state.transactions.filter((t) => t.id !== id); state.modal = null; render(); toast("削除しました"); }
  },

  /* --- サブスク --- */
  openSubModal(id) {
    const sub = id ? state.subscriptions.find((s) => s.id === id) : null;
    state.modal = {
      type: "sub", id: id || null,
      draft: {
        name: sub ? sub.name : "", amount: sub ? sub.amount : "",
        cycle: sub ? sub.cycle : "monthly",
        billing_day: sub ? sub.billing_day || 1 : 1,
        billing_month_day: sub ? sub.billing_month_day || "01-01" : "01-01",
        category_id: sub ? sub.category_id : (state.categories.find((c) => c.name === "サブスク") || state.categories.find((c) => c.type === "expense") || {}).id,
        method: sub ? sub.method || "クレジットカード" : "クレジットカード",
        last_used: sub ? sub.last_used : "",
        active: sub ? sub.active !== false : true,
      },
    };
    renderModal();
  },
  setSubCycle(cycle) { captureSubDraft(); state.modal.draft.cycle = cycle; renderModal(); },
  setSubActive(v) { captureSubDraft(); state.modal.draft.active = v; renderModal(); },
  async saveSub() {
    const d = state.modal.draft;
    const name = document.getElementById("subName").value.trim();
    const amount = Number(document.getElementById("subAmount").value);
    if (!name || !amount) { toast("サービス名と金額を入力してください"); return; }
    const payload = {
      name, amount, cycle: d.cycle,
      billing_day: d.cycle === "monthly" ? Number(document.getElementById("subBillingDay").value) : d.billing_day,
      billing_month_day: d.cycle === "yearly" ? document.getElementById("subBillingMonthDay").value : d.billing_month_day,
      category_id: document.getElementById("subCategory").value,
      method: document.getElementById("subMethod").value,
      last_used: document.getElementById("subLastUsed").value || null,
      active: d.active,
    };
    try {
      if (state.modal.id) {
        const { data, error } = await supabaseClient.from("subscriptions").update(payload).eq("id", state.modal.id).select().single();
        if (error) throw error;
        state.subscriptions = state.subscriptions.map((s) => (s.id === state.modal.id ? data : s));
      } else {
        payload.household_id = state.settings.active_household_id;
        payload.owner_id = state.user.id;
        const { data, error } = await supabaseClient.from("subscriptions").insert(payload).select().single();
        if (error) throw error;
        state.subscriptions = [...state.subscriptions, data];
      }
      state.modal = null; render(); toast("サブスクを保存しました");
    } catch (e) { console.error(e); toast("保存に失敗しました"); }
  },
  async deleteSub(id) {
    const { error } = await supabaseClient.from("subscriptions").delete().eq("id", id);
    if (!error) { state.subscriptions = state.subscriptions.filter((s) => s.id !== id); state.modal = null; render(); }
  },

  /* --- 口座 --- */
  openAccModal(id) {
    const acc = id ? state.accounts.find((a) => a.id === id) : null;
    state.modal = { type: "acc", id: id || null, draft: { name: acc ? acc.name : "", type: acc ? acc.type : "bank", balance: acc ? acc.balance : "" } };
    renderModal();
  },
  async saveAcc() {
    const name = document.getElementById("accName").value.trim();
    if (!name) { toast("名称を入力してください"); return; }
    const payload = { name, type: document.getElementById("accType").value, balance: Number(document.getElementById("accBalance").value) || 0 };
    try {
      if (state.modal.id) {
        const { data, error } = await supabaseClient.from("accounts").update(payload).eq("id", state.modal.id).select().single();
        if (error) throw error;
        state.accounts = state.accounts.map((a) => (a.id === state.modal.id ? data : a));
      } else {
        payload.household_id = state.settings.active_household_id;
        payload.owner_id = state.user.id;
        const { data, error } = await supabaseClient.from("accounts").insert(payload).select().single();
        if (error) throw error;
        state.accounts = [...state.accounts, data];
      }
      state.modal = null; render();
    } catch (e) { console.error(e); toast("保存に失敗しました"); }
  },
  async deleteAcc(id) {
    const { error } = await supabaseClient.from("accounts").delete().eq("id", id);
    if (!error) { state.accounts = state.accounts.filter((a) => a.id !== id); state.modal = null; render(); }
  },

  /* --- カテゴリ --- */
  openCategoryModal() { state.modal = { type: "categoryList" }; renderModal(); },
  editCategory(id) {
    const c = state.categories.find((x) => x.id === id);
    state.modal = { type: "categoryEdit", id, draft: { name: c.name, type: c.type, budget: c.budget, color: c.color } };
    renderModal();
  },
  newCategory() { state.modal = { type: "categoryEdit", id: null, draft: { name: "", type: "expense", budget: 0, color: "#7A6A55" } }; renderModal(); },
  setCatType(type) { captureCategoryDraft(); state.modal.draft.type = type; renderModal(); },
  async saveCategoryEdit() {
    const d = state.modal.draft;
    const name = document.getElementById("catName").value.trim();
    if (!name) { toast("名前を入力してください"); return; }
    const payload = { name, type: d.type, color: document.getElementById("catColor").value, budget: d.type === "expense" ? Number(document.getElementById("catBudget").value) || 0 : 0 };
    try {
      if (state.modal.id) {
        const { data, error } = await supabaseClient.from("categories").update(payload).eq("id", state.modal.id).select().single();
        if (error) throw error;
        state.categories = state.categories.map((c) => (c.id === state.modal.id ? data : c));
      } else {
        payload.household_id = state.settings.active_household_id;
        payload.owner_id = state.user.id;
        const { data, error } = await supabaseClient.from("categories").insert(payload).select().single();
        if (error) throw error;
        state.categories = [...state.categories, data];
      }
      state.modal = { type: "categoryList" }; render();
    } catch (e) { console.error(e); toast("保存に失敗しました"); }
  },
  async deleteCategory(id) {
    const { error } = await supabaseClient.from("categories").delete().eq("id", id);
    if (!error) { state.categories = state.categories.filter((c) => c.id !== id); renderModal(); }
  },

  closeModal() { state.modal = null; renderModal(); },

  /* --- 家族共有 --- */
  copyInviteCode() { navigator.clipboard.writeText(state.user.id); toast("招待コードをコピーしました"); },
  async joinHousehold() {
    const code = document.getElementById("joinCodeInput").value.trim();
    if (!code) return;
    try {
      const { error } = await supabaseClient.from("household_members").insert({ household_id: code, member_id: state.user.id });
      if (error && error.code !== "23505") throw error;
      state.settings.active_household_id = code;
      await supabaseClient.from("user_settings").update({ active_household_id: code }).eq("user_id", state.user.id);
      await loadAllData(code);
      render(); toast("共有家計簿に参加しました");
    } catch (e) { console.error(e); toast("参加できませんでした。コードを確認してください。"); }
  },
  async leaveHousehold() {
    state.settings.active_household_id = state.user.id;
    await supabaseClient.from("user_settings").update({ active_household_id: state.user.id }).eq("user_id", state.user.id);
    await loadAllData(state.user.id);
    render(); toast("自分の家計簿に戻りました");
  },

  async signOut() { await supabaseClient.auth.signOut(); },

  /* --- CSV --- */
  exportCSV() {
    const header = "日付,種別,金額,カテゴリ,メモ,支払い方法,タグ\n";
    const rows = state.transactions.map((t) => {
      const c = catById(t.category_id);
      return [t.date, t.type === "income" ? "収入" : "支出", t.amount, c ? c.name : "", (t.memo || "").replace(/,/g, "、"), t.method || "", (t.tags || []).join(";")].join(",");
    }).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `kakeibo_${state.month}.csv`; a.click();
    URL.revokeObjectURL(url);
  },
  importCSV(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        const lines = text.split("\n").filter((l) => l.trim());
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(",");
          if (cols.length < 4) continue;
          const [date, typeJa, amount, catName, memo, method, tagsStr] = cols;
          let cat = state.categories.find((c) => c.name === (catName || "").trim());
          if (!cat) cat = state.categories.find((c) => c.type === (typeJa === "収入" ? "income" : "expense"));
          rows.push({
            household_id: state.settings.active_household_id, owner_id: state.user.id,
            date: (date || "").trim() || todayISO(),
            type: (typeJa || "").trim() === "収入" ? "income" : "expense",
            amount: Number(amount) || 0,
            category_id: cat ? cat.id : (state.categories[0] || {}).id,
            memo: (memo || "").trim(), method: (method || "").trim() || "現金",
            tags: tagsStr ? tagsStr.split(";").filter(Boolean) : [],
          });
        }
        const { data, error } = await supabaseClient.from("transactions").insert(rows).select();
        if (error) throw error;
        state.transactions = [...data, ...state.transactions];
        render(); toast(`${data.length}件を読み込みました`);
      } catch (err) { console.error(err); toast("CSVの読み込みに失敗しました"); }
    };
    reader.readAsText(file);
  },
};

window.app = app;
document.addEventListener("DOMContentLoaded", init);
