import React from 'react';

const DEFAULT_DEPOTS = ['Nelson', 'West Coast', 'Central Otago', 'Kawarau Gorge'];

// rows: [{ label, fmt, total, byDepot }]
export default function MetricTable({ title, rows, loading, depots = DEFAULT_DEPOTS, note }) {
  return (
    <div className="card">
      {title && <h3 className="text-sm font-medium text-gray-600 mb-3">{title}</h3>}
      {note && <p className="text-xs text-gray-400 italic mb-3">{note}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wide">Metric</th>
              <th className="text-right py-2 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wide">Total</th>
              {depots.map(d => (
                <th key={d} className="text-right py-2 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wide">{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: rows.length || 3 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-100 animate-pulse">
                  <td className="py-3 px-3"><div className="h-3 bg-gray-100 rounded w-40" /></td>
                  {[0, ...depots].map((_, j) => (
                    <td key={j} className="py-3 px-3 text-right"><div className="h-3 bg-gray-100 rounded w-16 ml-auto" /></td>
                  ))}
                </tr>
              ))
            ) : (
              rows.map(row => (
                <tr key={row.label} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="py-2.5 px-3 text-gray-800 font-medium">{row.label}</td>
                  <td className="py-2.5 px-3 text-right text-gray-900 font-semibold">{row.fmt(row.total)}</td>
                  {depots.map(d => (
                    <td key={d} className="py-2.5 px-3 text-right text-gray-700">{row.fmt(row.byDepot?.[d])}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
