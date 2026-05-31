import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '../context/FilterContext';
import { fetchGoogleCampaigns, fetchMetaCampaigns } from '../api';
import ErrorWidget from '../components/ErrorWidget';
import StatusBadge from '../components/StatusBadge';

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
  return Number(v).toLocaleString('en-NZ', { maximumFractionDigits: 1 });
}

function SortIcon({ active, dir }) {
  if (!active) return <span className="text-gray-700 ml-1">↕</span>;
  return <span className="text-green-400 ml-1">{dir === 'asc' ? '↑' : '↓'}</span>;
}

function CampaignTable({ campaigns = [], columns, loading, error, onRetry }) {
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState('spendNzd');
  const [sortDir, setSortDir] = useState('desc');

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  const filtered = campaigns
    .filter(c => (c.spendNzd ?? 0) > 0)
    .filter(c => c.name?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortCol] ?? -Infinity;
      const bv = b[sortCol] ?? -Infinity;
      return sortDir === 'asc' ? av - bv : bv - av;
    });

  if (error) return <ErrorWidget message={error} onRetry={onRetry} />;

  return (
    <div>
      <div className="mb-3">
        <input
          type="text"
          placeholder="Filter campaigns…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-xs bg-gray-800 border border-gray-700 rounded-md text-sm text-gray-300 px-3 py-1.5 focus:outline-none focus:border-green-500"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium uppercase">Campaign</th>
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className="text-right py-2 px-3 text-xs text-gray-500 font-medium uppercase cursor-pointer hover:text-gray-300 select-none"
                >
                  {col.label}<SortIcon active={sortCol === col.key} dir={sortDir} />
                </th>
              ))}
              <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium uppercase">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-800 animate-pulse">
                  <td className="py-3 px-3"><div className="h-3 bg-gray-800 rounded w-40" /></td>
                  {columns.map(c => (
                    <td key={c.key} className="py-3 px-3 text-right"><div className="h-3 bg-gray-800 rounded w-16 ml-auto" /></td>
                  ))}
                  <td className="py-3 px-3 text-right"><div className="h-3 bg-gray-800 rounded w-14 ml-auto" /></td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={columns.length + 2} className="py-8 text-center text-gray-600 text-sm">No campaigns found</td></tr>
            ) : (
              filtered.map(c => (
                <tr key={c.id} className="border-b border-gray-800 hover:bg-gray-800/40 transition-colors">
                  <td className="py-2.5 px-3 text-gray-200 max-w-xs truncate">{c.name}</td>
                  {columns.map(col => (
                    <td key={col.key} className="py-2.5 px-3 text-right text-gray-300">
                      {col.fmt ? col.fmt(c[col.key]) : fmtNum(c[col.key])}
                    </td>
                  ))}
                  <td className="py-2.5 px-3 text-right"><StatusBadge status={c.status} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const GOOGLE_COLS = [
  { key: 'spendNzd',             label: 'Spend (NZD)',    fmt: fmtNzd },
  { key: 'impressions',          label: 'Impressions',    fmt: fmtNum },
  { key: 'clicks',               label: 'Clicks',         fmt: fmtNum },
  { key: 'ctr',                  label: 'CTR',            fmt: fmtPct },
  { key: 'conversions',          label: 'Conversions',    fmt: fmtNum },
  { key: 'costPerConversionNzd', label: 'Cost/Conv',      fmt: fmtNzd },
];

const META_COLS = [
  { key: 'spendNzd',         label: 'Spend (NZD)', fmt: fmtNzd },
  { key: 'impressions',      label: 'Impressions', fmt: fmtNum },
  { key: 'clicks',           label: 'Clicks',      fmt: fmtNum },
  { key: 'ctr',              label: 'CTR',         fmt: fmtPct },
  { key: 'leads',            label: 'Results',     fmt: fmtNum },
  { key: 'costPerResultNzd', label: 'CPR',         fmt: fmtNzd },
];

// Handles bare array (configured) or { campaigns: [] } stub (not configured)
function toCampaigns(v) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.campaigns)) return v.campaigns;
  return [];
}

export default function CampaignDetail() {
  const { queryParams } = useFilters();
  const googleQ = useQuery({ queryKey: ['googleCampaigns', queryParams], queryFn: () => fetchGoogleCampaigns(queryParams) });
  const metaQ   = useQuery({ queryKey: ['metaCampaigns',   queryParams], queryFn: () => fetchMetaCampaigns(queryParams) });

  return (
    <div className="p-6 space-y-8">
      <section>
        <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
          Google Ads Campaigns
        </h2>
        <div className="card">
          <CampaignTable
            campaigns={toCampaigns(googleQ.data)}
            columns={GOOGLE_COLS}
            loading={googleQ.isLoading}
            error={googleQ.isError ? googleQ.error?.message : null}
            onRetry={() => googleQ.refetch()}
          />
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" />
          Meta Ads Campaigns
        </h2>
        <div className="card">
          <CampaignTable
            campaigns={toCampaigns(metaQ.data)}
            columns={META_COLS}
            loading={metaQ.isLoading}
            error={metaQ.isError ? metaQ.error?.message : null}
            onRetry={() => metaQ.refetch()}
          />
        </div>
      </section>
    </div>
  );
}
