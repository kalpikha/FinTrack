/* ============================================================
  FinTrack — Personal Finance Tracker
   ============================================================ */
import Chart from 'chart.js/auto';
import * as auth from './auth.js';
import * as storage from './storage.js';
import './styles.css';

const DEFAULT_CATEGORIES = {
  income:  ['Salary', 'Freelance', 'Investments', 'Refunds', 'Gift', 'Other'],
  expense: ['Groceries', 'Rent', 'Utilities', 'Internet', 'Transport', 'Fuel',
            'Dining', 'Entertainment', 'Shopping', 'Health', 'Subscriptions',
            'Insurance', 'Education', 'Travel', 'Gifts', 'Personal Care', 'Misc'],
  savings: ['Emergency Fund', 'Retirement', 'Stocks', 'Mutual Funds', 'Fixed Deposit', 'Crypto', 'Recurring Deposit', 'ESPP', 'NPS', 'EPF'],
};

const CATEGORY_ICONS = {};

const DEFAULT_ACCOUNTS = [
  { id: 'cash',    name: 'Cash',         type: 'cash',    opening: 0 },
  { id: 'bank',    name: 'Bank Account', type: 'bank',    opening: 0 },
  { id: 'card',    name: 'Credit Card',  type: 'credit',  opening: 0 },
];

const VALID_TX_TYPES = new Set(['income', 'expense', 'savings']);
const VALID_THEMES = new Set(['light', 'dark']);
const SAVE_DEBOUNCE_MS = 120;

let saveTimer = null;

const state = normalizeState(load());

function cloneDefaultAccounts() {
  return DEFAULT_ACCOUNTS.map(a => ({ ...a }));
}

function createDefaultState() {
  return {
    transactions: [],
    budgets: {},
    goals: [],
    accounts: cloneDefaultAccounts(),
    recurring: [],
    currency: 'INR',
    theme: 'light',
    period: ymKey(new Date()),
    view: 'dashboard',
  };
}

function finiteNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeState(raw) {
  const base = createDefaultState();
  if (!raw || typeof raw !== 'object') return base;

  return {
    transactions: Array.isArray(raw.transactions)
      ? raw.transactions.map(normalizeTransaction).filter(Boolean)
      : base.transactions,
    budgets: normalizeBudgets(raw.budgets),
    goals: Array.isArray(raw.goals)
      ? raw.goals.map(normalizeGoal).filter(Boolean)
      : base.goals,
    accounts: normalizeAccounts(raw.accounts),
    recurring: Array.isArray(raw.recurring)
      ? raw.recurring.map(normalizeRecurring).filter(Boolean)
      : base.recurring,
    currency: typeof raw.currency === 'string' && raw.currency.trim()
      ? raw.currency.trim().toUpperCase()
      : base.currency,
    theme: VALID_THEMES.has(raw.theme) ? raw.theme : base.theme,
    period: /^\d{4}-\d{2}$/.test(String(raw.period || '')) ? raw.period : base.period,
    view: typeof raw.view === 'string' && raw.view ? raw.view : base.view,
  };
}

function normalizeBudgets(budgets) {
  if (!budgets || typeof budgets !== 'object') return {};
  const out = {};
  Object.entries(budgets).forEach(([cat, amount]) => {
    const key = String(cat || '').trim();
    const value = Math.max(0, finiteNumber(amount));
    if (key && value > 0) out[key] = value;
  });
  return out;
}

function normalizeAccounts(accounts) {
  if (!Array.isArray(accounts) || !accounts.length) return cloneDefaultAccounts();
  const out = accounts.map(a => {
    if (!a || typeof a !== 'object') return null;
    const id = String(a.id || uid()).trim();
    const name = String(a.name || '').trim() || 'Account';
    const type = String(a.type || 'bank').trim() || 'bank';
    const opening = finiteNumber(a.opening);
    return { id, name, type, opening };
  }).filter(Boolean);
  return out.length ? out : cloneDefaultAccounts();
}

function normalizeTransaction(t) {
  if (!t || typeof t !== 'object') return null;
  const category = String(t.category || '').trim();
  const date = String(t.date || '').trim();
  const amount = Math.abs(finiteNumber(t.amount));
  if (!category || !date || amount <= 0) return null;
  return {
    id: String(t.id || uid()),
    type: VALID_TX_TYPES.has(t.type) ? t.type : 'expense',
    category,
    date,
    amount,
    account: t.account ? String(t.account) : '',
    note: String(t.note || '').trim(),
  };
}

function normalizeGoal(g) {
  if (!g || typeof g !== 'object') return null;
  const name = String(g.name || '').trim();
  if (!name) return null;
  return {
    id: String(g.id || uid()),
    emoji: String(g.emoji || '').trim(),
    name,
    target: Math.max(0, finiteNumber(g.target)),
    saved: Math.max(0, finiteNumber(g.saved)),
    deadline: String(g.deadline || '').trim(),
  };
}

function normalizeRecurring(r) {
  if (!r || typeof r !== 'object') return null;
  const category = String(r.category || '').trim();
  const name = String(r.name || '').trim();
  const amount = Math.abs(finiteNumber(r.amount));
  if (!category || amount <= 0) return null;
  return {
    id: String(r.id || uid()),
    name,
    type: VALID_TX_TYPES.has(r.type) ? r.type : 'expense',
    amount,
    frequency: String(r.frequency || 'monthly').trim() || 'monthly',
    category,
    account: String(r.account || ''),
    nextDate: String(r.nextDate || '').trim(),
  };
}

function load() {
  try {
    const activeUser = auth?.getCurrentUser?.();
    if (!activeUser?.id) return null;
    if (!storage) return null;

    const primary = storage.getUserState(activeUser.id);
    if (primary) return primary;

    const adminEmail = auth?.getAdminEmail?.();
    if (!adminEmail || activeUser.email !== adminEmail) return null;

    return storage.getLegacyState();
  } catch {
    return null;
  }
}

function persistNow() {
  try {
    const activeUser = auth?.getCurrentUser?.();
    if (!activeUser?.id) return;
    if (!storage) return;
    storage.setUserState(activeUser.id, state);
    storage.setCloudState?.(activeUser.id, state);
  } catch (err) {
    console.error('Failed to persist app state', err);
  }
}

function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  persistNow();
}

function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistNow();
  }, SAVE_DEBOUNCE_MS);
}

/* ---------- helpers ---------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const uid = () => Math.random().toString(36).slice(2, 10);

function ymKey(d) {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
function todayISO() { return new Date().toISOString().slice(0, 10); }

function advanceDate(iso, freq) {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  if (freq === 'weekly') d.setDate(d.getDate() + 7);
  else if (freq === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

// Posts a transaction for every due date <= today, advances nextDate.
function autoPostDueRecurring() {
  const today = todayISO();
  let posted = 0;
  state.recurring.forEach(r => {
    if (!r.nextDate) return;
    let safety = 0;
    while (r.nextDate <= today && safety < 200) {
      state.transactions.push({
        id: uid(),
        date: r.nextDate,
        type: r.type,
        category: r.category,
        amount: r.amount,
        note: r.name ? `${r.name} (auto)` : '(auto)',
        account: r.account || state.accounts[0]?.id,
      });
      r.nextDate = advanceDate(r.nextDate, r.frequency);
      posted++;
      safety++;
    }
  });
  return posted;
}

function fmt(n, opts = {}) {
  const cur = state.currency || 'USD';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: cur,
      maximumFractionDigits: opts.compact ? 0 : 2,
      ...(opts.compact ? { notation: 'compact' } : {}),
    }).format(n || 0);
  } catch { return `${cur} ${(+n || 0).toFixed(2)}`; }
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function iconFor(cat) { return CATEGORY_ICONS[cat] || cat?.[0]?.toUpperCase() || '•'; }

function txInPeriod(t, period = state.period) {
  return t.date && t.date.startsWith(period);
}
function sumBy(rows, type) {
  return rows.filter(r => r.type === type)
    .reduce((a, r) => a + (+r.amount || 0), 0);
}
function pct(part, whole) { return whole > 0 ? (part / whole) * 100 : 0; }

function toast(msg, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toast-wrap').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; }, 2400);
  setTimeout(() => el.remove(), 2700);
}

function prevPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return ymKey(d);
}

/* ---------- routing & main render ---------- */
const VIEWS = ['dashboard', 'transactions', 'budgets', 'goals', 'accounts', 'recurring', 'reports', 'settings'];
const VIEW_TITLES = {
  dashboard: ['Dashboard', 'Overview of your finances this period'],
  transactions: ['Transactions', 'All money in and out'],
  budgets: ['Budgets', 'Set spending limits per category'],
  goals: ['Goals', 'Track progress toward what matters'],
  accounts: ['Accounts', 'All your wallets and cards'],
  recurring: ['Recurring', 'Subscriptions and repeating bills'],
  reports: ['Reports', 'Trends, insights and breakdowns'],
  settings: ['Settings', 'Preferences and data management'],
};

function setView(v) {
  if (!VIEWS.includes(v)) v = 'dashboard';
  state.view = v; save();
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === v));
  const [t, s] = VIEW_TITLES[v];
  $('#view-title').textContent = t;
  $('#view-sub').textContent = s;
  render();
  $('#sidebar')?.classList.remove('open');
}

function render() {
  const root = $('#view-root');
  root.scrollTop = 0;
  if (state.view === 'dashboard')    root.innerHTML = renderDashboard();
  else if (state.view === 'transactions') root.innerHTML = renderTransactions();
  else if (state.view === 'budgets')      root.innerHTML = renderBudgets();
  else if (state.view === 'goals')        root.innerHTML = renderGoals();
  else if (state.view === 'accounts')     root.innerHTML = renderAccounts();
  else if (state.view === 'recurring')    root.innerHTML = renderRecurring();
  else if (state.view === 'reports')      root.innerHTML = renderReports();
  else if (state.view === 'settings')     root.innerHTML = renderSettings();
  bindViewActions();
  drawCharts();
}

window.__fintrack = { state, save, render, setView };
window.__lumen = window.__fintrack;

/* ============================================================
   View renderers
   ============================================================ */

function renderDashboard() {
  const monthly = state.transactions.filter(t => txInPeriod(t));
  const income = sumBy(monthly, 'income');
  const expense = sumBy(monthly, 'expense');
  const savings = sumBy(monthly, 'savings');
  const net = income - expense - savings;
  const rate = pct(savings, income);

  const prev = prevPeriod(state.period);
  const prevMonthly = state.transactions.filter(t => txInPeriod(t, prev));
  const prevExpense = sumBy(prevMonthly, 'expense');
  const expenseDelta = prevExpense > 0 ? ((expense - prevExpense) / prevExpense) * 100 : 0;

  const networth = computeNetWorth();
  const periodLabel = new Date(state.period + '-01')
    .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const recent = [...state.transactions]
    .filter(t => txInPeriod(t))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .slice(0, 6);

  const topBudgets = Object.entries(state.budgets).slice(0, 3);

  return `
    <div class="hero">
      <div class="hero-grid">
        <div>
          <div class="hero-eyebrow">Net Worth</div>
          <div class="hero-net">${fmt(networth)}</div>
          <div class="hero-meta">${periodLabel} • <strong>${fmt(net)}</strong> net this month</div>
        </div>
        <div class="hero-mini">
          <div><span>Income</span><strong>${fmt(income, { compact: true })}</strong></div>
          <div><span>Expenses</span><strong>${fmt(expense, { compact: true })}</strong></div>
          <div><span>Saved</span><strong>${fmt(savings, { compact: true })}</strong></div>
        </div>
      </div>
    </div>

    <div class="stats">
      <div class="stat income">
        <div class="stat-row">
          <span class="stat-label">Income</span>
          <div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg></div>
        </div>
        <div class="stat-value">${fmt(income)}</div>
        <div class="stat-delta muted">${monthly.filter(t => t.type === 'income').length} transactions</div>
      </div>
      <div class="stat expense">
        <div class="stat-row">
          <span class="stat-label">Expenses</span>
          <div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M5 12l7 7 7-7"/></svg></div>
        </div>
        <div class="stat-value">${fmt(expense)}</div>
        <div class="stat-delta ${expenseDelta > 0 ? 'down' : 'up'}">
          ${prevExpense ? `${expenseDelta > 0 ? '▲' : '▼'} ${Math.abs(expenseDelta).toFixed(1)}% vs last month` : 'No prior data'}
        </div>
      </div>
      <div class="stat savings">
        <div class="stat-row">
          <span class="stat-label">Saved</span>
          <div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20"/><circle cx="12" cy="12" r="9"/></svg></div>
        </div>
        <div class="stat-value">${fmt(savings)}</div>
        <div class="stat-delta muted">Across ${monthly.filter(t => t.type === 'savings').length} contributions</div>
      </div>
      <div class="stat rate">
        <div class="stat-row">
          <span class="stat-label">Savings Rate</span>
          <div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h4l3-9 4 18 3-9h0"/></svg></div>
        </div>
        <div class="stat-value">${rate.toFixed(1)}%</div>
        <div class="stat-delta ${rate >= 20 ? 'up' : 'down'}">
          ${rate >= 20 ? 'On track (≥20%)' : 'Below 20% target'}
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h2>Monthly trend</h2><span class="muted">${state.period.slice(0, 4)}</span></div>
        <div class="card-body"><canvas id="chart-trend" height="240"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Spending breakdown</h2><span class="muted">${periodLabel}</span></div>
        <div class="card-body"><canvas id="chart-cat" height="240"></canvas></div>
      </div>
    </div>

    <div class="grid-2" style="margin-top:20px;">
      <div class="card flush">
        <div class="card-head">
          <h2>Recent transactions</h2>
          <button class="btn ghost sm" data-go="transactions">View all →</button>
        </div>
        ${recent.length ? `<div class="tx-list">${recent.map(txRow).join('')}</div>`
                       : emptyState('No transactions yet', 'Tap “New” to add your first.')}
      </div>
      <div class="card">
        <div class="card-head">
          <h2>Top budgets</h2>
          <button class="btn ghost sm" data-go="budgets">Manage →</button>
        </div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:14px;">
          ${topBudgets.length ? topBudgets.map(([cat, lim]) => budgetRow(cat, lim, monthly)).join('')
                              : emptyState('No budgets yet', 'Set per-category limits to control spending.')}
        </div>
      </div>
    </div>
  `;
}

function emptyState(title, body) {
  return `
    <div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/></svg>
      <h3>${title}</h3>
      <p class="muted">${body}</p>
    </div>`;
}

function txRow(t) {
  const acc = state.accounts.find(a => a.id === t.account);
  return `
    <div class="tx-row ${t.type}" data-edit="${t.id}">
      <div class="tx-icon">${iconFor(t.category)}</div>
      <div class="tx-info">
        <div class="tx-cat">${escapeHtml(t.category)}</div>
        <div class="tx-meta">
          <span>${escapeHtml(t.date)}</span>
          ${acc ? `<span class="dot"></span><span>${escapeHtml(acc.name)}</span>` : ''}
          ${t.note ? `<span class="dot"></span><span>${escapeHtml(t.note)}</span>` : ''}
        </div>
      </div>
      <div class="tx-amount">${t.type === 'income' ? '+' : '−'}${fmt(t.amount)}</div>
      <div class="tx-actions" onclick="event.stopPropagation()">
        <button class="icon-btn" data-edit="${t.id}" aria-label="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/></svg></button>
        <button class="icon-btn" data-del="${t.id}" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
      </div>
    </div>`;
}

function budgetRow(cat, limit, monthly) {
  const spent = monthly.filter(t => t.category === cat && t.type !== 'income')
    .reduce((a, t) => a + (+t.amount || 0), 0);
  const ratio = limit > 0 ? spent / limit : 0;
  const cls = ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok';
  const remaining = limit - spent;
  return `
    <div class="budget-card" style="padding:14px;">
      <div class="budget-head">
        <div>
          <div class="budget-name">${iconFor(cat)} ${escapeHtml(cat)}</div>
          <div class="muted" style="font-size:12px;">${(ratio * 100).toFixed(0)}% used</div>
        </div>
        <div class="budget-spent">${fmt(spent)}<span class="budget-limit"> / ${fmt(limit)}</span></div>
      </div>
      <div class="bar ${cls}"><span style="width:${Math.min(100, ratio * 100)}%"></span></div>
      <div class="budget-foot">
        <span>${cls === 'over' ? `Over by ${fmt(spent - limit)}` : `${fmt(Math.max(0, remaining))} left`}</span>
      </div>
    </div>`;
}

/* ---------- Transactions view ---------- */
let txFilters = { type: 'all', q: '', account: 'all' };

function renderTransactions() {
  const monthly = state.transactions
    .filter(t => txInPeriod(t))
    .filter(t => txFilters.type === 'all' || t.type === txFilters.type)
    .filter(t => txFilters.account === 'all' || t.account === txFilters.account)
    .filter(t => !txFilters.q || (t.category + ' ' + (t.note || ''))
      .toLowerCase().includes(txFilters.q.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  const groups = {};
  monthly.forEach(t => { (groups[t.date] = groups[t.date] || []).push(t); });

  const accountOpts = ['<option value="all">All accounts</option>',
    ...state.accounts.map(a => `<option value="${a.id}" ${txFilters.account === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`)].join('');

  const body = Object.keys(groups).length
    ? Object.entries(groups).map(([d, rows]) => {
        const dayTotal = rows.reduce((acc, t) => acc + (t.type === 'income' ? +t.amount : -t.amount), 0);
        const date = new Date(d);
        const label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        return `<div class="tx-day-head"><span>${label}</span><span class="amt ${dayTotal >= 0 ? 'income' : 'expense'}">${dayTotal >= 0 ? '+' : '−'}${fmt(Math.abs(dayTotal))}</span></div>
                ${rows.map(txRow).join('')}`;
      }).join('')
    : emptyState('No transactions match', 'Try changing filters or adding a new entry.');

  return `
    <div class="card flush">
      <div class="toolbar">
        <input type="search" id="tx-search" class="input grow" placeholder="Search by category or note…" value="${escapeHtml(txFilters.q)}" />
        <div class="seg" id="tx-type-seg">
          <button class="${txFilters.type === 'all' ? 'active' : ''}" data-type="all">All</button>
          <button class="${txFilters.type === 'income' ? 'active' : ''}" data-type="income">Income</button>
          <button class="${txFilters.type === 'expense' ? 'active' : ''}" data-type="expense">Expenses</button>
          <button class="${txFilters.type === 'savings' ? 'active' : ''}" data-type="savings">Savings</button>
        </div>
        <select class="select compact" id="tx-account-filter">${accountOpts}</select>
      </div>
      <div class="tx-list">${body}</div>
    </div>
  `;
}

/* ---------- Budgets view ---------- */
function renderBudgets() {
  const monthly = state.transactions.filter(t => txInPeriod(t));
  const entries = Object.entries(state.budgets);
  const totalLimit = entries.reduce((a, [, l]) => a + l, 0);
  const totalSpent = entries.reduce((a, [c]) => a + monthly.filter(t => t.category === c && t.type !== 'income').reduce((s, t) => s + +t.amount, 0), 0);

  return `
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h2>Overall budget</h2></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:12px;">
          <div style="display:flex;justify-content:space-between;align-items:end;">
            <div>
              <div class="muted" style="font-size:12px;">Spent</div>
              <div class="mono" style="font-size:28px;font-weight:700;">${fmt(totalSpent)}</div>
            </div>
            <div style="text-align:right;">
              <div class="muted" style="font-size:12px;">of ${fmt(totalLimit)}</div>
              <div class="muted">${totalLimit ? ((totalSpent / totalLimit) * 100).toFixed(0) : 0}% used</div>
            </div>
          </div>
          <div class="bar ${totalSpent > totalLimit ? 'over' : totalSpent / (totalLimit || 1) >= 0.8 ? 'warn' : 'ok'}">
            <span style="width:${Math.min(100, totalLimit ? (totalSpent / totalLimit) * 100 : 0)}%"></span>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Add budget</h2></div>
        <div class="card-body">
          <form id="budget-form" class="form-grid cols-2">
            <label class="field" style="grid-column:span 2;"><span>Category</span>
              <input class="input" id="bg-cat" list="bg-cats" placeholder="e.g. Groceries" required />
              <datalist id="bg-cats">${[...new Set([...DEFAULT_CATEGORIES.expense, ...DEFAULT_CATEGORIES.savings])].map(c => `<option value="${escapeHtml(c)}">`).join('')}</datalist>
            </label>
            <label class="field"><span>Monthly limit</span>
              <input class="input" id="bg-amt" type="number" min="0" step="0.01" required />
            </label>
            <div style="display:flex;align-items:end;">
              <button class="btn primary" type="submit" style="width:100%;">Save budget</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <div class="section" style="margin-top:20px;">
      <h2 style="margin:0 4px 4px;">Active budgets</h2>
      <div class="cards-grid">
        ${entries.length
          ? entries.map(([cat, lim]) => `
              ${budgetRow(cat, lim, monthly)}
              <div style="margin-top:-6px;text-align:right;">
                <button class="btn sm danger" data-del-budget="${escapeHtml(cat)}">Remove</button>
              </div>`).join('')
          : `<div class="card">${emptyState('No budgets yet', 'Add a category limit to track spending against it.')}</div>`}
      </div>
    </div>
  `;
}

/* ---------- Goals view ---------- */
function renderGoals() {
  return `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px;">
      <button class="btn primary" data-new-goal>+ New goal</button>
    </div>
    <div class="cards-grid">
      ${state.goals.length ? state.goals.map(goalCard).join('')
        : `<div class="card">${emptyState('No goals yet', 'Create a target — emergency fund, vacation, debt-free.')}</div>`}
    </div>
  `;
}

function goalCard(g) {
  const ratio = g.target > 0 ? Math.min(1, g.saved / g.target) : 0;
  const remaining = Math.max(0, g.target - g.saved);
  const eta = g.deadline ? new Date(g.deadline).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : '—';
  return `
    <div class="goal-card">
      <div style="display:flex;gap:14px;align-items:center;">
        <div class="goal-icon">${g.emoji || 'G'}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:16px;">${escapeHtml(g.name)}</div>
          <div class="muted" style="font-size:12px;">Target ${eta}</div>
        </div>
        <button class="icon-btn" data-edit-goal="${g.id}" aria-label="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/></svg></button>
      </div>
      <div class="goal-progress">${fmt(g.saved)} <span class="muted" style="font-weight:400;font-size:13px;">/ ${fmt(g.target)}</span></div>
      <div class="bar"><span style="width:${ratio * 100}%"></span></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;">
        <span class="muted">${(ratio * 100).toFixed(0)}% complete</span>
        <span class="muted">${fmt(remaining)} to go</span>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn sm" data-contribute="${g.id}" style="flex:1;">+ Contribute</button>
        <button class="btn sm danger" data-del-goal="${g.id}">Delete</button>
      </div>
    </div>`;
}

/* ---------- Accounts view ---------- */
function renderAccounts() {
  const balances = computeAccountBalances();
  return `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px;">
      <button class="btn primary" data-new-account>+ New account</button>
    </div>
    <div class="cards-grid">
      ${state.accounts.map(a => {
        const bal = balances[a.id] || 0;
        const isCredit = a.type === 'credit';
        return `
          <div class="account-card ${isCredit ? 'is-credit' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:start;">
              <div>
                <div class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(a.type)}</div>
                <div style="font-weight:700;font-size:17px;margin-top:2px;">${escapeHtml(a.name)}</div>
              </div>
              <button class="icon-btn" data-del-account="${a.id}" aria-label="Delete" style="${isCredit ? 'background:rgba(255,255,255,0.1);border-color:rgba(255,255,255,0.2);color:#fff;' : ''}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              </button>
            </div>
            <div class="account-balance">${fmt(bal)}</div>
            <div class="muted" style="font-size:12px;">${state.transactions.filter(t => t.account === a.id).length} transactions</div>
          </div>`;
      }).join('')}
    </div>`;
}

/* ---------- Recurring view ---------- */
function renderRecurring() {
  return `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px;">
      <button class="btn primary" data-new-recurring>+ New recurring</button>
    </div>
    <div class="card flush">
      ${state.recurring.length ? `
        <div class="tx-list">
          ${state.recurring.map(r => `
            <div class="tx-row ${r.type}">
              <div class="tx-icon">${iconFor(r.category)}</div>
              <div class="tx-info">
                <div class="tx-cat">${escapeHtml(r.name || r.category)}</div>
                <div class="tx-meta">
                  <span>${escapeHtml(r.frequency)} · ${escapeHtml(r.category)}</span>
                  ${r.nextDate ? `<span class="dot"></span><span>Next: ${escapeHtml(r.nextDate)}</span>` : ''}
                </div>
              </div>
              <div class="tx-amount">${r.type === 'income' ? '+' : '−'}${fmt(r.amount)}</div>
              <div class="tx-actions" style="opacity:1;">
                <button class="btn sm" data-recur-now="${r.id}">Add now</button>
                <button class="icon-btn" data-del-recurring="${r.id}" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
              </div>
            </div>`).join('')}
        </div>` : emptyState('No recurring entries', 'Add subscriptions, salary, rent — anything that repeats.')}
    </div>`;
}

/* ---------- Reports ---------- */
function renderReports() {
  const year = state.period.slice(0, 4);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const yearTx = state.transactions.filter(t => t.date?.startsWith(year));
  const yearIncome = sumBy(yearTx, 'income');
  const yearExpense = sumBy(yearTx, 'expense');
  const yearSavings = sumBy(yearTx, 'savings');

  // category breakdown
  const byCat = {};
  yearTx.filter(t => t.type === 'expense').forEach(t => {
    byCat[t.category] = (byCat[t.category] || 0) + +t.amount;
  });
  const sortedCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const totalExp = sortedCats.reduce((a, [, v]) => a + v, 0);

  void months;
  return `
    <div class="stats">
      <div class="stat income">
        <div class="stat-row"><span class="stat-label">Year income</span></div>
        <div class="stat-value">${fmt(yearIncome)}</div>
      </div>
      <div class="stat expense">
        <div class="stat-row"><span class="stat-label">Year expenses</span></div>
        <div class="stat-value">${fmt(yearExpense)}</div>
      </div>
      <div class="stat savings">
        <div class="stat-row"><span class="stat-label">Year saved</span></div>
        <div class="stat-value">${fmt(yearSavings)}</div>
      </div>
      <div class="stat rate">
        <div class="stat-row"><span class="stat-label">Avg savings rate</span></div>
        <div class="stat-value">${yearIncome > 0 ? ((yearSavings / yearIncome) * 100).toFixed(1) : '0.0'}%</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h2>Cash flow ${year}</h2></div>
        <div class="card-body"><canvas id="chart-flow" height="240"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Net cumulative</h2></div>
        <div class="card-body"><canvas id="chart-net" height="240"></canvas></div>
      </div>
    </div>

    <div class="card" style="margin-top:20px;">
      <div class="card-head"><h2>Top categories</h2><span class="muted">Year ${year}</span></div>
      <div class="card-body">
        ${sortedCats.length ? sortedCats.slice(0, 12).map(([c, v]) => `
          <div class="report-row">
            <div>
              <div style="font-weight:600;">${iconFor(c)} ${escapeHtml(c)}</div>
              <div class="bar" style="margin-top:6px;"><span style="width:${(v / sortedCats[0][1]) * 100}%"></span></div>
            </div>
            <div class="pct">${((v / totalExp) * 100).toFixed(1)}%</div>
            <div class="amt expense">${fmt(v)}</div>
          </div>`).join('')
          : emptyState('No data for this year', 'Add some transactions to see breakdowns.')}
      </div>
    </div>
  `;
}

/* ---------- Settings ---------- */
function renderSettings() {
  const currentUser = auth?.getCurrentUser?.();
  return `
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h2>Preferences</h2></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:14px;">
          <label class="field"><span>Currency</span>
            <select id="set-currency" class="select">
              ${['USD','EUR','GBP','INR','JPY','AUD','CAD','SGD','AED','CHF','CNY']
                .map(c => `<option ${c === state.currency ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </label>
          <label class="field"><span>Theme</span>
            <select id="set-theme" class="select">
              <option value="light" ${state.theme === 'light' ? 'selected' : ''}>Light</option>
              <option value="dark"  ${state.theme === 'dark'  ? 'selected' : ''}>Dark</option>
            </select>
          </label>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Data</h2></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:10px;">
          <button class="btn" id="export-json">Export all data (JSON)</button>
          <button class="btn" id="export-csv">Export transactions (CSV)</button>
          <button class="btn" id="import-btn">Import from file (JSON / CSV)</button>
          <button class="btn danger" id="reset-data">Reset all data</button>
          <p class="muted" style="font-size:12px;">All data is stored locally in your browser. Export regularly to back up.</p>
        </div>
      </div>
    </div>

    <div class="grid-2" style="margin-top:20px;">
      <div class="card">
        <div class="card-head"><h2>Account</h2></div>
        <div class="card-body">
          <form id="profile-form" class="form-grid">
            <label class="field"><span>Name</span>
              <input class="input" id="profile-name" value="${escapeHtml(currentUser?.name || '')}" required />
            </label>
            <label class="field"><span>Email</span>
              <input class="input" value="${escapeHtml(currentUser?.email || '')}" disabled />
            </label>
            <div class="form-actions">
              <button class="btn primary" type="submit">Update profile</button>
            </div>
          </form>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Security</h2></div>
        <div class="card-body">
          <form id="password-form" class="form-grid">
            <label class="field"><span>Current password</span>
              <input class="input" id="pw-current" type="password" required minlength="6" />
            </label>
            <label class="field"><span>New password</span>
              <input class="input" id="pw-new" type="password" required minlength="6" />
            </label>
            <div class="form-actions">
              <button class="btn primary" type="submit">Change password</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:20px;">
      <div class="card-head"><h2>About</h2></div>
      <div class="card-body">
        <p class="muted">FinTrack — a local-first personal finance tracker. Your data never leaves your device.</p>
      </div>
    </div>
  `;
}

/* ---------- helpers used across views ---------- */
function computeNetWorth() {
  const balances = computeAccountBalances();
  return Object.entries(balances).reduce((sum, [id, b]) => {
    const acc = state.accounts.find(a => a.id === id);
    return sum + (acc?.type === 'credit' ? -b : b);
  }, 0);
}

function computeAccountBalances() {
  const out = {};
  state.accounts.forEach(a => { out[a.id] = +a.opening || 0; });
  state.transactions.forEach(t => {
    if (!t.account || out[t.account] == null) return;
    if (t.type === 'income') out[t.account] += +t.amount;
    else out[t.account] -= +t.amount;
  });
  return out;
}

/* ============================================================
   Event delegation per view
   ============================================================ */
function bindViewActions() {
  const root = $('#view-root');

  root.querySelectorAll('[data-go]').forEach(el =>
    el.addEventListener('click', () => setView(el.dataset.go)));

  // Transaction edit/delete
  root.querySelectorAll('[data-edit]').forEach(el =>
    el.addEventListener('click', e => { e.stopPropagation(); openTxModal(el.dataset.edit); }));
  root.querySelectorAll('[data-del]').forEach(el =>
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm('Delete this transaction?')) return;
      state.transactions = state.transactions.filter(t => t.id !== el.dataset.del);
      save(); render(); toast('Transaction deleted', 'success');
    }));

  // Transactions view filters
  const seg = root.querySelector('#tx-type-seg');
  seg?.querySelectorAll('button').forEach(b =>
    b.addEventListener('click', () => { txFilters.type = b.dataset.type; render(); }));
  root.querySelector('#tx-search')?.addEventListener('input', e => {
    txFilters.q = e.target.value; render();
    setTimeout(() => $('#tx-search')?.focus(), 0);
  });
  root.querySelector('#tx-account-filter')?.addEventListener('change', e => {
    txFilters.account = e.target.value; render();
  });

  // Budgets
  root.querySelector('#budget-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const cat = $('#bg-cat').value.trim();
    const amt = parseFloat($('#bg-amt').value);
    if (!cat || !(amt > 0)) return;
    state.budgets[cat] = amt;
    save(); render(); toast(`Budget for ${cat} saved`, 'success');
  });
  root.querySelectorAll('[data-del-budget]').forEach(el =>
    el.addEventListener('click', () => {
      delete state.budgets[el.dataset.delBudget];
      save(); render(); toast('Budget removed');
    }));

  // Goals
  root.querySelector('[data-new-goal]')?.addEventListener('click', () => openGoalModal());
  root.querySelectorAll('[data-edit-goal]').forEach(el =>
    el.addEventListener('click', () => openGoalModal(el.dataset.editGoal)));
  root.querySelectorAll('[data-del-goal]').forEach(el =>
    el.addEventListener('click', () => {
      if (!confirm('Delete this goal?')) return;
      state.goals = state.goals.filter(g => g.id !== el.dataset.delGoal);
      save(); render(); toast('Goal deleted');
    }));
  root.querySelectorAll('[data-contribute]').forEach(el =>
    el.addEventListener('click', () => openContributeModal(el.dataset.contribute)));

  // Accounts
  root.querySelector('[data-new-account]')?.addEventListener('click', () => openAccountModal());
  root.querySelectorAll('[data-del-account]').forEach(el =>
    el.addEventListener('click', () => {
      if (!confirm('Delete this account? Transactions linked to it will keep the reference.')) return;
      state.accounts = state.accounts.filter(a => a.id !== el.dataset.delAccount);
      save(); render(); toast('Account removed');
    }));

  // Recurring
  root.querySelector('[data-new-recurring]')?.addEventListener('click', () => openRecurringModal());
  root.querySelectorAll('[data-recur-now]').forEach(el =>
    el.addEventListener('click', () => {
      const r = state.recurring.find(x => x.id === el.dataset.recurNow);
      if (!r) return;
      state.transactions.push({
        id: uid(), date: todayISO(),
        type: r.type, category: r.category, amount: r.amount,
        note: r.name || '', account: r.account || state.accounts[0]?.id,
      });
      if (r.nextDate && r.nextDate <= todayISO()) {
        r.nextDate = advanceDate(r.nextDate, r.frequency);
      }
      save(); toast('Logged from recurring', 'success'); render();
    }));
  root.querySelectorAll('[data-del-recurring]').forEach(el =>
    el.addEventListener('click', () => {
      state.recurring = state.recurring.filter(r => r.id !== el.dataset.delRecurring);
      save(); render();
    }));

  // Settings
  root.querySelector('#set-currency')?.addEventListener('change', e => {
    state.currency = e.target.value; save(); render(); toast('Currency updated');
  });
  root.querySelector('#set-theme')?.addEventListener('change', e => {
    state.theme = e.target.value;
    document.documentElement.dataset.theme = state.theme;
    save(); render();
  });
  root.querySelector('#export-json')?.addEventListener('click', exportJson);
  root.querySelector('#export-csv')?.addEventListener('click', exportCsv);
  root.querySelector('#import-btn')?.addEventListener('click', () => $('#import-file').click());

  root.querySelector('#profile-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#profile-name')?.value?.trim() || '';
    try {
      const user = auth?.updateProfile?.({ name });
      if (!user) throw new Error('Unable to update profile');
      $('#active-user').textContent = user.name || user.email;
      toast('Profile updated', 'success');
    } catch (err) {
      toast(err?.message || 'Profile update failed', 'error');
    }
  });

  root.querySelector('#password-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const currentPassword = $('#pw-current')?.value || '';
    const newPassword = $('#pw-new')?.value || '';
    try {
      await auth?.changePassword?.({ currentPassword, newPassword });
      $('#pw-current').value = '';
      $('#pw-new').value = '';
      toast('Password updated', 'success');
    } catch (err) {
      toast(err?.message || 'Password update failed', 'error');
    }
  });

  root.querySelector('#reset-data')?.addEventListener('click', () => {
    if (!confirm('This will erase all your local data. Are you sure?')) return;
    if (!confirm('Really erase everything?')) return;
    const activeUser = auth?.getCurrentUser?.();
    storage?.clearUserState(activeUser?.id);
    location.reload();
  });
}

/* ============================================================
   Modals
   ============================================================ */
function openModal(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal').hidden = false;
  setTimeout(() => $('#modal-body input, #modal-body select')?.focus(), 30);
}
function closeModal() { $('#modal').hidden = true; $('#modal-body').innerHTML = ''; }

function openTxModal(id) {
  const t = id ? state.transactions.find(x => x.id === id) : null;
  const isEdit = !!t;
  const type = t?.type || 'expense';
  const accountOpts = state.accounts.map(a =>
    `<option value="${a.id}" ${t?.account === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('');
  const cats = DEFAULT_CATEGORIES[type];

  openModal(isEdit ? 'Edit transaction' : 'Add transaction', `
    <form id="tx-modal-form" class="form-grid">
      <div class="seg ${type}" id="modal-type-seg">
        <button type="button" data-t="income"  class="${type === 'income'  ? 'active' : ''}">Income</button>
        <button type="button" data-t="expense" class="${type === 'expense' ? 'active' : ''}">Expense</button>
        <button type="button" data-t="savings" class="${type === 'savings' ? 'active' : ''}">Savings</button>
      </div>
      <input type="hidden" id="m-type" value="${type}" />
      <div class="form-grid cols-2">
        <label class="field"><span>Amount</span>
          <input class="input" type="number" id="m-amt" step="0.01" min="0" value="${t?.amount || ''}" required />
        </label>
        <label class="field"><span>Date</span>
          <input class="input" type="date" id="m-date" value="${t?.date || todayISO()}" required />
        </label>
      </div>
      <label class="field"><span>Category</span>
        <input class="input" id="m-cat" list="m-cats" value="${escapeHtml(t?.category || '')}" required placeholder="Pick or type a category"/>
        <datalist id="m-cats">${cats.map(c => `<option value="${escapeHtml(c)}">`).join('')}</datalist>
      </label>
      <label class="field"><span>Account</span>
        <select class="select" id="m-account">${accountOpts}</select>
      </label>
      <label class="field"><span>Note (optional)</span>
        <input class="input" id="m-note" value="${escapeHtml(t?.note || '')}" placeholder="A short description"/>
      </label>
      <div class="form-actions">
        ${isEdit ? '<button type="button" class="btn danger" id="m-delete">Delete</button>' : ''}
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button type="submit" class="btn primary">${isEdit ? 'Save changes' : 'Add transaction'}</button>
      </div>
    </form>
  `);

  // Type segment
  $('#modal-type-seg').querySelectorAll('button').forEach(b =>
    b.addEventListener('click', () => {
      const newType = b.dataset.t;
      $('#m-type').value = newType;
      $('#modal-type-seg').className = `seg ${newType}`;
      $('#modal-type-seg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      $('#m-cats').innerHTML = DEFAULT_CATEGORIES[newType].map(c => `<option value="${escapeHtml(c)}">`).join('');
    }));

  $('#tx-modal-form').addEventListener('submit', e => {
    e.preventDefault();
    const tx = {
      id: t?.id || uid(),
      type: $('#m-type').value,
      amount: Math.abs(parseFloat($('#m-amt').value)) || 0,
      date: $('#m-date').value,
      category: $('#m-cat').value.trim(),
      account: $('#m-account').value,
      note: $('#m-note').value.trim(),
    };
    if (!tx.amount || !tx.date || !tx.category) return;
    if (isEdit) {
      const i = state.transactions.findIndex(x => x.id === tx.id);
      state.transactions[i] = tx;
    } else {
      state.transactions.push(tx);
    }
    save(); closeModal(); render();
    toast(isEdit ? 'Transaction updated' : 'Transaction added', 'success');
  });

  $('#m-delete')?.addEventListener('click', () => {
    if (!confirm('Delete this transaction?')) return;
    state.transactions = state.transactions.filter(x => x.id !== t.id);
    save(); closeModal(); render(); toast('Transaction deleted');
  });
}

function openGoalModal(id) {
  const g = id ? state.goals.find(x => x.id === id) : null;
  openModal(g ? 'Edit goal' : 'New goal', `
    <form id="goal-form" class="form-grid">
      <div class="form-grid cols-2">
        <label class="field"><span>Emoji</span>
          <input class="input" id="g-emoji" value="${escapeHtml(g?.emoji || '')}" maxlength="4" />
        </label>
        <label class="field"><span>Name</span>
          <input class="input" id="g-name" value="${escapeHtml(g?.name || '')}" required placeholder="e.g. Emergency fund"/>
        </label>
      </div>
      <div class="form-grid cols-2">
        <label class="field"><span>Target amount</span>
          <input class="input" type="number" id="g-target" min="0" step="0.01" value="${g?.target || ''}" required />
        </label>
        <label class="field"><span>Already saved</span>
          <input class="input" type="number" id="g-saved" min="0" step="0.01" value="${g?.saved || 0}" />
        </label>
      </div>
      <label class="field"><span>Deadline (optional)</span>
        <input class="input" type="date" id="g-deadline" value="${g?.deadline || ''}" />
      </label>
      <div class="form-actions">
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button type="submit" class="btn primary">${g ? 'Save' : 'Create goal'}</button>
      </div>
    </form>
  `);
  $('#goal-form').addEventListener('submit', e => {
    e.preventDefault();
    const data = {
      id: g?.id || uid(),
      emoji: $('#g-emoji').value.trim(),
      name: $('#g-name').value.trim(),
      target: parseFloat($('#g-target').value) || 0,
      saved: parseFloat($('#g-saved').value) || 0,
      deadline: $('#g-deadline').value || '',
    };
    if (!data.name || data.target <= 0) return;
    if (g) {
      const i = state.goals.findIndex(x => x.id === g.id);
      state.goals[i] = data;
    } else state.goals.push(data);
    save(); closeModal(); render();
    toast(g ? 'Goal updated' : 'Goal created', 'success');
  });
}

function openContributeModal(id) {
  const g = state.goals.find(x => x.id === id);
  if (!g) return;
  openModal(`Contribute to ${g.name}`, `
    <form id="contrib-form" class="form-grid">
      <label class="field"><span>Amount</span>
        <input class="input" type="number" id="c-amt" min="0" step="0.01" required />
      </label>
      <label class="field"><span>From account</span>
        <select class="select" id="c-account">
          ${state.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
        </select>
      </label>
      <div class="form-actions">
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button type="submit" class="btn primary">Add contribution</button>
      </div>
    </form>
  `);
  $('#contrib-form').addEventListener('submit', e => {
    e.preventDefault();
    const amt = parseFloat($('#c-amt').value);
    if (!(amt > 0)) return;
    g.saved = (+g.saved || 0) + amt;
    state.transactions.push({
      id: uid(), date: todayISO(),
      type: 'savings', category: g.name, amount: amt,
      account: $('#c-account').value, note: 'Goal contribution',
    });
    save(); closeModal(); render();
    toast(`Added ${fmt(amt)} to ${g.name}`, 'success');
  });
}

function openAccountModal() {
  openModal('New account', `
    <form id="acc-form" class="form-grid">
      <label class="field"><span>Name</span>
        <input class="input" id="a-name" required placeholder="e.g. Savings account"/>
      </label>
      <label class="field"><span>Type</span>
        <select class="select" id="a-type">
          <option value="bank">Bank</option>
          <option value="cash">Cash</option>
          <option value="credit">Credit Card</option>
          <option value="investment">Investment</option>
        </select>
      </label>
      <label class="field"><span>Opening balance</span>
        <input class="input" type="number" id="a-opening" step="0.01" value="0" />
      </label>
      <div class="form-actions">
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button type="submit" class="btn primary">Create account</button>
      </div>
    </form>
  `);
  $('#acc-form').addEventListener('submit', e => {
    e.preventDefault();
    state.accounts.push({
      id: uid(),
      name: $('#a-name').value.trim(),
      type: $('#a-type').value,
      opening: parseFloat($('#a-opening').value) || 0,
    });
    save(); closeModal(); render(); toast('Account created', 'success');
  });
}

function openRecurringModal() {
  openModal('New recurring entry', `
    <form id="rec-form" class="form-grid">
      <label class="field"><span>Name</span>
        <input class="input" id="r-name" required placeholder="e.g. Netflix"/>
      </label>
      <div class="seg" id="r-type-seg">
        <button type="button" data-t="expense" class="active">Expense</button>
        <button type="button" data-t="income">Income</button>
        <button type="button" data-t="savings">Savings</button>
      </div>
      <input type="hidden" id="r-type" value="expense" />
      <div class="form-grid cols-2">
        <label class="field"><span>Amount</span>
          <input class="input" type="number" id="r-amt" min="0" step="0.01" required/>
        </label>
        <label class="field"><span>Frequency</span>
          <select class="select" id="r-freq">
            <option>monthly</option><option>weekly</option><option>yearly</option>
          </select>
        </label>
      </div>
      <label class="field"><span>Next due date</span>
        <input class="input" type="date" id="r-next" value="${todayISO()}" required/>
      </label>
      <label class="field"><span>Category</span>
        <input class="input" id="r-cat" required placeholder="Subscriptions"/>
      </label>
      <label class="field"><span>Account</span>
        <select class="select" id="r-account">
          ${state.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
        </select>
      </label>
      <div class="form-actions">
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button type="submit" class="btn primary">Create</button>
      </div>
    </form>
  `);
  $('#r-type-seg').querySelectorAll('button').forEach(b =>
    b.addEventListener('click', () => {
      $('#r-type').value = b.dataset.t;
      $('#r-type-seg').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    }));
  $('#rec-form').addEventListener('submit', e => {
    e.preventDefault();
    state.recurring.push({
      id: uid(),
      name: $('#r-name').value.trim(),
      type: $('#r-type').value,
      amount: parseFloat($('#r-amt').value),
      frequency: $('#r-freq').value,
      category: $('#r-cat').value.trim(),
      account: $('#r-account').value,
      nextDate: $('#r-next').value || todayISO(),
    });
    save(); closeModal(); render(); toast('Recurring entry created', 'success');
  });
}

/* ============================================================
   Charts
   ============================================================ */
const charts = {};
const PALETTE = ['#6366f1', '#10b981', '#ef4444', '#0ea5e9', '#f59e0b', '#ec4899',
                 '#84cc16', '#a855f7', '#14b8a6', '#f97316', '#eab308', '#06b6d4'];

function chartTheme() {
  const cs = getComputedStyle(document.documentElement);
  return {
    text: cs.getPropertyValue('--text').trim() || '#222',
    grid: cs.getPropertyValue('--border').trim() || '#ddd',
  };
}

function drawCharts() {
  if (typeof Chart === 'undefined') return;
  const { text, grid } = chartTheme();
  Chart.defaults.color = text;
  Chart.defaults.borderColor = grid;
  Chart.defaults.font.family = "'Inter', sans-serif";

  drawTrendChart();
  drawCategoryChart();
  drawFlowChart();
  drawNetChart();
}

function destroy(name) { charts[name]?.destroy(); charts[name] = null; }

function monthsOfYear(year) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
}

function drawTrendChart() {
  const el = document.getElementById('chart-trend');
  if (!el) return;
  const year = state.period.slice(0, 4);
  const months = monthsOfYear(year);
  const labels = months.map(m => new Date(m + '-01').toLocaleDateString(undefined, { month: 'short' }));
  const inc = months.map(m => sumBy(state.transactions.filter(t => t.date?.startsWith(m)), 'income'));
  const exp = months.map(m => sumBy(state.transactions.filter(t => t.date?.startsWith(m)), 'expense'));

  destroy('trend');
  charts.trend = new Chart(el, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Income',   data: inc, borderColor: '#10b981',
          backgroundColor: 'rgba(16,185,129,0.12)', fill: true, tension: 0.35, pointRadius: 3, pointHoverRadius: 5, borderWidth: 2 },
        { label: 'Expenses', data: exp, borderColor: '#ef4444',
          backgroundColor: 'rgba(239,68,68,0.12)',  fill: true, tension: 0.35, pointRadius: 3, pointHoverRadius: 5, borderWidth: 2 },
      ],
    },
    options: chartOpts({ legend: true }),
  });
}

function drawCategoryChart() {
  const el = document.getElementById('chart-cat');
  if (!el) return;
  const monthly = state.transactions.filter(t => txInPeriod(t) && t.type === 'expense');
  const byCat = {};
  monthly.forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + +t.amount; });
  const labels = Object.keys(byCat);
  const data = labels.map(l => byCat[l]);
  destroy('cat');
  if (!labels.length) {
    const ctx = el.getContext('2d');
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.fillStyle = chartTheme().text + '80';
    ctx.font = '500 13px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('No expenses this period', el.width / 2, 80);
    return;
  }
  charts.cat = new Chart(el, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 0, hoverOffset: 8 }],
    },
    options: {
      cutout: '65%',
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 10, padding: 12, font: { size: 12 } } },
        tooltip: tooltipFmt(),
      },
      maintainAspectRatio: false,
    },
  });
}

function drawFlowChart() {
  const el = document.getElementById('chart-flow');
  if (!el) return;
  const year = state.period.slice(0, 4);
  const months = monthsOfYear(year);
  const labels = months.map(m => new Date(m + '-01').toLocaleDateString(undefined, { month: 'short' }));
  const inc = months.map(m => sumBy(state.transactions.filter(t => t.date?.startsWith(m)), 'income'));
  const exp = months.map(m => sumBy(state.transactions.filter(t => t.date?.startsWith(m)), 'expense'));
  const sav = months.map(m => sumBy(state.transactions.filter(t => t.date?.startsWith(m)), 'savings'));
  destroy('flow');
  charts.flow = new Chart(el, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Income',   data: inc, backgroundColor: '#10b981', borderRadius: 6 },
        { label: 'Expenses', data: exp, backgroundColor: '#ef4444', borderRadius: 6 },
        { label: 'Savings',  data: sav, backgroundColor: '#0ea5e9', borderRadius: 6 },
      ],
    },
    options: chartOpts({ legend: true }),
  });
}

function drawNetChart() {
  const el = document.getElementById('chart-net');
  if (!el) return;
  const year = state.period.slice(0, 4);
  const months = monthsOfYear(year);
  const labels = months.map(m => new Date(m + '-01').toLocaleDateString(undefined, { month: 'short' }));
  let cum = 0;
  const data = months.map(m => {
    const inc = sumBy(state.transactions.filter(t => t.date?.startsWith(m)), 'income');
    const exp = sumBy(state.transactions.filter(t => t.date?.startsWith(m)), 'expense');
    const sav = sumBy(state.transactions.filter(t => t.date?.startsWith(m)), 'savings');
    cum += inc - exp - sav;
    return cum;
  });
  destroy('net');
  charts.net = new Chart(el, {
    type: 'line',
    data: { labels, datasets: [{
      label: 'Cumulative net', data, borderColor: '#6366f1',
      backgroundColor: 'rgba(99,102,241,0.15)', fill: true, tension: 0.35, borderWidth: 2,
    }] },
    options: chartOpts({ legend: false }),
  });
}

function chartOpts({ legend }) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: legend ? { position: 'bottom', labels: { boxWidth: 10, padding: 12 } } : { display: false },
      tooltip: tooltipFmt(),
    },
    scales: {
      x: { grid: { display: false } },
      y: { beginAtZero: true, grid: { color: chartTheme().grid }, ticks: { callback: v => fmt(v, { compact: true }) } },
    },
  };
}

function tooltipFmt() {
  return {
    backgroundColor: 'rgba(20,24,40,0.95)',
    padding: 12, cornerRadius: 8, boxPadding: 4,
    callbacks: { label: ctx => `${ctx.dataset.label || ''}  ${fmt(ctx.parsed.y ?? ctx.parsed)}` },
  };
}

/* ============================================================
   Import / export
   ============================================================ */
function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  download(blob, `fintrack-${todayISO()}.json`);
  toast('Data exported', 'success');
}
function exportCsv() {
  const rows = [['date', 'type', 'category', 'amount', 'account', 'note']];
  state.transactions.forEach(t => {
    const acc = state.accounts.find(a => a.id === t.account)?.name || '';
    rows.push([t.date, t.type, t.category, t.amount, acc, (t.note || '').replace(/"/g, '""')]);
  });
  const csv = rows.map(r => r.map(c => /[",\n]/.test(String(c)) ? `"${c}"` : c).join(',')).join('\n');
  download(new Blob([csv], { type: 'text/csv' }), `fintrack-transactions-${todayISO()}.csv`);
  toast('Transactions exported', 'success');
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function handleImport(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result);
      if (file.name.endsWith('.csv')) importCsv(text);
      else importJson(text);
      save(); render(); toast('Import complete', 'success');
    } catch (err) {
      toast('Import failed: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function importJson(text) {
  const obj = JSON.parse(text);
  if (!obj || !Array.isArray(obj.transactions)) throw new Error('Invalid file');
  if (!confirm(`Replace current data with ${obj.transactions.length} transactions?`)) return;
  const next = normalizeState({
    ...obj,
    accounts: obj.accounts?.length ? obj.accounts : state.accounts,
    currency: obj.currency || state.currency,
    theme: state.theme,
    period: state.period,
    view: state.view,
  });
  Object.assign(state, next);
}

function importCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = parseCsvLine(lines.shift()).map(s => s.toLowerCase());
  const idx = k => header.indexOf(k);
  const di = idx('date'), ti = idx('type'), ci = idx('category'), ai = idx('amount');
  const ni = idx('note'), accIdx = idx('account');
  if (di < 0 || ci < 0 || ai < 0) throw new Error('CSV needs date, category, amount columns');
  const rawRows = lines.map(line => {
    const p = parseCsvLine(line);
    return {
      id: uid(), date: p[di],
      type: ti >= 0 ? (p[ti] || 'expense') : 'expense',
      category: p[ci],
      amount: parseFloat(p[ai]) || 0,
      note: ni >= 0 ? (p[ni] || '') : '',
      account: state.accounts.find(a => a.name === p[accIdx])?.id || state.accounts[0]?.id,
    };
  });
  const rows = rawRows.map(normalizeTransaction).filter(Boolean);
  if (!rows.length) throw new Error('No valid rows found in CSV');
  if (!confirm(`Append ${rows.length} transactions from CSV?`)) return;
  state.transactions.push(...rows);
}

function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') q = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

/* ============================================================
   Boot
   ============================================================ */
async function boot() {
  const authGate = $('#auth-gate');
  const appShell = $('#app-shell');

  if (!auth || !authGate || !appShell) {
    console.error('Auth shell is not configured correctly.');
    return;
  }

  let initFailed = false;
  try {
    await auth.init?.();
  } catch (err) {
    console.error(err);
    initFailed = true;
  }

  const showSetupGate = err => {
    authGate.hidden = false;
    appShell.hidden = true;
    const card = authGate.querySelector('.auth-card');
    if (card) {
      card.innerHTML = `
        <div class="auth-brand">FinTrack</div>
        <h1>Setup required</h1>
        <p class="muted" style="margin-top:8px;">
          The app could not start because Firebase is not configured yet.
        </p>
        <p class="muted" style="margin-top:8px;">
          Open <strong>config.js</strong> and replace the placeholder values with your Firebase project keys,
          then enable <strong>Email/Password</strong> sign-in in your Firebase console.
        </p>
        <pre style="background:var(--surface-2);padding:12px;border-radius:8px;font-size:12px;overflow:auto;margin-top:12px;">${escapeHtml(err?.message || 'Unknown initialization error')}</pre>
      `;
    }
  };

  if (initFailed) {
    showSetupGate(auth.getInitError?.());
    return;
  }

  const setAuthMode = isSignup => {
    const title = $('#auth-title');
    const sub = $('#auth-sub');
    const toggle = $('#auth-toggle');
    const submit = $('#auth-submit');
    const nameInput = $('#auth-name');
    const passwordInput = $('#auth-password');
    const nameField = nameInput?.closest('label');
    const forgotWrap = $('#auth-forgot-wrap');

    const adminOnly = !!auth.isAdminOnly;
    const effectiveSignup = adminOnly ? false : isSignup;

    if (title) title.textContent = effectiveSignup ? 'Create account' : 'Sign in';
    if (sub) sub.textContent = effectiveSignup
      ? 'Create a private FinTrack workspace for your data.'
      : (adminOnly ? 'Admin login only.' : 'Access your personal finance workspace.');
    if (toggle) {
      toggle.textContent = effectiveSignup ? 'Back to sign in' : 'Create account';
      toggle.dataset.mode = effectiveSignup ? 'signup' : 'signin';
      toggle.hidden = adminOnly;
    }
    if (submit) submit.textContent = effectiveSignup ? 'Create account' : 'Sign in';

    if (nameField) nameField.hidden = !effectiveSignup;
    if (nameInput) {
      nameInput.required = effectiveSignup;
      if (!effectiveSignup) nameInput.value = '';
    }
    if (passwordInput) {
      passwordInput.autocomplete = effectiveSignup ? 'new-password' : 'current-password';
    }
    if (forgotWrap) forgotWrap.hidden = effectiveSignup;
  };

  const showAuthGate = () => {
    authGate.hidden = false;
    appShell.hidden = true;
    setAuthMode(false);

    $('#auth-toggle')?.addEventListener('click', () => {
      const isSignup = $('#auth-toggle').dataset.mode !== 'signup';
      setAuthMode(isSignup);
    });

    $('#auth-forgot')?.addEventListener('click', async () => {
      const email = $('#auth-email')?.value?.trim()
        || prompt('Enter the email address for password reset:')
        || '';
      if (!email) { toast('Email is required', 'error'); return; }
      try {
        await auth.requestPasswordReset(email);
        toast('Password reset email sent. Check your inbox.', 'success');
      } catch (err) {
        toast(err?.message || 'Could not send reset email', 'error');
      }
    });

    $('#auth-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const isSignup = $('#auth-toggle')?.dataset.mode === 'signup';
      const email = $('#auth-email')?.value || '';
      const password = $('#auth-password')?.value || '';
      const name = $('#auth-name')?.value || '';

      try {
        if (isSignup) await auth.register({ name, email, password });
        else await auth.login({ email, password });
        location.reload();
      } catch (err) {
        toast(err?.message || 'Authentication failed', 'error');
      }
    });
  };

  const currentUser = auth.getCurrentUser();
  if (!currentUser) {
    showAuthGate();
    return;
  }

  authGate.hidden = true;
  appShell.hidden = false;

  $('#active-user').textContent = currentUser.name || currentUser.email;
  $('#logout-btn')?.addEventListener('click', () => {
    flushSave();
    auth.logout();
    location.reload();
  });

  // Post any locally-known recurring entries that have come due since last open.
  const localPosted = autoPostDueRecurring();
  if (localPosted > 0) {
    save();
    toast(`Auto-posted ${localPosted} recurring ${localPosted === 1 ? 'entry' : 'entries'}`, 'success');
  }

  // Subscribe to live cloud updates (other devices / tabs).
  // First emission is also the initial hydrate.
  if (storage?.subscribeCloudState) {
    storage.subscribeCloudState(currentUser.id, cloudState => {
      const next = normalizeState(cloudState);
      // Preserve UI-only fields so a remote save doesn't yank the view/period.
      next.view = state.view;
      next.period = state.period;
      next.theme = state.theme;
      Object.assign(state, next);
      const cloudPosted = autoPostDueRecurring();
      if (cloudPosted > 0) save();
      render();
    });
  } else if (storage?.getCloudState) {
    storage.getCloudState(currentUser.id).then(cloudState => {
      if (!cloudState) return;
      const next = normalizeState(cloudState);
      next.view = state.view; next.period = state.period; next.theme = state.theme;
      Object.assign(state, next);
      render();
    }).catch(err => console.warn('Cloud hydrate failed:', err?.message || err));
  }

  // Push initial state up if cloud is empty (first device).
  if (storage?.getCloudState && storage?.setCloudState) {
    storage.getCloudState(currentUser.id).then(cloudState => {
      if (!cloudState && (state.transactions.length || state.goals.length || state.recurring.length)) {
        storage.setCloudState(currentUser.id, state);
      }
    }).catch(() => {});
  }

  document.documentElement.dataset.theme = state.theme;
  $('#period').value = state.period;

  // Flush pending persistence during lifecycle transitions.
  window.addEventListener('beforeunload', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushSave();
  });

  // Sidebar nav
  $$('.nav-item').forEach(n =>
    n.addEventListener('click', () => setView(n.dataset.view)));

  $('#period').addEventListener('change', e => {
    state.period = e.target.value || ymKey(new Date());
    save(); render();
  });

  $('#theme-toggle').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme;
    save(); drawCharts();
  });

  $('#quick-add').addEventListener('click', () => openTxModal());

  $('#menu-toggle').addEventListener('click', () =>
    $('#sidebar').classList.toggle('open'));

  // Modal close
  document.addEventListener('click', e => {
    if (e.target.matches('[data-close]') || e.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
    if ((e.key === 'n' || e.key === 'N') && !e.target.matches('input, textarea, select')) {
      e.preventDefault(); openTxModal();
    }
  });

  $('#import-file').addEventListener('change', handleImport);

  setView(state.view || 'dashboard');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { void boot(); });
} else {
  void boot();
}

