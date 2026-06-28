import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '../context/FilterContext';
import { fetchGoogleSummary, fetchMetaSummary, fetchGoogleDaily, fetchMetaDaily } from '../api';
import ErrorWidget from '../components/ErrorWidget';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, ComposedChart, Bar,
} from 'recharts';
import { format, parseISO } from 'date-fns';

const GOOGLE_COLOR = '#ea4335';
const META_COLOR   = '#1877f2';

function fmtDate(d) {
  try { return format(parseISO(d), 'dd MMM'); } catch { return d; }
}
function fmtNzd(v) {
  if (v === null || v === undefined) return '—';
  return `$${Number(v).toLocaleString('en-NZ', { maximumFractionDigits: 0 })}`;
}
function fmtPct(v) {
  if (v === null || v === undefined) return '—';
  return `${(Number(v) * 100).toFixed(2)}%`;
}
function fmtNum(v) {
  if (v === null || v === undefined) return '—';
  return Number(v).toLocaleString('en-NZ');
}

function PeriodDelta({ current, prior, higherIsBetter = true }) {
  if (prior === null || prior === undefined || prior === 0 ||
      current === null || current === undefined) return null;
  const change = current - prior;
  const pct = (change / Math.abs(prior)) * 100;
  const isGood = higherIsBetter ? change >= 0 : change <= 0;
  const color = change === 0 ? 'text-gray-400' : isGood ? 'text-green-600' : 'text-red-500';
  const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '–';
  return (
    <div className={`text-xs font-medium ${color}`}>
      {arrow} {Math.abs(pct).toFixed(1)}% vs prior
    </div>
  );
}

function Row({ label, google, meta, total, gPrior, mPrior, tPrior, fmt = fmtNum, higherIsBetter = true }) {
  return (
    <tr className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
      <td className="py-3 px-4 text-sm text-gray-700 font-medium">{label}</td>
      <td className="py-3 px-4 text-sm text-right">
        <div className="text-gray-900 font-medium">{fmt(google)}</div>
        <PeriodDelta current={google} prior={gPrior} higherIsBetter={higherIsBetter} />
      </td>
      <td className="py-3 px-4 text-sm text-right">
        <div className="text-gray-900 font-medium">{fmt(meta)}</div>
        <PeriodDelta current={meta} prior={mPrior} higherIsBetter={higherIsBetter} />
      </td>
      <td className="py-3 px-4 text-sm text-right">
        <div className="text-gray-900 font-semibold">{fmt(total)}</div>
        <PeriodDelta current={total} prior={tPrior} higherIsBetter={higherIsBetter} />
      </td>
    </tr>
  );
}

export default function PaidChannels() {
  const { queryParams } = useFilters();

  // Prior period: same duration, shifted back by one period
  const priorParams = React.useMemo(() => {
    if (!queryParams.startDate || !queryParams.endDate) return null;
    const start = new Date(queryParams.startDate + 'T00:00:00Z');
    const end   = new Date(queryParams.endDate   + 'T00:00:00Z');
    const durationMs = end - start + 86_400_000; // inclusive
    const priorEnd   = new Date(start.getTime() - 86_400_000);
    const priorStart = new Date(start.getTime() - durationMs);
    return {
      ...queryParams,
      startDate: priorStart.toISOString().split('T')[0],
      endDate:   priorEnd.toISOString().split('T')[0],
    };
  }, [queryParams]);

  const googleQ      = useQuery({ queryKey: ['googleSummary', queryParams],  queryFn: () => fetchGoogleSummary(queryParams) });
  const metaQ        = useQuery({ queryKey: ['metaSummary',   queryParams],  queryFn: () => fetchMetaSummary(queryParams) });
  const gDailyQ      = useQuery({ queryKey: ['googleDaily',   queryParams],  queryFn: () => fetchGoogleDaily(queryParams) });
  const mDailyQ      = useQuery({ queryKey: ['metaDaily',     queryParams],  queryFn: () => fetchMetaDaily(queryParams) });
  const gPriorQ      = useQuery({ queryKey: ['googleSummary', priorParams],  queryFn: () => fetchGoogleSummary(priorParams), enabled: !!priorParams });
  const mPriorQ      = useQuery({ queryKey: ['metaSummary',   priorParams],  queryFn: () => fetchMetaSummary(priorParams),  enabled: !!priorParams });

  const g  = googleQ.data  || {};
  const m  = metaQ.data    || {};
  const gP = gPriorQ.data  || {};
  const mP = mPriorQ.data  || {};

  const totalSpend       = (g.spendNzd     || 0) + (m.spendNzd  || 0);
  const totalImpressions = (g.impressions  || 0) + (m.impressions || 0);
  const totalClicks      = (g.clicks       || 0) + (m.clicks     || 0);
  const totalLeads       = (g.conversions  || 0) + (m.leads      || 0);
  const totalCpl         = totalLeads > 0 ? totalSpend / totalLeads : null;
  const totalCtr         = totalImpressions > 0 ? totalClicks / totalImpressions : null;

  const priorTotalSpend       = (gP.spendNzd    || 0) + (mP.spendNzd   || 0);
  const priorTotalImpressions = (gP.impressions  || 0) + (mP.impressions || 0);
  const priorTotalClicks      = (gP.clicks       || 0) + (mP.clicks     || 0);
  const priorTotalLeads       = (gP.conversions  || 0) + (mP.leads      || 0);
  const priorTotalCpl         = priorTotalLeads > 0 ? priorTotalSpend / priorTotalLeads : null;
  const priorTotalCtr         = priorTotalImpressions > 0 ? priorTotalClicks / priorTotalImpressions : null;

  const gCpl  = g.conversions > 0 ? g.spendNzd / g.conversions : null;
  const mCpl  = m.leads       > 0 ? m.spendNzd / m.leads       : null;
  const gPCpl = gP.conversions > 0 ? gP.spendNzd / gP.conversions : null;
  const mPCpl = mP.leads       > 0 ? mP.spendNzd / mP.leads       : null;

  const donutData = totalSpend > 0 ? [
    { name: 'Google Ads', value: g.spendNzd || 0 },
    { name: 'Meta Ads',   value: m.spendNzd || 0 },
  ] : [];

  function toArr(v) {
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.daily)) return v.daily;
    return [];
  }

  const granularity = React.useMemo(() => {
    if (!queryParams.startDate || !queryParams.endDate) return 'weekly';
    const start = new Date(queryParams.startDate + 'T00:00:00Z');
    const end   = new Date(queryParams.endDate   + 'T00:00:00Z');
    const days  = (end - start) / (1000 * 60 * 60 * 24);
    return days <= 61 ? 'weekly' : 'monthly';
  }, [queryParams.startDate, queryParams.endDate]);

  function weekStart(dateStr) {
    const d = new Date(dateStr + 'T12:00:00Z');
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
    return d.toISOString().split('T')[0];
  }

  function periodKey(dateStr) {
    return granularity === 'weekly' ? weekStart(dateStr) : dateStr.substring(0, 7);
  }

  const cplTrendData = React.useMemo(() => {
    const map = {};
    const ensure = key => {
      if (!map[key]) map[key] = { googleSpend: 0, metaSpend: 0, googleConv: 0, metaConv: 0 };
    };
    for (const r of toArr(gDailyQ.data)) {
      const key = periodKey(r.date); ensure(key);
      map[key].googleSpend += r.spendNzd    || 0;
      map[key].googleConv  += r.conversions || 0;
    }
    for (const r of toArr(mDailyQ.data)) {
      const key = periodKey(r.date); ensure(key);
      map[key].metaSpend += r.spendNzd || 0;
      map[key].metaConv  += r.leads    || 0;
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, r]) => ({
        date: key,
        'Google CPL': r.googleConv > 0 ? r.googleSpend / r.googleConv : null,
        'Meta CPL':   r.metaConv   > 0 ? r.metaSpend   / r.metaConv  : null,
      }));
  }, [gDailyQ.data, mDailyQ.data, granularity]);

  // Google spend + CTR/clicks over time (all campaigns)
  const googleSpendCtrData = React.useMemo(() => {
    const map = {};
    for (const r of toArr(gDailyQ.data)) {
      const key = periodKey(r.date);
      if (!map[key]) map[key] = { spend: 0, impressions: 0, clicks: 0 };
      map[key].spend += r.spendNzd || 0;
      map[key].impressions += r.impressions || 0;
      map[key].clicks += r.clicks || 0;
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, r]) => ({
        date: key,
        spend: r.spend,
        clicks: r.clicks,
        ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : null,
      }));
  }, [gDailyQ.data, granularity]);

  // Meta spend + CTR/clicks over time (all campaigns)
  const metaSpendCtrData = React.useMemo(() => {
    const map = {};
    for (const r of toArr(mDailyQ.data)) {
      const key = periodKey(r.date);
      if (!map[key]) map[key] = { spend: 0, impressions: 0, clicks: 0 };
      map[key].spend += r.spendNzd || 0;
      map[key].impressions += r.impressions || 0;
      map[key].clicks += r.clicks || 0;
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, r]) => ({
        date: key,
        spend: r.spend,
        clicks: r.clicks,
        ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : null,
      }));
  }, [mDailyQ.data, granularity]);

  function periodTickFormatter(d) {
    return granularity === 'monthly'
      ? (() => { try { return format(parseISO(d + '-01'), 'MMM yy'); } catch { return d; } })()
      : fmtDate(d);
  }

  if (googleQ.isError && metaQ.isError) {
    return <div className="p-6"><ErrorWidget message="Failed to load paid channel data" onRetry={() => { googleQ.refetch(); metaQ.refetch(); }} /></div>;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Summary table */}
      <div className="card overflow-x-auto">
        <h3 className="text-sm font-medium text-gray-700 mb-4">Channel Comparison</h3>
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-4 text-xs text-gray-500 font-semibold uppercase tracking-wider">Metric</th>
              <th className="text-right py-2 px-4 text-xs font-semibold uppercase tracking-wider" style={{ color: GOOGLE_COLOR }}>Google Ads</th>
              <th className="text-right py-2 px-4 text-xs font-semibold uppercase tracking-wider" style={{ color: META_COLOR }}>Meta Ads</th>
              <th className="text-right py-2 px-4 text-xs text-gray-700 font-semibold uppercase tracking-wider">Total</th>
            </tr>
          </thead>
          <tbody>
            <Row label="Spend (NZD)"
              google={g.spendNzd}      gPrior={gP.spendNzd}
              meta={m.spendNzd}        mPrior={mP.spendNzd}
              total={totalSpend}       tPrior={priorTotalSpend}
              fmt={fmtNzd} higherIsBetter={false} />
            <Row label="Impressions"
              google={g.impressions}   gPrior={gP.impressions}
              meta={m.impressions}     mPrior={mP.impressions}
              total={totalImpressions} tPrior={priorTotalImpressions} />
            <Row label="Clicks"
              google={g.clicks}        gPrior={gP.clicks}
              meta={m.clicks}          mPrior={mP.clicks}
              total={totalClicks}      tPrior={priorTotalClicks} />
            <Row label="CTR"
              google={g.ctr}           gPrior={gP.ctr}
              meta={m.ctr}             mPrior={mP.ctr}
              total={totalCtr}         tPrior={priorTotalCtr}
              fmt={fmtPct} />
            <Row label="Enquiries (attributed*)"
              google={g.conversions}   gPrior={gP.conversions}
              meta={m.leads}           mPrior={mP.leads}
              total={totalLeads}       tPrior={priorTotalLeads} />
            <Row label="CPL (NZD)"
              google={gCpl}            gPrior={gPCpl}
              meta={mCpl}              mPrior={mPCpl}
              total={totalCpl}         tPrior={priorTotalCpl}
              fmt={fmtNzd} higherIsBetter={false} />
          </tbody>
        </table>
        <p className="mt-3 text-xs text-gray-400 italic">* Enquiry attribution uses GA4 channel grouping as proxy. Flag: GA4-attributed. Refine with UTM tracking in HubSpot.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Spend donut */}
        <div className="card">
          <h3 className="text-sm font-medium text-gray-700 mb-4">Spend Split</h3>
          {donutData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No spend data</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={donutData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" nameKey="name" paddingAngle={3}>
                  <Cell fill={GOOGLE_COLOR} />
                  <Cell fill={META_COLOR} />
                </Pie>
                <Tooltip formatter={v => fmtNzd(v)} contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* CPL trend */}
        <div className="card">
          <h3 className="text-sm font-medium text-gray-700 mb-4">
            CPL Trend by Channel (NZD)
            <span className="ml-2 text-xs text-gray-400 font-normal">({granularity})</span>
          </h3>
          {cplTrendData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={cplTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="date"
                  tickFormatter={granularity === 'monthly'
                    ? (d => { try { return format(parseISO(d + '-01'), 'MMM yy'); } catch { return d; } })
                    : fmtDate}
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                />
                <YAxis tickFormatter={v => `$${v.toFixed(0)}`} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <Tooltip
                  labelFormatter={granularity === 'monthly'
                    ? (d => { try { return format(parseISO(d + '-01'), 'MMM yyyy'); } catch { return d; } })
                    : fmtDate}
                  formatter={v => v ? fmtNzd(v) : '—'}
                  contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
                <Line type="monotone" dataKey="Google CPL" stroke={GOOGLE_COLOR} dot={false} strokeWidth={2} connectNulls />
                <Line type="monotone" dataKey="Meta CPL"   stroke={META_COLOR}   dot={false} strokeWidth={2} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Google: Spend + CTR over time */}
        <div className="card">
          <h3 className="text-sm font-medium text-gray-700 mb-4">
            Google Spend &amp; CTR Over Time
            <span className="ml-2 text-xs text-gray-400 font-normal">({granularity} · all campaigns)</span>
          </h3>
          {googleSpendCtrData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={googleSpendCtrData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tickFormatter={periodTickFormatter} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="left" tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(0)}`} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v.toFixed(1)}%`} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <Tooltip labelFormatter={periodTickFormatter} formatter={(v, name) => name === 'CTR' ? [`${v.toFixed(2)}%`, name] : [fmtNzd(v), name]} contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
                <Bar yAxisId="left" dataKey="spend" name="Spend (NZD)" fill={GOOGLE_COLOR} radius={[3,3,0,0]} />
                <Line yAxisId="right" type="monotone" dataKey="ctr" name="CTR" stroke="#0F6E56" dot={false} strokeWidth={2} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Google: Spend + Clicks over time */}
        <div className="card">
          <h3 className="text-sm font-medium text-gray-700 mb-4">
            Google Spend &amp; Clicks Over Time
            <span className="ml-2 text-xs text-gray-400 font-normal">({granularity} · all campaigns)</span>
          </h3>
          {googleSpendCtrData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={googleSpendCtrData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tickFormatter={periodTickFormatter} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="left" tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(0)}`} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} />
                <Tooltip labelFormatter={periodTickFormatter} formatter={(v, name) => name === 'Clicks' ? [v.toLocaleString(), name] : [fmtNzd(v), name]} contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
                <Bar yAxisId="left" dataKey="spend" name="Spend (NZD)" fill={GOOGLE_COLOR} radius={[3,3,0,0]} />
                <Line yAxisId="right" type="monotone" dataKey="clicks" name="Clicks" stroke="#a78bfa" dot={false} strokeWidth={2} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Meta: Spend + CTR over time */}
        <div className="card">
          <h3 className="text-sm font-medium text-gray-700 mb-4">
            Meta Spend &amp; CTR Over Time
            <span className="ml-2 text-xs text-gray-400 font-normal">({granularity} · all campaigns)</span>
          </h3>
          {metaSpendCtrData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={metaSpendCtrData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tickFormatter={periodTickFormatter} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="left" tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(0)}`} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v.toFixed(1)}%`} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <Tooltip labelFormatter={periodTickFormatter} formatter={(v, name) => name === 'CTR' ? [`${v.toFixed(2)}%`, name] : [fmtNzd(v), name]} contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
                <Bar yAxisId="left" dataKey="spend" name="Spend (NZD)" fill={META_COLOR} radius={[3,3,0,0]} />
                <Line yAxisId="right" type="monotone" dataKey="ctr" name="CTR" stroke="#0F6E56" dot={false} strokeWidth={2} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Meta: Spend + Clicks over time */}
        <div className="card">
          <h3 className="text-sm font-medium text-gray-700 mb-4">
            Meta Spend &amp; Clicks Over Time
            <span className="ml-2 text-xs text-gray-400 font-normal">({granularity} · all campaigns)</span>
          </h3>
          {metaSpendCtrData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={metaSpendCtrData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tickFormatter={periodTickFormatter} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="left" tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(0)}`} tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} />
                <Tooltip labelFormatter={periodTickFormatter} formatter={(v, name) => name === 'Clicks' ? [v.toLocaleString(), name] : [fmtNzd(v), name]} contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
                <Bar yAxisId="left" dataKey="spend" name="Spend (NZD)" fill={META_COLOR} radius={[3,3,0,0]} />
                <Line yAxisId="right" type="monotone" dataKey="clicks" name="Clicks" stroke="#a78bfa" dot={false} strokeWidth={2} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
