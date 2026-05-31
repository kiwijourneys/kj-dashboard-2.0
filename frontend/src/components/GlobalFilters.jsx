import React, { useState } from 'react';
import { useFilters } from '../context/FilterContext';

export default function GlobalFilters() {
  const {
    region, setRegion,
    preset, setDatePreset,
    dateRange, setCustomDateRange,
    REGIONS, DATE_PRESETS,
  } = useFilters();

  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd]     = useState('');

  function applyCustom() {
    if (customStart && customEnd) setCustomDateRange(customStart, customEnd);
  }

  const activeBtn  = 'text-white font-medium rounded-md px-3 py-1 text-sm transition-colors';
  const inactiveBtn = 'text-gray-500 hover:text-gray-700 rounded-md px-3 py-1 text-sm font-medium transition-colors';

  return (
    <div className="flex flex-wrap items-center gap-3 px-6 py-3 bg-white border-b border-gray-200">
      {/* Region selector */}
      <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1">
        {REGIONS.map(r => (
          <button
            key={r.label}
            onClick={() => setRegion(r.value)}
            className={region === r.value ? activeBtn : inactiveBtn}
            style={region === r.value ? { backgroundColor: '#99ca3c' } : {}}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Date preset buttons */}
      <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1">
        {DATE_PRESETS.filter(p => p.value !== 'custom').map(p => (
          <button
            key={p.value}
            onClick={() => setDatePreset(p.value)}
            className={preset === p.value ? activeBtn : inactiveBtn}
            style={preset === p.value ? { backgroundColor: '#99ca3c' } : {}}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom date range */}
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={customStart}
          onChange={e => setCustomStart(e.target.value)}
          className="bg-white border border-gray-300 rounded-md text-sm text-gray-700 px-2 py-1 focus:outline-none focus:border-[#99ca3c]"
        />
        <span className="text-gray-400 text-sm">→</span>
        <input
          type="date"
          value={customEnd}
          onChange={e => setCustomEnd(e.target.value)}
          className="bg-white border border-gray-300 rounded-md text-sm text-gray-700 px-2 py-1 focus:outline-none focus:border-[#99ca3c]"
        />
        <button
          onClick={applyCustom}
          disabled={!customStart || !customEnd}
          className="px-3 py-1 rounded-md text-sm text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          style={{ backgroundColor: '#99ca3c' }}
        >
          Apply
        </button>
      </div>

      {/* Active range display */}
      <span className="ml-auto text-xs text-gray-400">
        {dateRange.startDate} → {dateRange.endDate}
      </span>
    </div>
  );
}
