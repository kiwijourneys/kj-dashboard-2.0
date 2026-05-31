import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '../context/FilterContext';
import { fetchGa4Organic, fetchGa4TopPages, fetchGa4Daily, fetchGoogleSummary } from '../api';
import KpiCard from '../components/KpiCard';
import ErrorWidget from '../components/ErrorWidget';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { format } from 'date-fns';

function fmtDate(d) {
  if (!d || d.length !== 8) return d;
  try { return format(new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`), 'dd MMM'); } catch { return d; }
}

const CHANNEL_COLORS = {
  'Organic Search': '#22c55e',
  'Paid Search':    '#ea4335',
  'Direct':         '#9ca3af',
  'Referral':       '#f59e0b',
  'Paid Social':    '#1877f2',
  'Organic Social': '#a78bfa',
};

function channelColor(name) {
  return CHANNEL_COLORS[name] || '#6b7280';
}

export default function OrganicSEO() {
  const { queryParams } = useFilters();

  const organicQ  = useQuery({ queryKey: ['ga4Organic',  queryParams], queryFn: () => fetchGa4Organic(queryParams) });
  const topPagesQ = useQuery({ queryKey: ['ga4TopPages', queryParams], queryFn: () => fetchGa4TopPages(queryParams) });
  const dailyQ    = useQuery({ queryKey: ['ga4Daily',    queryParams], queryFn: () => fetchGa4Daily(queryParams) });

  const sessionChartData = React.useMemo(() => {
    if (!dailyQ.data) return [];
    const map = {};
    for (const r of dailyQ.data) {
      if (!map[r.date]) map[r.date] = { date: r.date };
      map[r.date][r.channel] = (map[r.date][r.channel] || 0) + r.sessions;
    }
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
  }, [dailyQ.data]);

  const allChannels = React.useMemo(() => {
    if (!dailyQ.data) return [];
    return [...new Set(dailyQ.data.map(r => r.channel))];
  }, [dailyQ.data]);

  const organic = organicQ.data;

  return (
    <div className="p-6 space-y-6">
      {/* Organic KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <KpiCard label="Organic Sessions"    value={organic?.sessions}       format="number"  loading={organicQ.isLoading} error={organicQ.isError} />
        <KpiCard label="Organic Conversions" value={organic?.conversions}    format="number"  loading={organicQ.isLoading} error={organicQ.isError} />
        <KpiCard label="Organic Conv. Rate"  value={organic?.conversionRate !== undefined ? organic.conversionRate * 100 : null} format="percent" loading={organicQ.isLoading} error={organicQ.isError} />
      </div>

      {/* Sessions by channel chart */}
      <div className="card">
        <h3 className="text-sm font-medium text-gray-700 mb-4">Sessions by Channel Over Time</h3>
        {dailyQ.isLoading ? (
          <div className="h-48 bg-gray-100 rounded animate-pulse" />
        ) : sessionChartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={sessionChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: '#6b7280', fontSize: 11 }} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                labelFormatter={fmtDate}
                contentStyle={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#3b3b3b', marginBottom: 4 }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
              {allChannels.map(ch => (
                <Line key={ch} type="monotone" dataKey={ch} stroke={channelColor(ch)} dot={false} strokeWidth={2} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Top organic landing pages */}
      <div className="card">
        <h3 className="text-sm font-medium text-gray-700 mb-4">Top Organic Landing Pages</h3>
        {topPagesQ.isError ? (
          <ErrorWidget message={topPagesQ.error?.message} onRetry={() => topPagesQ.refetch()} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wide">Page</th>
                <th className="text-right py-2 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wide">Sessions</th>
                <th className="text-right py-2 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wide">Conversions</th>
              </tr>
            </thead>
            <tbody>
              {topPagesQ.isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-100 animate-pulse">
                      <td className="py-3 px-3"><div className="h-3 bg-gray-100 rounded w-56" /></td>
                      <td className="py-3 px-3 text-right"><div className="h-3 bg-gray-100 rounded w-10 ml-auto" /></td>
                      <td className="py-3 px-3 text-right"><div className="h-3 bg-gray-100 rounded w-10 ml-auto" /></td>
                    </tr>
                  ))
                : (topPagesQ.data || []).map((row, i) => (
                    <tr key={i} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="py-2.5 px-3 text-gray-700 text-xs font-mono truncate max-w-xs">{row.page}</td>
                      <td className="py-2.5 px-3 text-right text-gray-900 font-medium">{row.sessions.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right font-semibold" style={{ color: '#99ca3c' }}>{row.conversions.toLocaleString()}</td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
