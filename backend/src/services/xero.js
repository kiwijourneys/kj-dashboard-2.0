/**
 * Xero Accounting API service.
 *
 * Auth: OAuth 2.0 with a long-lived refresh token (valid 60 days; auto-renewed
 * on every use so it stays alive indefinitely).  Tokens are stored in .env:
 *   XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_TENANT_ID, XERO_REFRESH_TOKEN
 *
 * To bootstrap credentials the first time, run:
 *   node scripts/xero-auth.js
 */

const fs    = require('fs');
const path  = require('path');
const axios = require('axios');
const config = require('../config');
const { getOrFetch, buildKey, NAMESPACES, recordSync } = require('../cache');

const ENV_PATH = path.resolve(__dirname, '../../.env');

/**
 * Write the rotated Xero refresh token back to .env so restarts don't break auth.
 * Xero invalidates the previous refresh token the moment it issues a new one, so
 * if the backend restarts before we persist it, the whole token chain is broken.
 */
function _persistRefreshToken(newToken) {
  try {
    let env = fs.readFileSync(ENV_PATH, 'utf8');
    if (env.match(/^XERO_REFRESH_TOKEN=.*/m)) {
      env = env.replace(/^XERO_REFRESH_TOKEN=.*/m, `XERO_REFRESH_TOKEN=${newToken}`);
    } else {
      env += `\nXERO_REFRESH_TOKEN=${newToken}\n`;
    }
    fs.writeFileSync(ENV_PATH, env, 'utf8');
    config.xero.refreshToken = newToken; // keep in-process config in sync
    console.log('[xero] Refresh token rotated and persisted to .env');
  } catch (err) {
    console.error('[xero] WARNING: could not persist rotated refresh token to .env:', err.message);
    console.error('[xero] New token (save manually):', newToken);
  }
}

const TOKEN_URL  = 'https://identity.xero.com/connect/token';
const API_BASE   = 'https://api.xero.com/api.xro/2.0';

// ── Token management ─────────────────────────────────────────────────────────

// In-process cache; refreshed when within 90 seconds of expiry.
let _token = {
  accessToken:  null,
  refreshToken: null, // updated when Xero rotates it
  expiresAt:    0,
};

function _b64Creds() {
  return Buffer.from(`${config.xero.clientId}:${config.xero.clientSecret}`).toString('base64');
}

async function _refreshToken() {
  const refreshToken = _token.refreshToken || config.xero.refreshToken;
  if (!refreshToken) throw new Error('XERO_REFRESH_TOKEN not set — run: node scripts/xero-auth.js');

  const resp = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
    {
      headers: {
        Authorization:  `Basic ${_b64Creds()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  _token.accessToken  = resp.data.access_token;
  _token.refreshToken = resp.data.refresh_token; // Xero rotates on every use
  _token.expiresAt    = Date.now() + resp.data.expires_in * 1000;

  // Xero rotates the refresh token on every use. Persist it immediately so a
  // backend restart doesn't invalidate the chain.
  if (resp.data.refresh_token && resp.data.refresh_token !== config.xero.refreshToken) {
    _persistRefreshToken(resp.data.refresh_token);
  }

  return _token.accessToken;
}

async function _getAccessToken() {
  if (_token.accessToken && Date.now() < _token.expiresAt - 90_000) {
    return _token.accessToken;
  }
  return _refreshToken();
}

function _headers(accessToken) {
  return {
    Authorization:   `Bearer ${accessToken}`,
    'Xero-Tenant-Id': config.xero.tenantId,
    Accept:           'application/json',
  };
}

/**
 * Xero GET with automatic 429 retry.
 * Xero rate-limits at ~60 calls/min. When a region has multiple option IDs
 * (e.g. Nelson = Nelson + Mapua) and several endpoints fire concurrently,
 * we can easily hit the limit. Retry up to 3 times with exponential backoff.
 */
async function _xeroGet(url, config, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await axios.get(url, config);
    } catch (err) {
      const status = err.response?.status;
      if (status === 429 && attempt < retries) {
        // Xero may send Retry-After header (seconds); fall back to exponential backoff
        const retryAfter = parseInt(err.response?.headers?.['retry-after'] || '0', 10);
        const delay = retryAfter > 0 ? retryAfter * 1000 : (2 ** attempt) * 1000;
        console.warn(`[xero] 429 rate limit — retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

// ── P&L report parser ────────────────────────────────────────────────────────

/**
 * Turn a raw Xero P&L report into a clean structure.
 *
 * Xero report rows look like:
 *   { RowType: 'Header', Cells: [{Value:'Account'}, {Value:'Jan 26'}, ...] }
 *   { RowType: 'Section', Title: 'Income', Rows: [
 *       { RowType: 'Row',        Cells: [{Value:'Tour Income'}, {Value:'1000'}, ...] }
 *       { RowType: 'SummaryRow', Cells: [{Value:'Total Income'}, {Value:'1000'}, ...] }
 *   ]}
 *
 * Returns:
 * {
 *   periods: ['Jan 26', 'Feb 26', ...],
 *   sections: [
 *     { title: 'Income', accounts: [{name, values}], total: [numbers] },
 *     ...
 *   ]
 * }
 */
function _parsePnL(report) {
  const rows = report.Rows || [];

  // Header row — first cell is "Account", rest are period labels
  const headerRow = rows.find(r => r.RowType === 'Header');
  const periods = headerRow
    ? headerRow.Cells.slice(1).map(c => c.Value || '')
    : [];

  const sections = [];
  for (const row of rows) {
    if (row.RowType !== 'Section') continue;

    const accounts = [];
    let total = [];

    for (const sub of row.Rows || []) {
      const cells = sub.Cells || [];
      const values = cells.slice(1).map(c => {
        const v = parseFloat(c.Value);
        return isNaN(v) ? 0 : v;
      });

      if (sub.RowType === 'Row') {
        accounts.push({ name: cells[0]?.Value || '', values });
      } else if (sub.RowType === 'SummaryRow') {
        total = values;
      }
    }

    sections.push({ title: row.Title || '', accounts, total });
  }

  return { periods, sections };
}

/**
 * Map section titles to canonical keys.
 * Xero section titles can vary slightly — normalize them.
 */
function _sectionKey(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('income') && !t.includes('other')) return 'income';
  if (t.includes('cost') || t.includes('cost of sales'))   return 'costOfSales';
  if (t.includes('other income'))                          return 'otherIncome';
  if (t.includes('expense') || t.includes('operating'))    return 'expenses';
  return t.replace(/\s+/g, '_');
}

/**
 * Build a summary object from sections.
 * Last value in each total array is the period total when periods > 1.
 */
function _summarise(sections, idx = null) {
  const get = (key) => {
    const s = sections.find(s => _sectionKey(s.title) === key);
    if (!s) return 0;
    const vals = s.total;
    if (vals.length === 0) return 0;
    return idx !== null ? (vals[idx] ?? 0) : vals[vals.length - 1];
  };

  const income      = get('income');
  const cogs        = get('costOfSales');
  const otherIncome = get('otherIncome');
  const expenses    = get('expenses');
  const grossProfit = income - cogs;
  const netProfit   = grossProfit + otherIncome - expenses;

  return { income, cogs, otherIncome, expenses, grossProfit, netProfit };
}

// ── Cost Centre → region mapping ──────────────────────────────────────────────

const COST_CENTRE_CATEGORY_ID = 'b1ef8764-dfd0-4886-bf9c-1aca0e8290dc';

// Ferry is a standalone cost centre — exclude these income accounts from regional views
// so ferry transactions incorrectly tagged to a depot don't pollute regional revenue.
const FERRY_ACCOUNT_PATTERN = /ferry/i;

// Map dashboard region name → one or more Xero tracking option IDs
const REGION_TO_OPTION_IDS = {
  'Nelson':        ['60e8a2cb-acb6-445c-bfe6-60bd3fee433c',  // Nelson
                    'b6d08826-36d9-4453-96bf-d9855f9e67e8'], // Mapua
  'West Coast':    ['5d078031-4741-42e2-8bd0-23d4527e4eeb'], // Hokitika
  'Central Otago': ['a005c21a-261b-4557-884d-373c35142182'], // Cromwell
  'Kawarau Gorge': ['187fa2b4-9a41-4796-9c52-be6e16c4b1cc'], // Queenstown
};

/**
 * Fetch P&L for a single tracking option ID. Returns { sections }.
 */
async function _fetchPnLForOption(token, optionId, extraParams = {}) {
  const resp = await _xeroGet(`${API_BASE}/Reports/ProfitAndLoss`, {
    headers: _headers(token),
    params: {
      ...extraParams,
      trackingCategoryID: COST_CENTRE_CATEGORY_ID,
      trackingOptionID:   optionId,
    },
  });
  const report = resp.data.Reports?.[0];
  if (!report) return { sections: [] };
  return _parsePnL(report);
}

/**
 * Merge two sets of P&L sections by summing matching account values.
 */
function _mergeSections(a, b) {
  if (!a.length) return b;
  if (!b.length) return a;
  const merged = a.map(sA => {
    const sB = b.find(s => s.title === sA.title);
    if (!sB) return sA;
    const accounts = sA.accounts.map(accA => {
      const accB = sB.accounts.find(x => x.name === accA.name);
      return { name: accA.name, values: accA.values.map((v, i) => v + (accB?.values[i] ?? 0)) };
    });
    // add any accounts only in B
    for (const accB of sB.accounts) {
      if (!accounts.find(x => x.name === accB.name)) accounts.push(accB);
    }
    const total = sA.total.map((v, i) => v + (sB.total[i] ?? 0));
    return { title: sA.title, accounts, total };
  });
  // add any sections only in B
  for (const sB of b) {
    if (!merged.find(s => s.title === sB.title)) merged.push(sB);
  }
  return merged;
}

/**
 * Fetch combined P&L sections for a region (may require multiple option calls).
 */
async function _fetchRegionSections(token, region, extraParams = {}) {
  const optionIds = REGION_TO_OPTION_IDS[region];
  if (!optionIds) throw new Error(`Unknown region: ${region}`);

  const results = await Promise.all(
    optionIds.map(id => _fetchPnLForOption(token, id, extraParams))
  );
  return results.reduce((acc, r) => _mergeSections(acc, r.sections), []);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch overall P&L summary for a date range, optionally filtered by region.
 * Returns: { period, summary, incomeAccounts }
 */
async function getPnLSummary({ startDate, endDate, region } = {}) {
  if (!config.xero.clientId) throw new Error('Xero not configured');

  const cacheKey = buildKey(NAMESPACES.XERO, 'pnl', startDate || 'all', endDate || 'all', region || 'all');
  return getOrFetch(cacheKey, async () => {
    const token = await _getAccessToken();
    const dateParams = {};
    if (startDate) dateParams.fromDate = startDate;
    if (endDate)   dateParams.toDate   = endDate;

    let sections;
    if (region && REGION_TO_OPTION_IDS[region]) {
      sections = await _fetchRegionSections(token, region, dateParams);
    } else {
      const resp = await _xeroGet(`${API_BASE}/Reports/ProfitAndLoss`, {
        headers: _headers(token),
        params:  dateParams,
      });
      const report = resp.data.Reports?.[0];
      if (!report) throw new Error('Xero: no P&L report returned');
      sections = _parsePnL(report).sections;
    }

    const summary = _summarise(sections);
    recordSync('xero');

    const incomeSection = sections.find(s => _sectionKey(s.title) === 'income');
    let incomeAccounts = (incomeSection?.accounts || []).map(a => ({
      name: a.name,
      value: a.values[a.values.length - 1] ?? 0,
    })).filter(a => a.value !== 0).sort((a, b) => b.value - a.value);

    // When filtering by region, strip ferry accounts — Ferry is a standalone cost centre
    // and any ferry transactions tagged to a depot are data entry errors.
    if (region) {
      const ferryTotal = incomeAccounts
        .filter(a => FERRY_ACCOUNT_PATTERN.test(a.name))
        .reduce((s, a) => s + a.value, 0);
      incomeAccounts = incomeAccounts.filter(a => !FERRY_ACCOUNT_PATTERN.test(a.name));
      summary.income     -= ferryTotal;
      summary.grossProfit -= ferryTotal;
      summary.netProfit   -= ferryTotal;
    }

    return { period: { startDate, endDate }, summary, incomeAccounts };
  });
}

/**
 * Enumerate calendar months between two YYYY-MM-DD strings (inclusive).
 * Returns array of { label, from, to } objects in chronological order.
 */
function _monthRange(startDate, endDate) {
  const months = [];
  const s = new Date(startDate + 'T12:00:00Z');
  const e = new Date(endDate   + 'T12:00:00Z');
  let cur = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1));
  while (cur <= e) {
    const y  = cur.getUTCFullYear();
    const m  = cur.getUTCMonth();
    const from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const to   = `${y}-${String(m + 1).padStart(2, '0')}-${lastDay}`;
    const label = cur.toLocaleDateString('en-NZ', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    months.push({ label, from, to });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return months;
}

/**
 * Fetch a single-month P&L summary (cached per month + region).
 */
async function _fetchMonthSummary(from, to, region = null) {
  const cacheKey = buildKey(NAMESPACES.XERO, 'month', from, to, region || 'all');
  return getOrFetch(cacheKey, async () => {
    const token = await _getAccessToken();
    const dateParams = { fromDate: from, toDate: to };

    let sections;
    if (region && REGION_TO_OPTION_IDS[region]) {
      sections = await _fetchRegionSections(token, region, dateParams);
    } else {
      const resp = await _xeroGet(`${API_BASE}/Reports/ProfitAndLoss`, {
        headers: _headers(token),
        params:  dateParams,
      });
      const report = resp.data.Reports?.[0];
      if (!report) throw new Error(`Xero: no P&L report for ${from}–${to}`);
      sections = _parsePnL(report).sections;
    }

    const summary = _summarise(sections);
    const incomeSection = sections.find(s => _sectionKey(s.title) === 'income');
    const accounts = {};
    let ferryTotal = 0;
    for (const acc of incomeSection?.accounts || []) {
      const v = acc.values[acc.values.length - 1] ?? 0;
      if (region && FERRY_ACCOUNT_PATTERN.test(acc.name)) {
        ferryTotal += v; // track before skipping
        continue;
      }
      if (v !== 0) accounts[acc.name] = v;
    }
    // Adjust income summary to exclude ferry when filtering by region
    if (region && ferryTotal !== 0) {
      summary.income      -= ferryTotal;
      summary.grossProfit -= ferryTotal;
      summary.netProfit   -= ferryTotal;
    }
    return { summary, accounts };
  });
}

/**
 * Fetch monthly P&L breakdown by making one API call per calendar month.
 * Optionally filtered by region (cost centre).
 *
 * Returns: {
 *   months: string[],
 *   income: number[],
 *   grossProfit: number[],
 *   netProfit: number[],
 *   cogs: number[],
 *   expenses: number[],
 *   incomeByAccount: { [accountName]: number[] }
 * }
 */
async function getMonthlyPnL({ startDate, endDate, region } = {}) {
  if (!config.xero.clientId) throw new Error('Xero not configured');
  if (!startDate || !endDate) throw new Error('Xero monthly: startDate and endDate required');

  const cacheKey = buildKey(NAMESPACES.XERO, 'monthly', startDate, endDate, region || 'all');
  return getOrFetch(cacheKey, async () => {
    const monthDefs = _monthRange(startDate, endDate);

    const results = await Promise.all(
      monthDefs.map(m => _fetchMonthSummary(m.from, m.to, region || null))
    );
    recordSync('xero');

    const allAccounts = new Set();
    for (const r of results) Object.keys(r.accounts).forEach(k => allAccounts.add(k));

    const incomeByAccount = {};
    for (const name of allAccounts) {
      incomeByAccount[name] = results.map(r => r.accounts[name] ?? 0);
    }

    return {
      months:      monthDefs.map(m => m.label),
      income:      results.map(r => r.summary.income),
      grossProfit: results.map(r => r.summary.grossProfit),
      netProfit:   results.map(r => r.summary.netProfit),
      cogs:        results.map(r => r.summary.cogs),
      expenses:    results.map(r => r.summary.expenses),
      incomeByAccount,
    };
  });
}

/**
 * Fetch all tracking categories and their options from Xero.
 */
async function getTrackingCategories() {
  if (!config.xero.clientId) throw new Error('Xero not configured');
  const token = await _getAccessToken();
  const resp = await _xeroGet(`${API_BASE}/TrackingCategories`, {
    headers: _headers(token),
  });
  return resp.data.TrackingCategories || [];
}

// ── Cost Centre Breakdown ─────────────────────────────────────────────────────

// All cost centres for the stacked revenue chart (incl. Ferry as standalone)
const ALL_COST_CENTRES = {
  'Nelson':        ['60e8a2cb-acb6-445c-bfe6-60bd3fee433c',  // Nelson
                    'b6d08826-36d9-4453-96bf-d9855f9e67e8'], // Mapua
  'West Coast':    ['5d078031-4741-42e2-8bd0-23d4527e4eeb'], // Hokitika
  'Central Otago': ['a005c21a-261b-4557-884d-373c35142182'], // Cromwell
  'Kawarau Gorge': ['187fa2b4-9a41-4796-9c52-be6e16c4b1cc'], // Queenstown
  'Ferry':         ['4b3705c3-febd-4191-8f48-b2f6767aca4e'], // Ferry
};

/**
 * Build an array of ISO week periods between two dates.
 * Each week runs Mon–Sun, clipped to [startDate, endDate].
 */
function _weekRange(startDate, endDate) {
  const weeks = [];
  const s = new Date(startDate + 'T12:00:00Z');
  const e = new Date(endDate   + 'T12:00:00Z');

  // Find the Monday of the week containing startDate
  let cur = new Date(s);
  const dow = cur.getUTCDay(); // 0=Sun
  cur.setUTCDate(cur.getUTCDate() - (dow === 0 ? 6 : dow - 1));

  while (cur <= e) {
    const weekStart = new Date(Math.max(cur.getTime(), s.getTime()));
    const weekEndRaw = new Date(cur);
    weekEndRaw.setUTCDate(weekEndRaw.getUTCDate() + 6);
    const weekEnd = new Date(Math.min(weekEndRaw.getTime(), e.getTime()));

    const from  = weekStart.toISOString().split('T')[0];
    const to    = weekEnd.toISOString().split('T')[0];
    const label = weekStart.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', timeZone: 'UTC' });

    weeks.push({ label, from, to });
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return weeks;
}

/**
 * Fetch all cost centres' income for one period in a single Xero API call.
 * Xero returns cost centres as columns when trackingCategoryID is given without an option ID.
 *
 * Returns: { [costCentreName]: incomeValue }
 */
async function _fetchAllCentresForPeriod(token, from, to) {
  const cacheKey = buildKey(NAMESPACES.XERO, 'ccPeriod', from, to);
  return getOrFetch(cacheKey, async () => {
    const resp = await _xeroGet(`${API_BASE}/Reports/ProfitAndLoss`, {
      headers: _headers(token),
      params:  { fromDate: from, toDate: to, trackingCategoryID: COST_CENTRE_CATEGORY_ID },
    });
    const report = resp.data.Reports?.[0];
    if (!report) return {};

    // Header row tells us which column = which cost centre
    const rows = report.Rows || [];
    const headerRow = rows.find(r => r.RowType === 'Header');
    if (!headerRow) return {};

    // headerRow.Cells = [{Value:''}, {Value:'Cromwell'}, ..., {Value:'Total'}]
    const colNames = (headerRow.Cells || []).map(c => c.Value || '');

    // Sum income across all income section rows per column
    const incomeByCol = {};
    for (const section of rows) {
      if (section.RowType !== 'Section') continue;
      if (_sectionKey(section.Title) !== 'income') continue;
      for (const row of section.Rows || []) {
        if (row.RowType !== 'Row') continue;
        (row.Cells || []).forEach((cell, i) => {
          const col = colNames[i];
          if (!col || col === '' || col === 'Total') return;
          const v = parseFloat(cell.Value) || 0;
          incomeByCol[col] = (incomeByCol[col] || 0) + v;
        });
      }
    }
    return incomeByCol;
  });
}

/**
 * Stacked revenue breakdown by cost centre over time.
 * One Xero API call per period — no per-centre rate limit issues.
 * Granularity: weekly when range ≤ 90 days, monthly otherwise.
 *
 * Returns: {
 *   granularity: 'weekly' | 'monthly',
 *   periods: string[],
 *   data: { Nelson: number[], 'West Coast': number[], Ferry: number[], ... }
 * }
 */
async function getCostCentreBreakdown({ startDate, endDate } = {}) {
  if (!config.xero.clientId) throw new Error('Xero not configured');
  if (!startDate || !endDate) throw new Error('startDate and endDate required');

  const daysDiff = (new Date(endDate + 'T12:00:00Z') - new Date(startDate + 'T12:00:00Z')) / 86_400_000;
  const granularity = daysDiff <= 90 ? 'weekly' : 'monthly';

  const cacheKey = buildKey(NAMESPACES.XERO, 'ccBreakdown', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const periods = granularity === 'weekly'
      ? _weekRange(startDate, endDate)
      : _monthRange(startDate, endDate);

    const token = await _getAccessToken();

    // One API call per period — Xero returns all cost centres as columns
    const periodResults = [];
    for (const p of periods) {
      periodResults.push(await _fetchAllCentresForPeriod(token, p.from, p.to));
    }

    recordSync('xero');

    // Map Xero cost centre names → dashboard names using ALL_COST_CENTRES option IDs.
    // Simpler: just map by Xero column name directly.
    // Xero columns: Cromwell, Ferry, Head Office, Hokitika, Mapua, Nelson, Queenstown, Unassigned
    const XERO_COL_TO_DASHBOARD = {
      'Nelson':      'Nelson',
      'Mapua':       'Nelson',       // rolls into Nelson
      'Hokitika':    'West Coast',
      'Cromwell':    'Central Otago',
      'Queenstown':  'Kawarau Gorge',
      'Ferry':       'Ferry',
      // Head Office, Unassigned → excluded from chart
    };

    const centreOrder = ['Nelson', 'West Coast', 'Central Otago', 'Kawarau Gorge', 'Ferry'];
    const data = Object.fromEntries(centreOrder.map(c => [c, periods.map(() => 0)]));

    periodResults.forEach((colMap, i) => {
      for (const [xeroCol, income] of Object.entries(colMap)) {
        const dash = XERO_COL_TO_DASHBOARD[xeroCol];
        if (dash && data[dash]) data[dash][i] += income;
      }
    });

    return { granularity, periods: periods.map(p => p.label), data };
  });
}

/**
 * Income by period — weekly if range ≤ 61 days, monthly otherwise.
 * Returns: { granularity, periods: string[], incomeByAccount: { [name]: number[] } }
 */
async function getIncomeByPeriod({ startDate, endDate, region } = {}) {
  if (!config.xero.clientId) throw new Error('Xero not configured');
  if (!startDate || !endDate) throw new Error('startDate and endDate required');

  const daysDiff = (new Date(endDate + 'T12:00:00Z') - new Date(startDate + 'T12:00:00Z')) / 86_400_000;
  const granularity = daysDiff <= 61 ? 'weekly' : 'monthly';

  const cacheKey = buildKey(NAMESPACES.XERO, 'incomeByPeriod', startDate, endDate, region || 'all');
  return getOrFetch(cacheKey, async () => {
    const periodDefs = granularity === 'weekly'
      ? _weekRange(startDate, endDate)
      : _monthRange(startDate, endDate);

    const results = await Promise.all(
      periodDefs.map(p => _fetchMonthSummary(p.from, p.to, region || null))
    );
    recordSync('xero');

    const allAccounts = new Set();
    for (const r of results) Object.keys(r.accounts).forEach(k => allAccounts.add(k));

    const incomeByAccount = {};
    for (const name of allAccounts) {
      incomeByAccount[name] = results.map(r => r.accounts[name] ?? 0);
    }

    return {
      granularity,
      periods:    periodDefs.map(p => p.label),
      periodFrom: periodDefs.map(p => p.from),  // YYYY-MM-DD start of each period
      periodTo:   periodDefs.map(p => p.to),
      incomeByAccount,
    };
  });
}

module.exports = { getPnLSummary, getMonthlyPnL, getTrackingCategories, getCostCentreBreakdown, getIncomeByPeriod };
