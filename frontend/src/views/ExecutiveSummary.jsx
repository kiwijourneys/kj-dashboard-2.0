import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '../context/FilterContext';
import { fetchSummary, fetchGoogleDaily, fetchMetaDaily, fetchMetaDepotDaily, fetchMdLeads, fetchSdLeads, fetchMdClosed, fetchSdClosed, fetchMdActual, fetchSdActual, fetchGa4RezdyRev, fetchGa4BikeRental, fetchGoogleDepotDaily, fetchXeroPnl, fetchXeroMonthly, fetchXeroCostCentres } from '../api';
import KpiCard from '../components/KpiCard';
import ErrorWidget from '../components/ErrorWidget';
import SyncBadge from '../components/SyncBadge';
import {
  LineChart, Line, BarChart, Bar, ComposedChart,
  XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { format, parseISO } from 'date-fns';

const COLORS = {
  multiDay:   '#22c55e',
  singleDay:  '#3b82f6',
  rezdy:      '#f59e0b',
  bikeRental: '#fb923c',
  google:     '#ea4335',
  meta:       '#1877f2',
  revenue:    '#a78bfa',
};

const COST_CENTRE_COLORS = {
  'Nelson':         '#22c55e',
  'West Coast':     '#3b82f6',
  'Central Otago':  '#f59e0b',
  'Kawarau Gorge':  '#fb923c',
  'Ferry':          '#a78bfa',
};

const DEPOT_COLORS = {
  'Nelson':         '#22c55e',
  'West Coast':     '#3b82f6',
  'Central Otago':  '#f59e0b',
  'Kawarau Gorge':  '#fb923c',
  'General':        '#9ca3af',
};
const DEPOTS = ['Nelson', 'West Coast', 'Central Otago', 'Kawarau Gorge', 'General'];

function fmtDate(d) {
  try { return format(parseISO(d), 'dd MMM'); } catch { return d; }
}

function fmtMonth(yyyyMm) {
  try { return format(parseISO(yyyyMm + '-01'), 'MMM yy'); } catch { return yyyyMm; }
}

function fmtNzd(v) {
  if (v === null || v === undefined) return '—';
  return `$${Number(v).toLocaleString('en-NZ', { maximumFractionDigits: 0 })}`;
}

// Merge two daily arrays on date.
// Handles bare arrays (configured) or { daily: [] } objects (not-configured stub).
function toArr(v) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.daily)) return v.daily;
  return [];
}
function mergeDaily(googleData, metaData) {
  const googleArr = toArr(googleData);
  const metaArr   = toArr(metaData);
  const map = {};
  for (const r of googleArr) {
    map[r.date] = { date: r.date, google: r.spendNzd, meta: 0 };
  }
  for (const r of metaArr) {
    if (map[r.date]) map[r.date].meta = r.spendNzd;
    else map[r.date] = { date: r.date, google: 0, meta: r.spendNzd };
  }
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}

export default function ExecutiveSummary() {
  const { queryParams, region } = useFilters();

  const summaryQ  = useQuery({ queryKey: ['summary', queryParams],       queryFn: () => fetchSummary(queryParams) });
  const gDailyQ   = useQuery({ queryKey: ['googleDaily', queryParams],   queryFn: () => fetchGoogleDaily(queryParams) });
  const mDailyQ   = useQuery({ queryKey: ['metaDaily', queryParams],     queryFn: () => fetchMetaDaily(queryParams) });
  const mdLeadsQ  = useQuery({ queryKey: ['mdLeads', queryParams],       queryFn: () => fetchMdLeads(queryParams) });
  const sdLeadsQ  = useQuery({ queryKey: ['sdLeads', queryParams],       queryFn: () => fetchSdLeads(queryParams) });
  const mdClosedQ = useQuery({ queryKey: ['mdClosed', queryParams],      queryFn: () => fetchMdClosed(queryParams) });
  const sdClosedQ = useQuery({ queryKey: ['sdClosed', queryParams],      queryFn: () => fetchSdClosed(queryParams) });
  const rezdyQ    = useQuery({ queryKey: ['rezdyRev', queryParams],      queryFn: () => fetchGa4RezdyRev(queryParams) });
  const brmQ      = useQuery({ queryKey: ['brmConv', queryParams],       queryFn: () => fetchGa4BikeRental(queryParams) });
  const mdActualQ = useQuery({ queryKey: ['mdActual', queryParams],      queryFn: () => fetchMdActual(queryParams) });
  const sdActualQ = useQuery({ queryKey: ['sdActual', queryParams],      queryFn: () => fetchSdActual(queryParams) });

  const depotSpendQ      = useQuery({ queryKey: ['depotDailySpend',     queryParams], queryFn: () => fetchGoogleDepotDaily(queryParams) });
  const metaDepotSpendQ  = useQuery({ queryKey: ['metaDepotDailySpend', queryParams], queryFn: () => fetchMetaDepotDaily(queryParams) });
  const xeroPnlQ     = useQuery({ queryKey: ['xeroPnl',     queryParams], queryFn: () => fetchXeroPnl(queryParams),     retry: 1 });
  const xeroMonthlyQ = useQuery({ queryKey: ['xeroMonthly', queryParams], queryFn: () => fetchXeroMonthly(queryParams), retry: 1 });
  const xeroCcQ      = useQuery({ queryKey: ['xeroCc',      queryParams], queryFn: () => fetchXeroCostCentres(queryParams), retry: 1,
    enabled: !!(queryParams.startDate && queryParams.endDate) });

  const kpis = summaryQ.data?.kpis;
  const dq   = summaryQ.data?.dataQuality;
  const sync = summaryQ.data?.syncTimestamps || {};

  // Build leads-over-time chart data from raw deal arrays
  const leadsChartData = React.useMemo(() => {
    if (!mdLeadsQ.data && !sdLeadsQ.data) return [];
    const byDate = {};
    const addDeals = (deals, key) => {
      for (const d of deals || []) {
        const date = d.createdate?.split('T')[0];
        if (!date) continue;
        if (!byDate[date]) byDate[date] = { date, multiDay: 0, singleDay: 0 };
        byDate[date][key]++;
      }
    };
    addDeals(mdLeadsQ.data?.deals, 'multiDay');
    addDeals(sdLeadsQ.data?.deals, 'singleDay');
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  }, [mdLeadsQ.data, sdLeadsQ.data]);

  // Build revenue-over-time: accrual view anchored to tour start_date (same as Actual Results section).
  // Aggregated weekly so the chart stays clean; all weeks in range filled with 0 to avoid gaps.
  const revenueChartData = React.useMemo(() => {
    const byWeek = {};

    const ensureWeek = (wk) => {
      if (!byWeek[wk]) byWeek[wk] = { date: wk, multiDay: 0, singleDay: 0 };
    };

    // Multi-Day accrual — anchored to tour start_date
    for (const d of mdActualQ.data?.deals || []) {
      const date = d.startdate;
      if (!date) continue;
      const wk = weekStart(date);
      ensureWeek(wk);
      byWeek[wk].multiDay += d.amount || 0;
    }

    // Single-Day accrual — anchored to tour start_date (HubSpot single-day pipeline)
    for (const d of sdActualQ.data?.deals || []) {
      const date = d.startdate;
      if (!date) continue;
      const wk = weekStart(date);
      ensureWeek(wk);
      byWeek[wk].singleDay += d.amount || 0;
    }

    // Fill every week in the selected range with zeros so the x-axis is continuous
    if (queryParams.startDate && queryParams.endDate) {
      let cur = new Date(queryParams.startDate + 'T12:00:00Z');
      const end = new Date(queryParams.endDate + 'T12:00:00Z');
      while (cur <= end) {
        ensureWeek(weekStart(cur.toISOString().split('T')[0]));
        cur.setUTCDate(cur.getUTCDate() + 7);
      }
    }

    return Object.values(byWeek).sort((a, b) => a.date.localeCompare(b.date));
  }, [mdActualQ.data, sdActualQ.data, queryParams]);

  // Ad Spend vs Leads — weekly aggregation of Google + Meta spend with total leads overlay
  const spendChartData = React.useMemo(() => {
    const googleArr = toArr(gDailyQ.data);
    const metaArr   = toArr(mDailyQ.data);

    const byWeek = {};
    const ensure = wk => {
      if (!byWeek[wk]) byWeek[wk] = { date: wk, google: 0, meta: 0, leads: 0 };
    };

    for (const r of googleArr) { const wk = weekStart(r.date); ensure(wk); byWeek[wk].google += r.spendNzd || 0; }
    for (const r of metaArr)   { const wk = weekStart(r.date); ensure(wk); byWeek[wk].meta   += r.spendNzd || 0; }

    // Overlay total leads (multi-day + single-day)
    for (const d of [...(mdLeadsQ.data?.deals || []), ...(sdLeadsQ.data?.deals || [])]) {
      const date = d.createdate?.split('T')[0];
      if (!date) continue;
      const wk = weekStart(date);
      ensure(wk);
      byWeek[wk].leads++;
    }

    // Fill all weeks in range
    if (queryParams.startDate && queryParams.endDate) {
      let cur = new Date(queryParams.startDate + 'T12:00:00Z');
      const end = new Date(queryParams.endDate + 'T12:00:00Z');
      while (cur <= end) { ensure(weekStart(cur.toISOString().split('T')[0])); cur.setUTCDate(cur.getUTCDate() + 7); }
    }

    return Object.values(byWeek).sort((a, b) => a.date.localeCompare(b.date));
  }, [gDailyQ.data, mDailyQ.data, mdLeadsQ.data, sdLeadsQ.data, queryParams]);

  // Returns the ISO Monday (YYYY-MM-DD) for any date string
  function weekStart(dateStr) {
    const d = new Date(dateStr + 'T12:00:00Z');
    const day = d.getUTCDay(); // 0=Sun
    const diff = (day === 0 ? -6 : 1 - day);
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().split('T')[0];
  }

  // Depot combo chart data — leads by depot + Google Ads spend, aggregated weekly
  // Spend comes from gDailyQ (has GA4 fallback when Ads API creds not set).
  // If Ads API IS configured, depotSpendQ gives per-depot totals; use that total instead.
  const depotChartData = React.useMemo(() => {
    const gDepotRows = Array.isArray(depotSpendQ.data)     ? depotSpendQ.data     : [];
    const mDepotRows = Array.isArray(metaDepotSpendQ.data) ? metaDepotSpendQ.data : [];
    const ga4Rows    = toArr(gDailyQ.data);
    const metaRows   = toArr(mDailyQ.data);

    // ── Per-day spend maps ─────────────────────────────────────────────────────
    // Google: depot-level rows supersede GA4 total when available
    const gTotalByDate = {};
    const gDepotByDate = {};
    for (const r of ga4Rows)    gTotalByDate[r.date] = r.spendNzd || 0;
    for (const r of gDepotRows) { gTotalByDate[r.date] = r.total || 0; gDepotByDate[r.date] = r; }

    // Meta: depot-level rows supersede Meta total when adsets are named regionally
    const mTotalByDate = {};
    const mDepotByDate = {};
    for (const r of metaRows)   mTotalByDate[r.date] = r.spendNzd || 0;
    for (const r of mDepotRows) { mDepotByDate[r.date] = r; }

    // ── Aggregate into weeks ───────────────────────────────────────────────────
    // spendByWeek holds { total, Nelson, 'West Coast', 'Central Otago', 'Kawarau Gorge' }
    const spendByWeek = {};
    const ensureWeekSpend = wk => {
      if (!spendByWeek[wk]) {
        spendByWeek[wk] = { total: 0, Nelson: 0, 'West Coast': 0, 'Central Otago': 0, 'Kawarau Gorge': 0, General: 0 };
      }
    };

    const allDates = new Set([
      ...Object.keys(gTotalByDate), ...Object.keys(mTotalByDate),
      ...Object.keys(gDepotByDate), ...Object.keys(mDepotByDate),
    ]);

    for (const date of allDates) {
      const wk = weekStart(date);
      ensureWeekSpend(wk);
      // Total = Google total + Meta total (both platforms)
      spendByWeek[wk].total += (gTotalByDate[date] || 0) + (mTotalByDate[date] || 0);
      // Per-depot: sum Google regional + Meta regional where available
      for (const depot of ['Nelson', 'West Coast', 'Central Otago', 'Kawarau Gorge', 'General']) {
        spendByWeek[wk][depot] += (gDepotByDate[date]?.[depot] || 0) + (mDepotByDate[date]?.[depot] || 0);
      }
    }

    // Aggregate leads into weeks — include both multi-day and single-day so
    // the chart has data regardless of which product type dominates the period.
    const byWeek = {};
    const allDeals = [...(mdLeadsQ.data?.deals || []), ...(sdLeadsQ.data?.deals || [])];
    for (const d of allDeals) {
      const date = d.createdate?.split('T')[0];
      if (!date) continue;
      const wk = weekStart(date);
      if (!byWeek[wk]) {
        byWeek[wk] = { date: wk, totalLeads: 0 };
        for (const dep of DEPOTS) byWeek[wk][dep] = 0;
      }
      const regions = d.regions?.length ? d.regions : [];
      if (regions.length === 0) { byWeek[wk].totalLeads++; continue; }
      for (const region of regions) {
        if (DEPOTS.includes(region)) byWeek[wk][region]++;
        byWeek[wk].totalLeads++;
      }
    }

    const allWeeks = new Set([...Object.keys(byWeek), ...Object.keys(spendByWeek)]);
    return Array.from(allWeeks).sort().map(wk => {
      const leads     = byWeek[wk] || { date: wk, totalLeads: 0, ...Object.fromEntries(DEPOTS.map(d => [d, 0])) };
      const spendObj  = spendByWeek[wk] || { total: 0 };
      const totalSpend = spendObj.total;
      const cpl = leads.totalLeads > 0 ? totalSpend / leads.totalLeads : null;
      // Per-depot CPL (only populated once Meta adsets are named regionally)
      const depotCpl = {};
      for (const depot of ['Nelson', 'West Coast', 'Central Otago', 'Kawarau Gorge', 'General']) {
        const ds = spendObj[depot] || 0;
        const dl = leads[depot] || 0;
        depotCpl[`${depot}_cpl`] = dl > 0 ? ds / dl : null;
        depotCpl[`${depot}_spend`] = ds;
      }
      return { ...leads, totalSpend, cpl, ...depotCpl };
    });
  }, [mdLeadsQ.data, sdLeadsQ.data, depotSpendQ.data, metaDepotSpendQ.data, gDailyQ.data, mDailyQ.data]);

  // Multi-Day Revenue by month confirmed (closedate) — for deals whose start_date
  // falls within the selected period, grouped by when the booking was confirmed.
  const mdRevenueByMonthConfirmed = React.useMemo(() => {
    const byMonth = {};
    for (const d of mdActualQ.data?.deals || []) {
      if (!d.closedate || !d.amount) continue;
      const month = d.closedate.substring(0, 7); // YYYY-MM
      if (!byMonth[month]) byMonth[month] = { month, revenue: 0, count: 0 };
      byMonth[month].revenue += d.amount;
      byMonth[month].count++;
    }
    return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
  }, [mdActualQ.data]);

  // Combined monthly chart: revenue by stream (Xero) + ad spend (Google + Meta daily → monthly)
  const combinedMonthlyData = React.useMemo(() => {
    const d = xeroMonthlyQ.data;
    if (!d?.months?.length || !queryParams.startDate || !queryParams.endDate) return [];

    // Enumerate YYYY-MM keys matching each Xero month label
    const monthKeys = [];
    let cur = new Date(queryParams.startDate + 'T12:00:00Z');
    const end = new Date(queryParams.endDate + 'T12:00:00Z');
    while (cur <= end) {
      monthKeys.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}`);
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }

    // Aggregate Google + Meta daily spend by YYYY-MM
    const spendByMonth = {};
    for (const r of toArr(gDailyQ.data))  {
      const ym = r.date?.substring(0, 7);
      if (ym) spendByMonth[ym] = (spendByMonth[ym] || 0) + (r.spendNzd || 0);
    }
    for (const r of toArr(mDailyQ.data)) {
      const ym = r.date?.substring(0, 7);
      if (ym) spendByMonth[ym] = (spendByMonth[ym] || 0) + (r.spendNzd || 0);
    }

    return d.months.map((month, i) => {
      const row = { month };
      for (const [name, values] of Object.entries(d.incomeByAccount || {})) {
        const n = name.toLowerCase();
        if (n.includes('multi day') || n.includes('multi-day'))        row.multiDay = (row.multiDay || 0) + (values[i] || 0);
        else if (n.includes('day tour') || n.includes('day tours'))    row.dayTours = (row.dayTours || 0) + (values[i] || 0);
        else if (n.includes('bike') || n.includes('hire'))             row.bikeHire = (row.bikeHire || 0) + (values[i] || 0);
        else if (n.includes('ferry'))                                  row.ferry    = (row.ferry    || 0) + (values[i] || 0);
        else                                                           row.other    = (row.other    || 0) + (values[i] || 0);
      }
      row.adSpend = spendByMonth[monthKeys[i]] || 0;
      return row;
    });
  }, [xeroMonthlyQ.data, gDailyQ.data, mDailyQ.data, queryParams]);

  // Three states: explicitly not-configured (backend says so), loading/error (don't hide), or ready
  const xeroNotConfigured = xeroPnlQ.data?.configured === false;
  const xeroConfigured    = !xeroNotConfigured && (xeroPnlQ.data != null || xeroPnlQ.isLoading);

  const loading = summaryQ.isLoading;

  function kv(key) {
    return kpis?.[key];
  }

  return (
    <div className="p-6 space-y-6">
      {/* Data quality callout suppressed — unattributed deals are tagged 'General' */}

      {/* ── Section 1: Recognised Revenue (Xero) ────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          Recognised Revenue <span className="normal-case font-normal text-gray-600">(Xero · accrual)</span>
        </h2>
        {xeroNotConfigured ? (
          <div className="card text-sm text-gray-500 py-4">
            Xero not connected — run <code className="bg-gray-800 px-1 rounded">node scripts/xero-auth.js</code> to set up credentials.
          </div>
        ) : (() => {
          const accs    = xeroPnlQ.data?.incomeAccounts || [];
          const sum     = (fn) => accs.filter(fn).reduce((s, a) => s + a.value, 0) || null;
          const mdXero  = sum(a => a.name.toLowerCase().includes('multi'));
          const sdXero  = sum(a => a.name.toLowerCase().includes('day tour'));
          const bikeX   = sum(a => a.name.toLowerCase().includes('bike'));
          const ferryX  = sum(a => a.name.toLowerCase().includes('ferry'));
          const knownX  = (mdXero||0) + (sdXero||0) + (bikeX||0) + (ferryX||0);
          const otherX  = xeroPnlQ.data?.summary?.income ? xeroPnlQ.data.summary.income - knownX : null;
          return (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <KpiCard label="Total Revenue"  value={xeroPnlQ.data?.summary?.income} format="currency" loading={xeroPnlQ.isLoading} subtitle="Xero total income" />
              <KpiCard label="MD Tour Revenue" value={mdXero}  format="currency" loading={xeroPnlQ.isLoading} subtitle="Package Tour Income — Multi Day" />
              <KpiCard label="SD Tour Revenue" value={sdXero}  format="currency" loading={xeroPnlQ.isLoading} subtitle="Package Tour Income — Day Tours" />
              <KpiCard label="Bike Hire"       value={bikeX}   format="currency" loading={xeroPnlQ.isLoading} subtitle="Bike &amp; Accessory Hire" />
              <KpiCard label="Ferry Income"    value={ferryX}  format="currency" loading={xeroPnlQ.isLoading} subtitle="Ferry Ticket Sales &amp; TDC Tender" />
              <KpiCard label="Other Income"    value={otherX && otherX > 0.5 ? otherX : null} format="currency" loading={xeroPnlQ.isLoading} subtitle="Transport, Shop, Workshop, etc." />
            </div>
          );
        })()}
      </div>

      {/* ── Revenue by Cost Centre (stacked bar) ────────────────────────── */}
      {xeroConfigured && (
        <div className="card">
          <h3 className="text-sm font-medium text-gray-400 mb-1">
            Revenue by Cost Centre
            {xeroCcQ.data && (
              <span className="ml-2 text-xs text-gray-600 font-normal">
                ({xeroCcQ.data.granularity === 'weekly' ? 'weekly' : 'monthly'})
              </span>
            )}
          </h3>
          {xeroCcQ.isLoading ? (
            <div className="h-56 flex items-center justify-center text-gray-600 text-sm">Loading…</div>
          ) : !xeroCcQ.data?.periods?.length ? (
            <div className="h-56 flex items-center justify-center text-gray-600 text-sm">
              Select a date range to see cost centre breakdown
            </div>
          ) : (() => {
            const { periods, data } = xeroCcQ.data;
            const centres = Object.keys(COST_CENTRE_COLORS);
            const chartData = periods.map((period, i) => {
              const row = { period };
              for (const c of centres) row[c] = data[c]?.[i] ?? 0;
              return row;
            });
            return (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="period" tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <YAxis tickFormatter={v => `$${v >= 1000 ? (v/1000).toFixed(0)+'k' : v}`} tick={{ fill: '#6b7280', fontSize: 11 }} width={52} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 6 }}
                    labelStyle={{ color: '#e5e7eb', marginBottom: 4 }}
                    formatter={(v, name) => [`$${v.toLocaleString('en-NZ', { maximumFractionDigits: 0 })}`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
                  {centres.map(c => (
                    <Bar key={c} dataKey={c} stackId="rev" fill={COST_CENTRE_COLORS[c]} radius={centres.indexOf(c) === centres.length - 1 ? [3,3,0,0] : [0,0,0,0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            );
          })()}
        </div>
      )}

      {/* ── Section 2: Sales & Marketing Performance ─────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Sales &amp; Marketing Performance</h2>
        {summaryQ.isError ? (
          <ErrorWidget message={summaryQ.error?.message} onRetry={() => summaryQ.refetch()} />
        ) : (() => {
          const accs   = xeroPnlQ.data?.incomeAccounts || [];
          const bikeX  = accs.filter(a => a.name.toLowerCase().includes('bike')).reduce((s, a) => s + a.value, 0) || null;
          const sdRev  = ((sdClosedQ.data?.totalRevenue || 0) + (rezdyQ.data?.revenueNzd || 0)) || null;
          return (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard label="Total Ad Spend"          value={kv('totalAdSpendNzd')?.current}  delta={kv('totalAdSpendNzd')?.delta}  deltaPercent={kv('totalAdSpendNzd')?.deltaPercent}  format="currency" invertPositive loading={loading} subtitle="Google + Meta" />
              <KpiCard label="Total Enquiries"             value={kv('totalLeads')?.current}       delta={kv('totalLeads')?.delta}       deltaPercent={kv('totalLeads')?.deltaPercent}       format="number"   loading={loading} subtitle="HubSpot MD + SD enquiries" />
              <KpiCard label="Bookings Confirmed"      value={kv('totalClosedWon')?.current}   delta={kv('totalClosedWon')?.delta}   deltaPercent={kv('totalClosedWon')?.deltaPercent}   format="number"   loading={loading} subtitle="HubSpot · by confirmed date" />
              <KpiCard label="$/Enquiry"               value={kv('cpl')?.current}              delta={kv('cpl')?.delta}              deltaPercent={kv('cpl')?.deltaPercent}              format="currency" invertPositive loading={loading} subtitle="Ad spend ÷ total enquiries" />
              <KpiCard label="Rezdy Bookings"          value={rezdyQ.data?.total}              format="number"   loading={rezdyQ.isLoading}    subtitle="GA4 purchase events" />
              <KpiCard label="MD Revenue Confirmed"    value={mdClosedQ.data?.totalRevenue}    format="currency" loading={mdClosedQ.isLoading}  subtitle="HubSpot ops pipeline · by close date" />
              <KpiCard label="Single Day Revenue"      value={sdRev}                           format="currency" loading={sdClosedQ.isLoading || rezdyQ.isLoading} subtitle="HubSpot SD confirmed + Rezdy" />
              <KpiCard label="Bike Hire Revenue"       value={bikeX}                           format="currency" loading={xeroPnlQ.isLoading}   subtitle="Xero · Bike &amp; Accessory Hire" />
            </div>
          );
        })()}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Leads over time */}
        <div className="card">
          <h3 className="text-sm font-medium text-gray-400 mb-4">Enquiries Over Time</h3>
          {leadsChartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={leadsChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} />
                <Tooltip labelFormatter={fmtDate} contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
                <Line type="monotone" dataKey="multiDay"  name="Multi Day"  stroke={COLORS.multiDay}  dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="singleDay" name="Single Day" stroke={COLORS.singleDay} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Ad Spend vs Leads */}
        <div className="card">
          <h3 className="text-sm font-medium text-gray-400 mb-4">Ad Spend vs Enquiries (NZD)</h3>
          {spendChartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={spendChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="left"  tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(0)}`} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} />
                <Tooltip labelFormatter={fmtDate} formatter={(v, name) => name === 'Enquiries' ? [v, name] : [fmtNzd(v), name]} contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
                <Bar yAxisId="left" dataKey="google" name="Google Ads" fill={COLORS.google} stackId="spend" />
                <Bar yAxisId="left" dataKey="meta"   name="Meta Ads"   fill={COLORS.meta}   stackId="spend" />
                <Line yAxisId="right" type="monotone" dataKey="leads" name="Enquiries" stroke="#a78bfa" dot={false} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Revenue over time */}
        <div className="card lg:col-span-2">
          <h3 className="text-sm font-medium text-gray-400 mb-4">Revenue Over Time (NZD)</h3>
          {revenueChartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={revenueChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <Tooltip labelFormatter={fmtDate} formatter={v => fmtNzd(v)} contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
                <Bar dataKey="multiDay"  name="Multi-Day"   fill={COLORS.multiDay}  stackId="rev" radius={[0,0,0,0]} />
                <Bar dataKey="singleDay" name="Single-Day"  fill={COLORS.rezdy}     stackId="rev" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="mt-2 text-xs text-gray-600 italic">Accrual basis — anchored to tour start date. Matches Actual Results section. Multi-day with future start dates (next season) will not appear in current period.</p>
        </div>

        {/* Multi-Day Revenue by Month Confirmed */}
        <div className="card lg:col-span-2">
          <h3 className="text-sm font-medium text-gray-400 mb-4">Multi-Day Revenue by Month Confirmed (NZD)</h3>
          {mdActualQ.isLoading ? (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">Loading…</div>
          ) : mdRevenueByMonthConfirmed.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={mdRevenueByMonthConfirmed}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="left" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} label={{ value: 'Bookings', angle: 90, position: 'insideRight', fill: '#6b7280', fontSize: 11 }} />
                <Tooltip
                  labelFormatter={fmtMonth}
                  formatter={(v, name) => name === 'Bookings' ? [v, name] : [fmtNzd(v), name]}
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
                <Bar yAxisId="left" dataKey="revenue" name="Revenue (NZD)" fill={COLORS.multiDay} radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="count" name="Bookings" stroke="#a78bfa" dot={{ r: 3, fill: '#a78bfa' }} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
          <p className="mt-2 text-xs text-gray-600 italic">Grouped by confirmation date (closedate) for multi-day deals with tour start dates in the selected period. Bars = revenue; line = number of bookings.</p>
        </div>

        {/* Leads by depot + Ad Spend */}
        <div className="card lg:col-span-2">
          <h3 className="text-sm font-medium text-gray-400 mb-4">Enquiries by Depot &amp; Ad Spend (NZD)</h3>
          {depotChartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={depotChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="left"  tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} label={{ value: 'Enquiries', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(0)}`} tick={{ fill: '#6b7280', fontSize: 11 }} label={{ value: 'Spend (NZD)', angle: 90, position: 'insideRight', fill: '#6b7280', fontSize: 11 }} />
                <Tooltip
                  labelFormatter={fmtDate}
                  formatter={(v, name) => name === 'Ad Spend' ? fmtNzd(v) : v}
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
                {DEPOTS.map(depot => (
                  <Bar key={depot} yAxisId="left" dataKey={depot} stackId="leads" fill={DEPOT_COLORS[depot]} name={depot} />
                ))}
                <Line yAxisId="right" type="monotone" dataKey="totalSpend" name="Ad Spend" stroke="#a78bfa" dot={false} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Leads by depot + $/Lead */}
        <div className="card lg:col-span-2">
          <h3 className="text-sm font-medium text-gray-400 mb-4">Enquiries by Depot &amp; Cost Per Enquiry (NZD)</h3>
          {depotChartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={depotChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="left"  tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} label={{ value: 'Enquiries', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={v => `$${v.toFixed(0)}`} tick={{ fill: '#6b7280', fontSize: 11 }} label={{ value: '$/Enquiry', angle: 90, position: 'insideRight', fill: '#6b7280', fontSize: 11 }} />
                <Tooltip
                  labelFormatter={fmtDate}
                  formatter={(v, name) => name === '$/Enquiry' ? fmtNzd(v) : v}
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
                {DEPOTS.map(depot => (
                  <Bar key={depot} yAxisId="left" dataKey={depot} stackId="leads" fill={DEPOT_COLORS[depot]} name={depot} />
                ))}
                <Line yAxisId="right" type="monotone" dataKey="cpl" name="$/Enquiry" stroke="#f43f5e" dot={false} strokeWidth={2} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Revenue by stream vs Ad Spend (monthly) */}
      {!xeroNotConfigured && (
        <div className="card">
          <h3 className="text-sm font-medium text-gray-400 mb-4">Monthly Revenue by Stream vs Ad Spend (NZD)</h3>
          {xeroMonthlyQ.isLoading ? (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">Loading…</div>
          ) : combinedMonthlyData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={combinedMonthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="left" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: '#6b7280', fontSize: 11 }} label={{ value: 'Ad Spend', angle: 90, position: 'insideRight', fill: '#6b7280', fontSize: 10 }} />
                <Tooltip
                  labelFormatter={fmtMonth}
                  formatter={(v, name) => [fmtNzd(v), name]}
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
                <Bar yAxisId="left" dataKey="multiDay" name="Multi-Day Tours"  fill={COLORS.multiDay}   stackId="rev" />
                <Bar yAxisId="left" dataKey="dayTours" name="Day Tours"        fill={COLORS.singleDay}  stackId="rev" />
                <Bar yAxisId="left" dataKey="bikeHire" name="Bike &amp; Hire"  fill={COLORS.bikeRental} stackId="rev" />
                <Bar yAxisId="left" dataKey="ferry"    name="Ferry"            fill={COLORS.revenue}    stackId="rev" />
                <Bar yAxisId="left" dataKey="other"    name="Other"            fill="#6b7280"           stackId="rev" />
                <Line yAxisId="right" type="monotone" dataKey="adSpend" name="Ad Spend" stroke="#f43f5e" dot={{ r: 3, fill: '#f43f5e' }} strokeWidth={2} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          )}
          <p className="mt-2 text-xs text-gray-600 italic">
            Left axis: Xero accrual revenue by stream (whole-of-business — Xero cannot filter by region).
            Right axis: {queryParams.region ? `${queryParams.region} ad spend only.` : 'total Google + Meta ad spend.'}
          </p>
        </div>
      )}

      {/* Data source sync timestamps */}
      <div className="flex flex-wrap gap-4 pt-2">
        {['hubspot', 'google_ads', 'meta', 'ga4', 'xero'].map(src => (
          <SyncBadge key={src} source={src.replace('_', ' ')} timestamp={sync[src]} />
        ))}
      </div>

      {/* Multi-region note */}
      {dq?.multiRegionNote && (
        <p className="text-xs text-gray-600 italic">{dq.multiRegionNote}</p>
      )}
    </div>
  );
}
