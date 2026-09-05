import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '../context/FilterContext';
import {
  fetchSummary, fetchSdLeads, fetchSdClosed,
  fetchGa4RezdyRev, fetchGa4BikeRental, fetchGa4RezdyProducts,
  fetchGoogleTourTypeDaily, fetchMetaTourTypeDaily,
  fetchGoogleDaily, fetchMetaDaily,
  fetchXeroPnl, fetchMarketingPerformance,
} from '../api';
import KpiCard from '../components/KpiCard';
import ErrorWidget from '../components/ErrorWidget';
import {
  ComposedChart, Bar, Line,
  XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { format, parseISO } from 'date-fns';

const COLORS = {
  google:       '#ea4335',
  meta:         '#1877f2',
  enquiry:      '#a78bfa',
  rezdy:        '#22c55e',
  hsConversion: '#f59e0b',
};

const DEPOTS = ['Nelson', 'West Coast', 'Central Otago', 'Kawarau Gorge'];

function fmtDate(d) {
  try { return format(parseISO(d), 'dd MMM'); } catch { return d; }
}
function fmtNzd(v) {
  if (v === null || v === undefined) return '—';
  return `$${Number(v).toLocaleString('en-NZ', { maximumFractionDigits: 0 })}`;
}
function fmtCurrency(v, dp = 0) {
  if (v === null || v === undefined) return '—';
  return `$${Number(v).toLocaleString('en-NZ', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
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

// Bucket deals by depot from their .regions array
function bucketByDepot(deals) {
  const byDepot = {};
  for (const d of DEPOTS) byDepot[d] = 0;
  let total = 0;
  for (const deal of deals || []) {
    total++;
    for (const r of (deal.regions || [])) {
      if (byDepot[r] !== undefined) byDepot[r]++;
    }
  }
  return { total, byDepot };
}

export default function SingleDayBikeHire() {
  const { queryParams } = useFilters();
  const [trendDepot, setTrendDepot] = React.useState('All');
  const [spendMode,  setSpendMode]  = React.useState('sd'); // 'sd' | 'all'

  const summaryQ      = useQuery({ queryKey: ['summary',       queryParams], queryFn: () => fetchSummary(queryParams) });
  const sdLeadsQ      = useQuery({ queryKey: ['sdLeads',       queryParams], queryFn: () => fetchSdLeads(queryParams) });
  const sdClosedQ     = useQuery({ queryKey: ['sdClosed',      queryParams], queryFn: () => fetchSdClosed(queryParams) });
  const rezdyQ        = useQuery({ queryKey: ['rezdyRev',      queryParams], queryFn: () => fetchGa4RezdyRev(queryParams) });
  const gTourTypeQ    = useQuery({ queryKey: ['googleTourTypeDaily', queryParams], queryFn: () => fetchGoogleTourTypeDaily(queryParams) });
  const mTourTypeQ    = useQuery({ queryKey: ['metaTourTypeDaily',  queryParams], queryFn: () => fetchMetaTourTypeDaily(queryParams) });
  const gDailyQ       = useQuery({ queryKey: ['googleDaily',         queryParams], queryFn: () => fetchGoogleDaily(queryParams) });
  const mDailyQ       = useQuery({ queryKey: ['metaDaily',           queryParams], queryFn: () => fetchMetaDaily(queryParams) });
  const xeroPnlQ      = useQuery({ queryKey: ['xeroPnl',       queryParams], queryFn: () => fetchXeroPnl(queryParams), retry: 1 });
  const brmQ          = useQuery({ queryKey: ['brmConv',       queryParams], queryFn: () => fetchGa4BikeRental(queryParams) });
  const rezdyProductsQ = useQuery({ queryKey: ['rezdyProducts', queryParams], queryFn: () => fetchGa4RezdyProducts(queryParams) });
  const marketingPerfQ = useQuery({
    queryKey: ['marketingPerformance', queryParams.startDate, queryParams.endDate],
    queryFn: () => fetchMarketingPerformance({ startDate: queryParams.startDate, endDate: queryParams.endDate }),
    enabled: !!(queryParams.startDate && queryParams.endDate),
    retry: 1,
  });

  // ── Comparison label (same-time-last-year) ───────────────────────────────────
  const comparisonLabel = React.useMemo(() => {
    const p = summaryQ.data?.priorPeriodParams;
    if (!p?.startDate || !p?.endDate) return 'vs same time last year';
    const fmt = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-NZ', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    });
    return `vs ${fmt(p.startDate)} – ${fmt(p.endDate)}`;
  }, [summaryQ.data?.priorPeriodParams]);

  function kv(key) { return summaryQ.data?.kpis?.[key]; }

  const mp = marketingPerfQ.data;

  // ── Derived KPI values ───────────────────────────────────────────────────────
  const sdHubspotConversions  = sdClosedQ.data?.total ?? null;
  const rezdyConversions      = rezdyQ.data?.total ?? null;
  const bikeHireConversions   = brmQ.data?.total ?? null;
  const totalConversions      = (sdHubspotConversions ?? 0) + (rezdyConversions ?? 0) + (bikeHireConversions ?? 0);

  const sdHubspotRevenue  = sdClosedQ.data?.totalRevenue ?? 0;
  const rezdyRevenue      = rezdyQ.data?.revenueNzd ?? 0;
  const bikeHireRevenue   = (() => {
    const accs = xeroPnlQ.data?.incomeAccounts || [];
    return accs.filter(a => a.name.toLowerCase().includes('bike')).reduce((s, a) => s + a.value, 0) || null;
  })();
  const totalConfirmedRevenue = sdHubspotRevenue + rezdyRevenue + (bikeHireRevenue ?? 0) || null;

  const sdTaggedSpend = mp?.sdTaggedSpendNzd ?? null;
  // $/Conversion excludes bike hire (SD ad spend ÷ HubSpot SD + Rezdy only)
  const sdConversionsForCpc = (sdHubspotConversions ?? 0) + (rezdyConversions ?? 0);
  const costPerConversion = sdTaggedSpend !== null && sdConversionsForCpc > 0
    ? sdTaggedSpend / sdConversionsForCpc
    : null;

  // ── Depot breakdown ──────────────────────────────────────────────────────────
  const sdEnquiryByDepot  = React.useMemo(() => bucketByDepot(sdLeadsQ.data?.deals),  [sdLeadsQ.data]);
  const sdClosedByDepot   = React.useMemo(() => bucketByDepot(sdClosedQ.data?.deals), [sdClosedQ.data]);

  // ── Weekly SD-tagged spend vs SD enquiries + Rezdy chart ─────────────────────
  const weeklyChartData = React.useMemo(() => {
    const byWeek = {};
    const ensure = wk => {
      if (!byWeek[wk]) byWeek[wk] = { date: wk, google: 0, meta: 0, sdEnquiries: 0, rezdy: 0 };
    };

    // SD-tagged spend only (campaigns/adsets tagged Single Day)
    for (const r of (Array.isArray(gTourTypeQ.data) ? gTourTypeQ.data : [])) {
      const wk = weekStart(r.date); ensure(wk); byWeek[wk].google += r.SD || 0;
    }
    for (const r of (Array.isArray(mTourTypeQ.data) ? mTourTypeQ.data : [])) {
      const wk = weekStart(r.date); ensure(wk); byWeek[wk].meta += r.SD || 0;
    }

    for (const d of sdLeadsQ.data?.deals || []) {
      const date = d.createdate?.split('T')[0];
      if (!date) continue;
      const wk = weekStart(date);
      ensure(wk);
      byWeek[wk].sdEnquiries++;
    }

    for (const r of rezdyQ.data?.daily || []) {
      const wk = weekStart(r.date);
      ensure(wk);
      byWeek[wk].rezdy += r.conversions || 0;
    }

    return Object.values(byWeek).sort((a, b) => a.date.localeCompare(b.date));
  }, [gTourTypeQ.data, mTourTypeQ.data, sdLeadsQ.data, rezdyQ.data]);

  // ── Weekly trend (depot-filterable lines, spend mode toggle) ─────────────────
  const weeklyTrendData = React.useMemo(() => {
    const byWeek = {};
    const ensure = wk => {
      if (!byWeek[wk]) byWeek[wk] = { date: wk, google: 0, meta: 0, enquiries: 0, hsConversions: 0, rezdy: 0 };
    };

    // Spend — either SD-tagged or all spend depending on spendMode
    if (spendMode === 'sd') {
      for (const r of (Array.isArray(gTourTypeQ.data) ? gTourTypeQ.data : [])) {
        const wk = weekStart(r.date); ensure(wk); byWeek[wk].google += r.SD || 0;
      }
      for (const r of (Array.isArray(mTourTypeQ.data) ? mTourTypeQ.data : [])) {
        const wk = weekStart(r.date); ensure(wk); byWeek[wk].meta += r.SD || 0;
      }
    } else {
      for (const r of toArr(gDailyQ.data)) {
        const wk = weekStart(r.date); ensure(wk); byWeek[wk].google += r.spendNzd || 0;
      }
      for (const r of toArr(mDailyQ.data)) {
        const wk = weekStart(r.date); ensure(wk); byWeek[wk].meta += r.spendNzd || 0;
      }
    }

    // SD enquiries — filtered by selected depot
    for (const d of sdLeadsQ.data?.deals || []) {
      if (trendDepot !== 'All' && !d.regions?.includes(trendDepot)) continue;
      const date = d.createdate?.split('T')[0];
      if (!date) continue;
      const wk = weekStart(date); ensure(wk); byWeek[wk].enquiries++;
    }

    // SD HubSpot conversions — filtered by selected depot
    for (const d of sdClosedQ.data?.deals || []) {
      if (trendDepot !== 'All' && !d.regions?.includes(trendDepot)) continue;
      const date = (d.closedate || d.createdate)?.split('T')[0];
      if (!date) continue;
      const wk = weekStart(date); ensure(wk); byWeek[wk].hsConversions++;
    }

    // Rezdy — always total (no depot attribution)
    for (const r of rezdyQ.data?.daily || []) {
      const wk = weekStart(r.date); ensure(wk); byWeek[wk].rezdy += r.conversions || 0;
    }

    return Object.values(byWeek).sort((a, b) => a.date.localeCompare(b.date));
  }, [gTourTypeQ.data, mTourTypeQ.data, gDailyQ.data, mDailyQ.data, sdLeadsQ.data, sdClosedQ.data, rezdyQ.data, trendDepot, spendMode]);

  return (
    <div className="p-6 space-y-6">

      {/* ── KPI cards ──────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          Single Day &amp; Bike Hire
        </h2>

        {summaryQ.isError ? (
          <ErrorWidget message={summaryQ.error?.message} onRetry={() => summaryQ.refetch()} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCard
              label="SD Enquiries"
              value={kv('sdLeads')?.current}
              delta={kv('sdLeads')?.delta}
              deltaPercent={kv('sdLeads')?.deltaPercent}
              format="number"
              loading={summaryQ.isLoading}
              subtitle="HubSpot single-day pipeline"
              comparisonLabel={comparisonLabel}
            />
            <KpiCard
              label="Total Conversions"
              value={totalConversions || null}
              format="number"
              loading={sdClosedQ.isLoading || rezdyQ.isLoading || brmQ.isLoading}
              subtitle={[
                sdHubspotConversions !== null ? `${sdHubspotConversions} HubSpot` : null,
                rezdyConversions      !== null ? `${rezdyConversions} Rezdy` : null,
                bikeHireConversions   !== null ? `${bikeHireConversions} Bike Hire` : null,
              ].filter(Boolean).join(' · ')}
            />
            <KpiCard
              label="$/SD Enquiry"
              value={mp?.costPerEnquiry?.sd?.total ?? null}
              format="currency"
              invertPositive
              loading={marketingPerfQ.isLoading}
              subtitle="SD-tagged ad spend ÷ SD enquiries"
            />
            <KpiCard
              label="$/Conversion"
              value={costPerConversion}
              format="currency"
              invertPositive
              loading={marketingPerfQ.isLoading || sdClosedQ.isLoading || rezdyQ.isLoading || brmQ.isLoading}
              subtitle="SD-tagged spend ÷ HubSpot SD + Rezdy"
            />
            <KpiCard
              label="Total Confirmed Revenue"
              value={totalConfirmedRevenue}
              format="currency"
              loading={sdClosedQ.isLoading || rezdyQ.isLoading || xeroPnlQ.isLoading}
              subtitle="HubSpot SD + Rezdy + Bike Hire (Xero)"
            />
          </div>
        )}
      </div>

      {/* ── Small summary chart ──────────────────────────────────────────────── */}
      <div className="card">
        <h3 className="text-sm font-medium text-gray-600 mb-4">
          SD-Tagged Spend vs SD Enquiries &amp; Rezdy Conversions (weekly)
        </h3>
        {weeklyChartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={weeklyChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#6b7280', fontSize: 11 }} />
              <YAxis yAxisId="left"
                tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(0)}`}
                tick={{ fill: '#6b7280', fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                labelFormatter={fmtDate}
                formatter={(v, name) =>
                  name === 'SD Enquiries' || name === 'Rezdy'
                    ? [v, name]
                    : [fmtNzd(v), name]
                }
                contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
              <Bar yAxisId="left" dataKey="google" name="Google Ads" fill={COLORS.google} stackId="spend" />
              <Bar yAxisId="left" dataKey="meta"   name="Meta Ads"   fill={COLORS.meta}   stackId="spend" />
              <Line yAxisId="right" type="monotone" dataKey="sdEnquiries" name="SD Enquiries" stroke={COLORS.enquiry} dot={false} strokeWidth={2} />
              <Line yAxisId="right" type="monotone" dataKey="rezdy" name="Rezdy" stroke={COLORS.rezdy} dot={false} strokeWidth={2} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Weekly trend + top Rezdy tours ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

      {/* Weekly trend chart (depot-filterable) — spans 2 cols */}
      <div className="card lg:col-span-2">
        {/* Header + controls */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-medium text-gray-600">
              SD Performance Over Time (weekly)
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Spend = {spendMode === 'sd' ? 'SD-tagged' : 'all'} · {trendDepot !== 'All' ? `Enquiries & conversions filtered to ${trendDepot} · ` : ''}Rezdy = all depots
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {/* Spend mode toggle */}
            <div className="flex gap-1">
              {[['sd', 'SD Spend'], ['all', 'All Spend']].map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setSpendMode(val)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors border ${
                    spendMode === val
                      ? 'text-white border-transparent'
                      : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                  }`}
                  style={spendMode === val ? { backgroundColor: '#6b7280', borderColor: '#6b7280' } : {}}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* Depot picker */}
            <div className="flex flex-wrap gap-1.5">
              {['All', ...DEPOTS].map(d => (
                <button
                  key={d}
                  onClick={() => setTrendDepot(d)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    trendDepot === d
                      ? 'text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                  style={trendDepot === d ? { backgroundColor: '#99ca3c' } : {}}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        </div>

        {weeklyTrendData.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-gray-400 text-sm">No data</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={weeklyTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#6b7280', fontSize: 11 }} />
              <YAxis yAxisId="spend"
                tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(0)}`}
                tick={{ fill: '#6b7280', fontSize: 11 }}
                width={52}
              />
              <YAxis yAxisId="count" orientation="right" tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} width={32} />
              <Tooltip
                labelFormatter={fmtDate}
                formatter={(v, name) =>
                  name === 'Google Ads' || name === 'Meta Ads'
                    ? [fmtNzd(v), name]
                    : [v, name]
                }
                contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
              <Bar yAxisId="spend" dataKey="google"       name="Google Ads"      fill={COLORS.google}       stackId="spend" />
              <Bar yAxisId="spend" dataKey="meta"         name="Meta Ads"        fill={COLORS.meta}         stackId="spend" />
              <Line yAxisId="count" type="monotone" dataKey="enquiries"     name="SD Enquiries"    stroke={COLORS.enquiry}      dot={false} strokeWidth={2} />
              <Line yAxisId="count" type="monotone" dataKey="hsConversions" name="HS Conversions"  stroke={COLORS.hsConversion} dot={false} strokeWidth={2} />
              <Line yAxisId="count" type="monotone" dataKey="rezdy"         name="Rezdy"           stroke={COLORS.rezdy}        dot={false} strokeWidth={2} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Top Rezdy tours by conversions */}
      <div className="card">
        <h3 className="text-sm font-medium text-gray-600 mb-4">Top Rezdy Tours</h3>
        {rezdyProductsQ.isLoading ? (
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
        ) : !rezdyProductsQ.data?.products?.length ? (
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>
        ) : (
          <ol className="space-y-2">
            {[...rezdyProductsQ.data.products].sort((a, b) => b.quantity - a.quantity).slice(0, 12).map((p, i) => (
              <li key={p.name} className="flex items-start gap-2 text-sm">
                <span className="text-xs font-bold text-gray-300 w-5 shrink-0 pt-0.5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-gray-700 truncate text-xs leading-tight">{p.name}</span>
                    <span className="shrink-0 font-semibold text-gray-800 text-xs">{p.quantity}</span>
                  </div>
                  <div className="mt-0.5 h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-1 rounded-full"
                      style={{
                        width: `${Math.round((p.quantity / rezdyProductsQ.data.products[0].quantity) * 100)}%`,
                        backgroundColor: '#99ca3c',
                      }}
                    />
                  </div>
                </div>
              </li>
            ))}
            <li className="text-xs text-gray-400 pt-1 border-t border-gray-50">
              Total: {rezdyProductsQ.data.totalQuantity} bookings · {fmtNzd(rezdyProductsQ.data.totalRevenue)}
            </li>
          </ol>
        )}
      </div>

      </div>{/* end trend+tours grid */}

      {/* ── Revenue breakdown ───────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          Revenue Detail
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <KpiCard
            label="HubSpot SD Revenue"
            value={sdClosedQ.data?.totalRevenue ?? null}
            format="currency"
            loading={sdClosedQ.isLoading}
            subtitle="Confirmed deals · HubSpot SD pipeline"
          />
          <KpiCard
            label="Rezdy Revenue"
            value={rezdyQ.data?.revenueNzd ?? null}
            format="currency"
            loading={rezdyQ.isLoading}
            subtitle="GA4 purchase events"
          />
          <KpiCard
            label="Bike Hire Revenue"
            value={bikeHireRevenue}
            format="currency"
            loading={xeroPnlQ.isLoading}
            subtitle="Xero · Bike &amp; Accessory Hire"
          />
        </div>
      </div>

    </div>
  );
}
