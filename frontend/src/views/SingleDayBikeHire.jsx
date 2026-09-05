import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '../context/FilterContext';
import {
  fetchSummary, fetchSdLeads, fetchSdClosed,
  fetchGa4RezdyRev, fetchGa4BikeRental,
  fetchGoogleTourTypeDaily, fetchMetaTourTypeDaily,
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
  google:  '#ea4335',
  meta:    '#1877f2',
  enquiry: '#a78bfa',
  rezdy:   '#22c55e',
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

  const summaryQ      = useQuery({ queryKey: ['summary',       queryParams], queryFn: () => fetchSummary(queryParams) });
  const sdLeadsQ      = useQuery({ queryKey: ['sdLeads',       queryParams], queryFn: () => fetchSdLeads(queryParams) });
  const sdClosedQ     = useQuery({ queryKey: ['sdClosed',      queryParams], queryFn: () => fetchSdClosed(queryParams) });
  const rezdyQ        = useQuery({ queryKey: ['rezdyRev',      queryParams], queryFn: () => fetchGa4RezdyRev(queryParams) });
  const gTourTypeQ    = useQuery({ queryKey: ['googleTourTypeDaily', queryParams], queryFn: () => fetchGoogleTourTypeDaily(queryParams) });
  const mTourTypeQ    = useQuery({ queryKey: ['metaTourTypeDaily',  queryParams], queryFn: () => fetchMetaTourTypeDaily(queryParams) });
  const xeroPnlQ      = useQuery({ queryKey: ['xeroPnl',       queryParams], queryFn: () => fetchXeroPnl(queryParams), retry: 1 });
  const brmQ          = useQuery({ queryKey: ['brmConv',       queryParams], queryFn: () => fetchGa4BikeRental(queryParams) });
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
  const costPerConversion = sdTaggedSpend !== null && totalConversions > 0
    ? sdTaggedSpend / totalConversions
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

  const depotLoading = sdLeadsQ.isLoading || sdClosedQ.isLoading || marketingPerfQ.isLoading;

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
              subtitle="SD-tagged spend ÷ HubSpot + Rezdy + Bike Hire"
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

      {/* ── Chart + depot table ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Weekly spend vs enquiries + Rezdy */}
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

        {/* Depot breakdown table */}
        <div className="card">
          <h3 className="text-sm font-medium text-gray-600 mb-4">Breakdown by Depot</h3>
          {depotLoading ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100">
                    <th className="pb-2 pr-4">Depot</th>
                    <th className="pb-2 pr-4 text-right">Enquiries</th>
                    <th className="pb-2 pr-4 text-right">Conversions</th>
                    <th className="pb-2 text-right">$/SD Enquiry</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Total row */}
                  <tr className="border-b border-gray-100 font-semibold text-gray-800">
                    <td className="py-2 pr-4">Total</td>
                    <td className="py-2 pr-4 text-right">{sdEnquiryByDepot.total}</td>
                    <td className="py-2 pr-4 text-right">{sdClosedByDepot.total}</td>
                    <td className="py-2 text-right">{fmtCurrency(mp?.costPerEnquiry?.sd?.total)}</td>
                  </tr>
                  {DEPOTS.map(depot => (
                    <tr key={depot} className="border-b border-gray-50 text-gray-600 hover:bg-gray-50">
                      <td className="py-2 pr-4">{depot}</td>
                      <td className="py-2 pr-4 text-right">{sdEnquiryByDepot.byDepot[depot] ?? 0}</td>
                      <td className="py-2 pr-4 text-right">{sdClosedByDepot.byDepot[depot] ?? 0}</td>
                      <td className="py-2 text-right">
                        {fmtCurrency(mp?.costPerEnquiry?.sd?.byDepot?.[depot])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-gray-400">
                Conversions = HubSpot SD confirmed deals · Rezdy bookings ({rezdyConversions ?? '—'} total) have no depot tag
              </p>
            </div>
          )}
        </div>
      </div>

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
