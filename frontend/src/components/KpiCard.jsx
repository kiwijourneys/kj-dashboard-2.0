import React from 'react';

function Delta({ delta, deltaPercent, invertPositive = false }) {
  if (delta === null || delta === undefined) return null;
  const isPositive = delta > 0;
  const isGood = invertPositive ? !isPositive : isPositive;
  const color = delta === 0 ? 'text-gray-400' : isGood ? 'text-[#99ca3c]' : 'text-red-500';
  const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '–';
  const pct = deltaPercent !== null ? ` (${Math.abs(deltaPercent).toFixed(1)}%)` : '';
  return (
    <span className={`text-xs font-medium ${color}`}>
      {arrow} {Math.abs(delta).toLocaleString()}{pct}
    </span>
  );
}

export default function KpiCard({
  label,
  value,
  delta,
  deltaPercent,
  format = 'number',
  invertPositive = false,
  loading = false,
  error = null,
  subtitle = null,
}) {
  function formatValue(v) {
    if (v === null || v === undefined) return '—';
    switch (format) {
      case 'currency':
        return `$${Number(v).toLocaleString('en-NZ', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
      case 'percent':
        return `${Number(v).toFixed(1)}%`;
      case 'roas':
        return `${Number(v).toFixed(2)}x`;
      default:
        return Number(v).toLocaleString('en-NZ');
    }
  }

  if (loading) {
    return (
      <div className="kpi-card animate-pulse">
        <div className="h-3 bg-gray-100 rounded w-24 mb-3" />
        <div className="h-7 bg-gray-100 rounded w-32" />
      </div>
    );
  }

  return (
    <div className="kpi-card">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      {error ? (
        <p className="text-sm text-red-500">Error loading</p>
      ) : (
        <>
          <p className="text-2xl font-semibold mt-1" style={{ color: '#3b3b3b' }}>{formatValue(value)}</p>
          {delta !== undefined && (
            <div className="mt-1">
              <Delta delta={delta} deltaPercent={deltaPercent} invertPositive={invertPositive} />
              <span className="text-xs text-gray-400 ml-1">vs prior period</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
