import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '../context/FilterContext';
import {
  fetchSummary, fetchGoogleDaily, fetchMetaDaily, fetchMetaDepotDaily,
  fetchMdLeads, fetchSdLeads, fetchMdClosed, fetchSdClosed,
  fetchMdActual, fetchSdActual, fetchGa4RezdyRev, fetchGa4BikeRental,
  fetchGoogleDepotDaily, fetchXeroPnl, fetchXeroMonthly, fetchXeroIncomeByPeriod, fetchMdFunnel, fetchMdBookedRevenue,
  fetchGa4Daily,
} from '../api';
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

function toArr(v) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.daily)) return v.daily;
  return [];
}

function weekStart(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0];
}

export default function SalesMarketing() {
  const { queryParams } = useFilters();

  const summaryQ       = useQuery({ queryKey: ['summary',          queryParams], queryFn: () => fetchSummary(queryParams) });
  const gDailyQ        = useQuery({ queryKey: ['googleDaily',      queryParams], queryFn: () => fetchGoogleDaily(queryParams) });
  const mDailyQ        = useQuery({ queryKey: ['metaDaily',        queryParams], queryFn: () => fetchMetaDaily(queryParams) });
  const mdLeadsQ       = useQuery({ queryKey: ['mdLeads',          queryParams], queryFn: () => fetchMdLeads(queryParams) });
  const sdLeadsQ       = useQuery({ queryKey: ['sdLeads',          queryParams], queryFn: () => fetchSdLeads(queryParams) });
  const mdClosedQ      = useQuery({ queryKey: ['mdClosed',         queryParams], queryFn: () => fetchMdClosed(queryParams) });
  const sdClosedQ      = useQuery({ queryKey: ['sdClosed',         queryParams], queryFn: () => fetchSdClosed(queryParams) });
  const rezdyQ         = useQuery({ queryKey: ['rezdyRev',         queryParams], queryFn: () => fetchGa4RezdyRev(queryParams) });
  const brmQ           = useQuery({ queryKey: ['brmConv',          queryParams], queryFn: () => fetchGa4BikeRental(queryParams) });
  const mdActualQ      = useQuery({ queryKey: ['mdActual',         queryParams], queryFn: () => fetchMdActual(queryParams) });
  const sdActualQ      = useQuery({ queryKey: ['sdActual',         queryParams], queryFn: () => fetchSdActual(queryParams) });
  const depotSpendQ    = useQuery({ queryKey: ['depotDailySpend',  queryParams], queryFn: () => fetchGoogleDepotDaily(queryParams) });
  const metaDepotSpendQ = useQuery({ queryKey: ['metaDepotDailySpend', queryParams], queryFn: () => fetchMetaDepotDaily(queryParams) });
  const xeroPnlQ       = useQuery({ queryKey: ['xeroPnl',         queryParams], queryFn: () => fetchXeroPnl(queryParams),      retry: 1 });
  const xeroMonthlyQ   = useQuery({ queryKey: ['xeroMonthly',     queryParams], queryFn: () => fetchXeroMonthly(queryParams),  retry: 1 });
  const mdFunnelQ          = useQuery({ queryKey: ['mdFunnel',          queryParams], queryFn: () => fetchMdFunnel(queryParams) });
  const mdBookedRevQ       = useQuery({ queryKey: ['mdBookedRev',       queryParams], queryFn: () => fetchMdBookedRevenue(queryParams) });
  const ga4DailyQ          = useQuery({ queryKey: ['ga4Daily',          queryParams], queryFn: () => fetchGa4Daily(queryParams) });
  const xeroIncomeByPeriodQ = useQuery({ queryKey: ['xeroIncomeByPeriod', queryParams], queryFn: () => fetchXeroIncomeByPeriod(queryParams), retry: 1,
    enabled: !!(queryParams.startDate && queryParams.endDate) });

  const kpis = summaryQ.data?.kpis;
  const sync = summaryQ.data?.syncTimestamps || {};
  const xeroNotConfigured = xeroPnlQ.data?.configured === false;

  function kv(key) { return kpis?.[key]; }

  // Leads over time
  const leadsChartData = React.useMemo(() => {
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

  // Ad Spend vs Leads — weekly
  const spendChartData = React.useMemo(() => {
    const googleArr = toArr(gDailyQ.data);
    const metaArr   = toArr(mDailyQ.data);
    const byWeek = {};
    const ensure = wk => { if (!byWeek[wk]) byWeek[wk] = { date: wk, google: 0, meta: 0, leads: 0 }; };

    for (const r of googleArr) { const wk = weekStart(r.date); ensure(wk); byWeek[wk].google += r.spendNzd || 0; }
    for (const r of metaArr)   { const wk = weekStart(r.date); ensure(wk); byWeek[wk].meta   += r.spendNzd || 0; }

    for (const d of [...(mdLeadsQ.data?.deals || []), ...(sdLeadsQ.data?.deals || [])]) {
      const date = d.createdate?.split('T')[0];
      if (!date) continue;
      const wk = weekStart(date);
      ensure(wk);
      byWeek[wk].leads++;
    }

    if (queryParams.startDate && queryParams.endDate) {
      let cur = new Date(queryParams.startDate + 'T12:00:00Z');
      const end = new Date(queryParams.endDate + 'T12:00:00Z');
      while (cur <= end) { ensure(weekStart(cur.toISOString().split('T')[0])); cur.setUTCDate(cur.getUTCDate() + 7); }
    }

    return Object.values(byWeek).sort((a, b) => a.date.localeCompare(b.date));
  }, [gDailyQ.data, mDailyQ.data, mdLeadsQ.data, sdLeadsQ.data, queryParams]);

  // Depot combo chart
  const depotChartData = React.useMemo(() => {
    const gDepotRows = Array.isArray(depotSpendQ.data)     ? depotSpendQ.data     : [];
    const mDepotRows = Array.isArray(metaDepotSpendQ.data) ? metaDepotSpendQ.data : [];
    const ga4Rows    = toArr(gDailyQ.data);
    const metaRows   = toArr(mDailyQ.data);

    const gTotalByDate = {};
    const gDepotByDate = {};
    const mTotalByDate = {};
    const mDepotByDate = {};
    for (const r of ga4Rows)    gTotalByDate[r.date] = r.spendNzd || 0;
    for (const r of gDepotRows) { gTotalByDate[r.date] = r.total || 0; gDepotByDate[r.date] = r; }
    for (const r of metaRows)   mTotalByDate[r.date] = r.spendNzd || 0;
    for (const r of mDepotRows) { mDepotByDate[r.date] = r; }

    const spendByWeek = {};
    const ensureWeekSpend = wk => {
      if (!spendByWeek[wk]) spendByWeek[wk] = { total: 0, Nelson: 0, 'West Coast': 0, 'Central Otago': 0, 'Kawarau Gorge': 0, General: 0 };
    };

    const allDates = new Set([
      ...Object.keys(gTotalByDate), ...Object.keys(mTotalByDate),
      ...Object.keys(gDepotByDate), ...Object.keys(mDepotByDate),
    ]);

    for (const date of allDates) {
      const wk = weekStart(date);
      ensureWeekSpend(wk);
      spendByWeek[wk].total += (gTotalByDate[date] || 0) + (mTotalByDate[date] || 0);
      for (const depot of DEPOTS) {
        spendByWeek[wk][depot] += (gDepotByDate[date]?.[depot] || 0) + (mDepotByDate[date]?.[depot] || 0);
      }
    }

    const byWeek = {};
    for (const d of [...(mdLeadsQ.data?.deals || []), ...(sdLeadsQ.data?.deals || [])]) {
      const date = d.createdate?.split('T')[0];
      if (!date) continue;
      const wk = weekStart(date);
      if (!byWeek[wk]) { byWeek[wk] = { date: wk, totalLeads: 0 }; for (const dep of DEPOTS) byWeek[wk][dep] = 0; }
      const regions = d.regions?.length ? d.regions : [];
      if (regions.length === 0) { byWeek[wk].totalLeads++; continue; }
      for (const region of regions) {
        if (DEPOTS.includes(region)) byWeek[wk][region]++;
        byWeek[wk].totalLeads++;
      }
    }

    const allWeeks = new Set([...Object.keys(byWeek), ...Object.keys(spendByWeek)]);
    return Array.from(allWeeks).sort().map(wk => {
      const leads    = byWeek[wk] || { date: wk, totalLeads: 0, ...Object.fromEntries(DEPOTS.map(d => [d, 0])) };
      const spendObj = spendByWeek[wk] || { total: 0 };
      const totalSpend = spendObj.total;
      const cpl = leads.totalLeads > 0 ? totalSpend / leads.totalLeads : null;
      const depotCpl = {};
      for (const depot of DEPOTS) {
        const ds = spendObj[depot] || 0;
        const dl = leads[depot] || 0;
        depotCpl[`${depot}_cpl`]   = dl > 0 ? ds / dl : null;
        depotCpl[`${depot}_spend`] = ds;
      }
      return { ...leads, totalSpend, cpl, ...depotCpl };
    });
  }, [mdLeadsQ.data, sdLeadsQ.data, depotSpendQ.data, metaDepotSpendQ.data, gDailyQ.data, mDailyQ.data]);

  // Multi-Day Revenue by month booked
  // Source: mdBookedRevQ — ops pipeline deals filtered by createdate (deposit received date).
  // createdate of ops deal = when the booking was confirmed (deposit received), NOT tour start date.
  // Only shows months within the selected date range; gaps filled with zero.
  const mdRevenueByMonthConfirmed = React.useMemo(() => {
    const byMonth = {};

    // Seed every month in the selected range so x-axis is complete with no gaps
    if (queryParams.startDate && queryParams.endDate) {
      let cur = new Date(queryParams.startDate + 'T12:00:00Z');
      const end = new Date(queryParams.endDate + 'T12:00:00Z');
      while (cur <= end) {
        const ym = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}`;
        byMonth[ym] = { month: ym, revenue: 0, count: 0 };
        cur.setUTCMonth(cur.getUTCMonth() + 1);
      }
    }

    for (const d of mdBookedRevQ.data?.deals || []) {
      if (!d.bookedDate || !d.amount) continue;
      const month = d.bookedDate.substring(0, 7); // YYYY-MM of booking/deposit date
      if (!byMonth[month]) byMonth[month] = { month, revenue: 0, count: 0 };
      byMonth[month].revenue += d.amount;
      byMonth[month].count++;
    }

    return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
  }, [mdBookedRevQ.data, queryParams.startDate, queryParams.endDate]);

  // Revenue by stream vs ad spend — weekly or monthly to match xeroIncomeByPeriod granularity
  const combinedMonthlyData = React.useMemo(() => {
    const d = xeroIncomeByPeriodQ.data;
    if (!d?.periods?.length) return [];

    // Build daily ad spend lookup keyed by YYYY-MM-DD
    const spendByDay = {};
    for (const r of toArr(gDailyQ.data)) {
      if (r.date) spendByDay[r.date] = (spendByDay[r.date] || 0) + (r.spendNzd || 0);
    }
    for (const r of toArr(mDailyQ.data)) {
      if (r.date) spendByDay[r.date] = (spendByDay[r.date] || 0) + (r.spendNzd || 0);
    }

    // Sum ad spend for each Xero period using the from/to dates returned by the backend
    return d.periods.map((period, i) => {
      const row = { period };
      for (const [name, values] of Object.entries(d.incomeByAccount || {})) {
        const n = name.toLowerCase();
        if      (n.includes('multi day') || n.includes('multi-day'))    row.multiDay = (row.multiDay || 0) + (values[i] || 0);
        else if (n.includes('day tour')  || n.includes('day tours'))    row.dayTours = (row.dayTours || 0) + (values[i] || 0);
        else if (n.includes('bike')      || n.includes('hire'))         row.bikeHire = (row.bikeHire || 0) + (values[i] || 0);
        else if (n.includes('ferry'))                                    row.ferry    = (row.ferry    || 0) + (values[i] || 0);
        else                                                             row.other    = (row.other    || 0) + (values[i] || 0);
      }
      // Accumulate all daily spend within this period's date range
      const from = d.periodFrom?.[i];
      const to   = d.periodTo?.[i];
      let adSpend = 0;
      if (from && to) {
        let cur = new Date(from + 'T12:00:00Z');
        const end = new Date(to + 'T12:00:00Z');
        while (cur <= end) {
          const key = cur.toISOString().split('T')[0];
          adSpend += spendByDay[key] || 0;
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      }
      row.adSpend = adSpend;
      return row;
    });
  }, [xeroIncomeByPeriodQ.data, gDailyQ.data, mDailyQ.data]);

  // Web visits by week (sum all channels from GA4 daily sessions)
  const ga4SessionsByWeek = React.useMemo(() => {
    const byWeek = {};
    const rows = Array.isArray(ga4DailyQ.data) ? ga4DailyQ.data : [];
    for (const r of rows) {
      // date is YYYYMMDD from GA4
      const raw = r.date;
      const iso = raw.length === 8
        ? `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`
        : raw;
      const wk = weekStart(iso);
      byWeek[wk] = (byWeek[wk] || 0) + (r.sessions || 0);
    }
    return byWeek;
  }, [ga4DailyQ.data]);

  // Web visits vs Ad Spend (weekly)
  const webVisitsVsSpendData = React.useMemo(() => {
    const byWeek = {};
    const ensure = wk => { if (!byWeek[wk]) byWeek[wk] = { date: wk, sessions: 0, google: 0, meta: 0 }; };
    for (const r of toArr(gDailyQ.data)) { const wk = weekStart(r.date); ensure(wk); byWeek[wk].google += r.spendNzd || 0; }
    for (const r of toArr(mDailyQ.data)) { const wk = weekStart(r.date); ensure(wk); byWeek[wk].meta   += r.spendNzd || 0; }
    for (const [wk, sessions] of Object.entries(ga4SessionsByWeek)) { ensure(wk); byWeek[wk].sessions = sessions; }
    return Object.values(byWeek).sort((a, b) => a.date.localeCompare(b.date));
  }, [gDailyQ.data, mDailyQ.data, ga4SessionsByWeek]);

  // Web visits vs Enquiries (weekly)
  const webVisitsVsEnquiriesData = React.useMemo(() => {
    const byWeek = {};
    const ensure = wk => { if (!byWeek[wk]) byWeek[wk] = { date: wk, sessions: 0, enquiries: 0 }; };
    for (const [wk, sessions] of Object.entries(ga4SessionsByWeek)) { ensure(wk); byWeek[wk].sessions = sessions; }
    for (const d of [...(mdLeadsQ.data?.deals || []), ...(sdLeadsQ.data?.deals || [])]) {
      const date = d.createdate?.split('T')[0];
      if (!date) continue;
      const wk = weekStart(date);
      ensure(wk);
      byWeek[wk].enquiries++;
    }
    return Object.values(byWeek).sort((a, b) => a.date.localeCompare(b.date));
  }, [ga4SessionsByWeek, mdLeadsQ.data, sdLeadsQ.data]);

  return (
    <div className="p-6 space-y-6">

      {/* ── Sales & Marketing Performance KPIs ──────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          Sales &amp; Marketing Performance
        </h2>
        {summaryQ.isError ? (
          <ErrorWidget message={summaryQ.error?.message} onRetry={() => summaryQ.refetch()} />
        ) : (() => {
          const accs  = xeroPnlQ.data?.incomeAccounts || [];
          const bikeX = accs.filter(a => a.name.toLowerCase().includes('bike')).reduce((s, a) => s + a.value, 0) || null;
          const sdRev = ((sdClosedQ.data?.totalRevenue || 0) + (rezdyQ.data?.revenueNzd || 0)) || null;
          return (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard label="Total Ad Spend"       value={kv('totalAdSpendNzd')?.current}  delta={kv('totalAdSpendNzd')?.delta}  deltaPercent={kv('totalAdSpendNzd')?.deltaPercent}  format="currency" invertPositive loading={summaryQ.isLoading} subtitle="Google + Meta" />
              <KpiCard label="Total Enquiries"          value={kv('totalLeads')?.current}       delta={kv('totalLeads')?.delta}       deltaPercent={kv('totalLeads')?.deltaPercent}       format="number"   loading={summaryQ.isLoading} subtitle="HubSpot MD + SD enquiries" />
              <KpiCard label="Bookings Confirmed"   value={kv('totalClosedWon')?.current}   delta={kv('totalClosedWon')?.delta}   deltaPercent={kv('totalClosedWon')?.deltaPercent}   format="number"   loading={summaryQ.isLoading} subtitle="HubSpot · by confirmed date" />
              <KpiCard label="$/Enquiry"            value={kv('cpl')?.current}              delta={kv('cpl')?.delta}              deltaPercent={kv('cpl')?.deltaPercent}              format="currency" invertPositive loading={summaryQ.isLoading} subtitle="Ad spend ÷ total enquiries" />
              <KpiCard label="Rezdy Bookings"       value={rezdyQ.data?.total}              format="number"   loading={rezdyQ.isLoading}    subtitle="GA4 purchase events" />
              <KpiCard label="MD Revenue Confirmed" value={mdClosedQ.data?.totalRevenue}    format="currency" loading={mdClosedQ.isLoading}  subtitle="HubSpot ops pipeline · by close date" />
              <KpiCard label="Single Day Revenue"   value={sdRev}                           format="currency" loading={sdClosedQ.isLoading || rezdyQ.isLoading} subtitle="HubSpot SD confirmed + Rezdy" />
              <KpiCard label="Bike Hire Revenue"    value={bikeX}                           format="currency" loading={xeroPnlQ.isLoading}   subtitle="Xero · Bike &amp; Accessory Hire" />
            </div>
          );
        })()}
      </div>

      {/* ── MD Enquiry Conversion ────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          Multi-Day Enquiry Conversion
          <span className="normal-case font-normal text-gray-600 ml-1">(anchored by enquiry create date)</span>
        </h2>
        {(() => {
          const f = mdFunnelQ.data;
          const total      = f?.totalEnquiries ?? null;
          const closedLost = f?.closedLost      ?? null;
          // stage[5] = Deposit Received / Won (cumulative = all won + ops pipeline deals)
          const closedWon  = f?.stages?.[5]?.count ?? null;
          const inProgress = (total !== null && closedWon !== null && closedLost !== null)
            ? total - closedWon - closedLost
            : null;
          const cvr = (closedWon !== null && total > 0) ? (closedWon / total) * 100 : null;

          return (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard
                label="CVR"
                value={cvr}
                format="percent"
                loading={mdFunnelQ.isLoading}
                subtitle="Deposit Received ÷ total enquiries created"
              />
              <KpiCard
                label="In Progress"
                value={inProgress}
                format="number"
                loading={mdFunnelQ.isLoading}
                subtitle="Active enquiries not yet won or lost"
              />
              <KpiCard
                label="Closed Won"
                value={closedWon}
                format="number"
                loading={mdFunnelQ.isLoading}
                subtitle="Reached Deposit Received / Won or beyond"
              />
              <KpiCard
                label="Closed Lost"
                value={closedLost}
                format="number"
                loading={mdFunnelQ.isLoading}
                subtitle="Marked Closed Lost in HubSpot"
              />
            </div>
          );
        })()}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Ad Spend vs Leads */}
        <div className="card">
          <h3 className="text-sm font-medium text-gray-600 mb-4">Ad Spend vs Enquiries (NZD)</h3>
          {spendChartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={spendChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="left"  tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(0)}`} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} />
                <Tooltip labelFormatter={fmtDate} formatter={(v, name) => name === 'Enquiries' ? [v, name] : [fmtNzd(v), name]} contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
                <Bar yAxisId="left" dataKey="google" name="Google Ads" fill={COLORS.google} stackId="spend" />
                <Bar yAxisId="left" dataKey="meta"   name="Meta Ads"   fill={COLORS.meta}   stackId="spend" />
                <Line yAxisId="right" type="monotone" dataKey="leads" name="Enquiries" stroke="#a78bfa" dot={false} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Leads over time */}
        <div className="card">
          <h3 className="text-sm font-medium text-gray-600 mb-4">Enquiries Over Time</h3>
          {leadsChartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={leadsChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} />
                <Tooltip labelFormatter={fmtDate} contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
                <Line type="monotone" dataKey="multiDay"  name="Multi Day"  stroke={COLORS.multiDay}  dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="singleDay" name="Single Day" stroke={COLORS.singleDay} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Web Visits vs Ad Spend */}
        <div className="card">
          <h3 className="text-sm font-medium text-gray-600 mb-4">Web Visits vs Ad Spend (NZD · weekly)</h3>
          {webVisitsVsSpendData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={webVisitsVsSpendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="left"  tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(0)}`} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v} tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} />
                <Tooltip labelFormatter={fmtDate} formatter={(v, name) => name === 'Web Visits' ? [v.toLocaleString(), name] : [fmtNzd(v), name]} contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
                <Bar yAxisId="left" dataKey="google" name="Google Ads" fill={COLORS.google} stackId="spend" />
                <Bar yAxisId="left" dataKey="meta"   name="Meta Ads"   fill={COLORS.meta}   stackId="spend" />
                <Line yAxisId="right" type="monotone" dataKey="sessions" name="Web Visits" stroke="#22d3ee" dot={false} strokeWidth={2} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Web Visits vs Enquiries */}
        <div className="card">
          <h3 className="text-sm font-medium text-gray-600 mb-4">Web Visits vs Enquiries (weekly)</h3>
          {webVisitsVsEnquiriesData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={webVisitsVsEnquiriesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="left"  tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v} tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} />
                <Tooltip labelFormatter={fmtDate} formatter={(v, name) => [v.toLocaleString(), name]} contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
                <Bar yAxisId="right" dataKey="enquiries" name="Enquiries" fill="#a78bfa" opacity={0.8} radius={[3,3,0,0]} />
                <Line yAxisId="left" type="monotone" dataKey="sessions" name="Web Visits" stroke="#22d3ee" dot={false} strokeWidth={2} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Inquiries by Depot & Ad Spend */}
        <div className="card lg:col-span-2">
          <h3 className="text-sm font-medium text-gray-600 mb-4">Enquiries by Depot &amp; Ad Spend (NZD)</h3>
          {depotChartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={depotChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="left"  tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} label={{ value: 'Enquiries', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(0)}`} tick={{ fill: '#6b7280', fontSize: 11 }} label={{ value: 'Spend (NZD)', angle: 90, position: 'insideRight', fill: '#6b7280', fontSize: 11 }} />
                <Tooltip
                  labelFormatter={fmtDate}
                  formatter={(v, name) => name === 'Ad Spend' ? fmtNzd(v) : v}
                  contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
                {DEPOTS.map(depot => (
                  <Bar key={depot} yAxisId="left" dataKey={depot} stackId="leads" fill={DEPOT_COLORS[depot]} name={depot} />
                ))}
                <Line yAxisId="right" type="monotone" dataKey="totalSpend" name="Ad Spend" stroke="#a78bfa" dot={false} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Inquiries by Depot & $/Inquiry */}
        <div className="card lg:col-span-2">
          <h3 className="text-sm font-medium text-gray-600 mb-4">Enquiries by Depot &amp; Cost Per Enquiry (NZD)</h3>
          {depotChartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={depotChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="left"  tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} label={{ value: 'Enquiries', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={v => `$${v.toFixed(0)}`} tick={{ fill: '#6b7280', fontSize: 11 }} label={{ value: '$/Enquiry', angle: 90, position: 'insideRight', fill: '#6b7280', fontSize: 11 }} />
                <Tooltip
                  labelFormatter={fmtDate}
                  formatter={(v, name) => name === '$/Enquiry' ? fmtNzd(v) : v}
                  contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
                {DEPOTS.map(depot => (
                  <Bar key={depot} yAxisId="left" dataKey={depot} stackId="leads" fill={DEPOT_COLORS[depot]} name={depot} />
                ))}
                <Line yAxisId="right" type="monotone" dataKey="cpl" name="$/Enquiry" stroke="#f43f5e" dot={false} strokeWidth={2} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Revenue by Stream vs Ad Spend */}
        {!xeroNotConfigured && (
          <div className="card lg:col-span-2">
            <h3 className="text-sm font-medium text-gray-600 mb-4">
              Revenue by Stream vs Ad Spend (NZD)
              <span className="ml-2 text-xs text-gray-400 font-normal">
                ({xeroIncomeByPeriodQ.data?.granularity === 'weekly' ? 'weekly' : 'monthly'} · Xero accrual)
              </span>
            </h3>
            {xeroIncomeByPeriodQ.isLoading ? (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
            ) : combinedMonthlyData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Select a date range to see this chart</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={combinedMonthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="period" tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <YAxis yAxisId="left" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: '#6b7280', fontSize: 11 }} label={{ value: 'Ad Spend', angle: 90, position: 'insideRight', fill: '#6b7280', fontSize: 10 }} />
                  <Tooltip
                    formatter={(v, name) => [fmtNzd(v), name]}
                    contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
                  <Bar yAxisId="left" dataKey="multiDay" name="Multi-Day Tours"  fill={COLORS.multiDay}   stackId="rev" />
                  <Bar yAxisId="left" dataKey="dayTours" name="Day Tours"        fill={COLORS.singleDay}  stackId="rev" />
                  <Bar yAxisId="left" dataKey="bikeHire" name="Bike &amp; Hire"  fill={COLORS.bikeRental} stackId="rev" />
                  <Bar yAxisId="left" dataKey="ferry"    name="Ferry"            fill={COLORS.revenue}    stackId="rev" />
                  <Bar yAxisId="left" dataKey="other"    name="Other"            fill="#6b7280"           stackId="rev" />
                  <Line yAxisId="right" type="monotone" dataKey="adSpend" name="Ad Spend" stroke="#f43f5e" dot={{ r: 3, fill: '#f43f5e' }} strokeWidth={2} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            )}
            <p className="mt-2 text-xs text-gray-400 italic">
              Left axis: Xero accrual revenue by stream (whole-of-business).
              Right axis: {queryParams.region ? `${queryParams.region} ad spend only.` : 'total Google + Meta ad spend.'}
            </p>
          </div>
        )}

        {/* Multi-Day Revenue by Month Confirmed */}
        <div className="card lg:col-span-2">
          <h3 className="text-sm font-medium text-gray-600 mb-4">Multi-Day Revenue by Month Confirmed (NZD)</h3>
          {mdBookedRevQ.isLoading ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
          ) : mdRevenueByMonthConfirmed.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={mdRevenueByMonthConfirmed}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="left" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} label={{ value: 'Bookings', angle: 90, position: 'insideRight', fill: '#6b7280', fontSize: 11 }} />
                <Tooltip
                  labelFormatter={fmtMonth}
                  formatter={(v, name) => name === 'Bookings' ? [v, name] : [fmtNzd(v), name]}
                  contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
                <Bar yAxisId="left" dataKey="revenue" name="Revenue (NZD)" fill={COLORS.multiDay} radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="count" name="Bookings" stroke="#a78bfa" dot={{ r: 3, fill: '#a78bfa' }} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
          <p className="mt-2 text-xs text-gray-400 italic">
            Anchored to tour booked date (deposit received). Each month shows revenue from bookings made in that month, regardless of when the tour runs. Bars = revenue; line = number of bookings.
          </p>
        </div>

      </div>

      {/* Sync badges */}
      <div className="flex flex-wrap gap-4 pt-2">
        {['hubspot', 'google_ads', 'meta', 'ga4', 'xero'].map(src => (
          <SyncBadge key={src} source={src.replace('_', ' ')} timestamp={sync[src]} />
        ))}
      </div>
    </div>
  );
}
