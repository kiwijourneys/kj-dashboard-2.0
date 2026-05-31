import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '../context/FilterContext';
import { fetchMdFunnel } from '../api';
import ErrorWidget from '../components/ErrorWidget';

export default function FunnelView() {
  const { queryParams } = useFilters();
  const funnelQ = useQuery({
    queryKey: ['mdFunnel', queryParams],
    queryFn: () => fetchMdFunnel(queryParams),
  });

  if (funnelQ.isError) {
    return <div className="p-6"><ErrorWidget message={funnelQ.error?.message} onRetry={() => funnelQ.refetch()} /></div>;
  }

  const stages = funnelQ.data?.stages || [];
  const totalEnquiries = funnelQ.data?.totalEnquiries || stages[0]?.count || 1;
  const closedLost = funnelQ.data?.closedLost ?? null;
  const lastStage = stages[stages.length - 1];
  const overallConversion = lastStage ? (lastStage.pct ?? (lastStage.count / totalEnquiries) * 100) : null;
  const closedLostPct = closedLost !== null && (totalEnquiries + closedLost) > 0
    ? (closedLost / (totalEnquiries + closedLost)) * 100
    : null;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-base font-semibold text-gray-800">Multi Day Sales Pipeline Funnel</h2>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          {closedLostPct !== null && (
            <span>
              Closed Lost:{' '}
              <span className="text-red-500 font-semibold">{closedLost} ({closedLostPct.toFixed(1)}% of all enquiries)</span>
            </span>
          )}
          {overallConversion !== null && (
            <span>
              Active → Booking Admin Complete:{' '}
              <span className="font-semibold" style={{ color: '#99ca3c' }}>{overallConversion.toFixed(1)}%</span>
            </span>
          )}
        </div>
      </div>

      {funnelQ.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" style={{ width: `${100 - i * 8}%` }} />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {stages.map((stage, i) => {
            const pct = stage.pct ?? (stage.count / totalEnquiries) * 100;
            const barWidth = Math.max(pct, 2);

            const prev = stages[i - 1];
            const prevPct = prev ? (prev.pct ?? (prev.count / totalEnquiries) * 100) : null;
            const dropoffPts = prevPct !== null ? prevPct - pct : null;

            return (
              <div key={stage.id}>
                {dropoffPts !== null && dropoffPts > 0.5 && (
                  <div className="flex items-center gap-2 py-0.5 pl-3">
                    <span className="text-red-500 text-xs leading-none">▼</span>
                    <span className="text-xs text-red-500">
                      {dropoffPts.toFixed(1)}pp drop-off
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-gray-100 rounded-lg h-11 relative overflow-hidden border border-gray-200">
                    <div
                      className="absolute inset-y-0 left-0 rounded-lg transition-all duration-500"
                      style={{
                        width: `${barWidth}%`,
                        backgroundColor: '#99ca3c',
                        opacity: 0.5 + (pct / 100) * 0.5,
                      }}
                    />
                    <div className="relative z-10 flex items-center justify-between h-full px-3">
                      <span className="text-sm font-semibold text-gray-800">{stage.label}</span>
                      <span className="text-sm font-bold tabular-nums" style={{ color: '#3b3b3b' }}>
                        {stage.count.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <span className="w-14 text-right text-sm font-semibold tabular-nums text-gray-700">
                    {pct.toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary table */}
      {stages.length > 0 && (
        <div className="card overflow-x-auto">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Stage Conversion Detail</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wide">Stage</th>
                <th className="text-right py-2 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wide">Count</th>
                <th className="text-right py-2 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wide">% of Enquiries</th>
                <th className="text-right py-2 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wide">Drop-off from Prev</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((stage, i) => {
                const pct = stage.pct ?? (stage.count / totalEnquiries) * 100;
                const prev = stages[i - 1];
                const prevPct = prev ? (prev.pct ?? (prev.count / totalEnquiries) * 100) : null;
                const dropoffPts = prevPct !== null ? prevPct - pct : null;

                return (
                  <tr key={stage.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-2.5 px-3 text-gray-800 font-medium">{stage.label}</td>
                    <td className="py-2.5 px-3 text-right text-gray-900 font-semibold tabular-nums">{stage.count.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      <span className={pct > 50 ? 'font-semibold' : pct > 20 ? 'font-medium' : ''}
                            style={{ color: pct > 50 ? '#99ca3c' : pct > 20 ? '#f59e0b' : '#ef4444' }}>
                        {pct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {dropoffPts !== null ? (
                        <span className={dropoffPts > 20 ? 'text-red-500 font-medium' : dropoffPts > 10 ? 'text-amber-500' : 'text-gray-500'}>
                          −{dropoffPts.toFixed(1)}pp
                        </span>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-gray-400 italic">
            % = share of active + won enquiries (excl. Closed Lost) that reached each stage or beyond.
            Closed Lost deals are counted separately in the header — they don't distort stage conversion rates.
          </p>
        </div>
      )}
    </div>
  );
}
