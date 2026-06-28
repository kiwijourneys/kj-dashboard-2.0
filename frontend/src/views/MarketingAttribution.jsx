import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '../context/FilterContext';
import { fetchAdAttribution } from '../api';
import ErrorWidget from '../components/ErrorWidget';
import {
  ComposedChart, Bar, Line, ScatterChart, Scatter,
  XAxis, YAxis, ZAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { format, parseISO } from 'date-fns';

function fmtWeek(iso) {
  try { return format(parseISO(iso), 'MMM d'); } catch { return iso; }
}
function fmtNzd(v) {
  if (v === null || v === undefined) return '—';
  return `$${Number(v).toLocaleString('en-NZ', { maximumFractionDigits: 0 })}`;
}
function fmtPct(v) {
  if (v === null || v === undefined) return '—';
  return `${v.toFixed(0)}%`;
}
function fmtR(v) {
  if (v === null || v === undefined) return '—';
  return v.toFixed(2);
}

function StatCard({ label, value, sub }) {
  return (
    <div className="kpi-card">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-semibold mt-1" style={{ color: '#3b3b3b' }}>
        {value} {sub && <span className="text-sm font-medium text-gray-400">{sub}</span>}
      </p>
    </div>
  );
}

function strengthColor(strength) {
  if (!strength) return 'text-gray-400';
  if (strength.includes('Strong')) return strength.includes('positive') ? 'text-[#99ca3c]' : 'text-red-500';
  if (strength.includes('Moderate')) return strength.includes('positive') ? 'text-emerald-500' : 'text-orange-500';
  if (strength.includes('Weak')) return 'text-gray-500';
  return 'text-gray-400';
}

function CorrelationCard({ corr }) {
  return (
    <div className="card">
      <h4 className="text-sm font-medium text-gray-700 mb-2">{corr.label}</h4>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-2xl font-semibold" style={{ color: '#3b3b3b' }}>r = {fmtR(corr.bestR)}</span>
        <span className="text-xs text-gray-400">at {corr.bestLag}wk lag</span>
      </div>
      <p className={`text-xs font-medium mb-3 ${strengthColor(corr.bestStrength)}`}>{corr.bestStrength}</p>
      <div className="flex gap-1">
        {corr.byLag.map(l => (
          <div key={l.lag} className="flex-1 text-center">
            <div className="text-xs text-gray-400">{l.lag}wk</div>
            <div className={`text-xs font-medium ${strengthColor(l.strength)}`}>{fmtR(l.r)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MarketingAttribution() {
  const { queryParams } = useFilters();
  const { startDate, endDate } = queryParams;

  const attrQ = useQuery({
    queryKey: ['adAttribution', startDate, endDate],
    queryFn: () => fetchAdAttribution({ startDate, endDate }),
    enabled: !!(startDate && endDate),
    retry: 1,
  });

  if (attrQ.isError) {
    return <div className="p-6"><ErrorWidget message={attrQ.error?.message} onRetry={() => attrQ.refetch()} /></div>;
  }

  const d = attrQ.data;
  const loading = attrQ.isLoading || !d;

  const chartData = loading ? [] : d.weeklyChart.map(w => ({ ...w, weekLabel: fmtWeek(w.week) }));
  const metaOwnCorr   = loading ? null : d.correlations.find(c => c.key === 'metaOwn');
  const googleOwnCorr = loading ? null : d.correlations.find(c => c.key === 'googleOwn');

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          Ad Attribution <span className="normal-case font-normal text-gray-400">(HubSpot click-ID tracking — Facebook/Google click IDs on contact records)</span>
        </h2>
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="kpi-card animate-pulse">
                <div className="h-3 bg-gray-100 rounded w-24 mb-3" />
                <div className="h-7 bg-gray-100 rounded w-20" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <StatCard label="Total Deal Contacts" value={fmtNum(d.statCards.totalDealContacts)} />
            <StatCard label="Meta Contacts" value={fmtNum(d.statCards.metaContacts)} sub={fmtPct(d.statCards.metaPct)} />
            <StatCard label="Google Contacts" value={fmtNum(d.statCards.googleContacts)} sub={fmtPct(d.statCards.googlePct)} />
            <StatCard label="Meta Spend (NZD)" value={fmtNzd(d.statCards.metaSpendNzd)} />
            <StatCard label="Google Spend (NZD)" value={fmtNzd(d.statCards.googleSpendNzd)} />
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="text-sm font-medium text-gray-600 mb-3">Weekly Deal Contacts by Channel + Ad Spend</h3>
        {loading ? (
          <div className="h-72 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
        ) : chartData.length < 2 ? (
          <div className="h-72 flex items-center justify-center text-gray-400 text-sm">Select a wider date range to see weekly trends</div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="weekLabel" tick={{ fill: '#6b7280', fontSize: 11 }} />
              <YAxis yAxisId="contacts" tick={{ fill: '#6b7280', fontSize: 11 }} label={{ value: 'Deal contacts', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#6b7280' }} />
              <YAxis yAxisId="spend" orientation="right" tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={v => `$${v >= 1000 ? (v/1000).toFixed(1)+'k' : v}`} label={{ value: 'Ad spend (NZD)', angle: 90, position: 'insideRight', fontSize: 11, fill: '#6b7280' }} />
              <Tooltip contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 6 }} labelStyle={{ color: '#3b3b3b' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="contacts" dataKey="metaContacts"   name="Meta deal contacts"   stackId="c" fill="#1877f2" />
              <Bar yAxisId="contacts" dataKey="googleContacts" name="Google deal contacts" stackId="c" fill="#3B6D11" />
              <Bar yAxisId="contacts" dataKey="otherContacts"  name="Other deal contacts"  stackId="c" fill="#d3d1c7" radius={[3,3,0,0]} />
              <Line yAxisId="spend" type="monotone" dataKey="metaSpendNzd"   name="Meta spend (NZD)"   stroke="#BA7517" strokeWidth={2} dot={{ r: 3 }} />
              <Line yAxisId="spend" type="monotone" dataKey="googleSpendNzd" name="Google spend (NZD)" stroke="#0F6E56" strokeWidth={2} strokeDasharray="6 3" dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          Lag Correlation Analysis <span className="normal-case font-normal text-gray-400">(does spend this week predict contacts in a future week?)</span>
        </h2>
        {loading ? (
          <div className="card h-32 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
        ) : chartData.length < 5 ? (
          <div className="card h-32 flex items-center justify-center text-gray-400 text-sm">
            Need at least ~5 weeks of data for meaningful correlation — widen the date range
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {d.correlations.map(c => <CorrelationCard key={c.key} corr={c} />)}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="card">
                <h4 className="text-sm font-medium text-gray-600 mb-3">
                  Meta: spend (week N) vs contacts (week N+{metaOwnCorr?.bestLag ?? 0})
                </h4>
                <ResponsiveContainer width="100%" height={220}>
                  <ScatterChart margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis type="number" dataKey="x" name="Spend" tickFormatter={v => fmtNzd(v)} tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <YAxis type="number" dataKey="y" name="Contacts" tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <ZAxis range={[60, 60]} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 6 }} />
                    <Scatter data={metaOwnCorr?.scatter || []} fill="#1877f2" />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div className="card">
                <h4 className="text-sm font-medium text-gray-600 mb-3">
                  Google: spend (week N) vs contacts (week N+{googleOwnCorr?.bestLag ?? 0})
                </h4>
                <ResponsiveContainer width="100%" height={220}>
                  <ScatterChart margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis type="number" dataKey="x" name="Spend" tickFormatter={v => fmtNzd(v)} tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <YAxis type="number" dataKey="y" name="Contacts" tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <ZAxis range={[60, 60]} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 6 }} />
                    <Scatter data={googleOwnCorr?.scatter || []} fill="#3B6D11" />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-gray-400 italic">
        Meta attribution relies on hs_facebook_click_id (click-through only); Google relies on hs_google_click_id. View-through conversions and contacts where the pixel fired but the click ID wasn't captured are not counted. Pearson r at low week-counts has wide confidence intervals — treat |r| below 0.4 as noise.
      </p>
    </div>
  );
}

function fmtNum(v) {
  if (v === null || v === undefined) return '—';
  return Number(v).toLocaleString('en-NZ');
}
