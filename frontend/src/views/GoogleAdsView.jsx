import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '../context/FilterContext';
import { fetchGoogleCampaigns, fetchGa4CampaignEngagement } from '../api';

function fmtNzd(n, decimals = 0) {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-NZ', { style: 'currency', currency: 'NZD', minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  return (n * 100).toFixed(decimals) + '%';
}

function fmtSec(sec) {
  if (!sec || isNaN(sec)) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const COLS = [
  { key: 'name',                 label: 'Campaign',       align: 'left'  },
  { key: 'impressions',          label: 'Impr.',          align: 'right' },
  { key: 'clicks',               label: 'Clicks',         align: 'right' },
  { key: 'avgCpc',               label: 'Avg CPC',        align: 'right' },
  { key: 'ctrPct',               label: 'CTR %',          align: 'right' },
  { key: 'conversions',          label: 'Conv.',          align: 'right' },
  { key: 'spendNzd',             label: 'Cost',           align: 'right' },
  { key: 'convRate',             label: 'Conv %',         align: 'right' },
  { key: 'costPerConversionNzd', label: 'Cost/Conv',      align: 'right' },
  { key: 'engTime',              label: 'Avg Eng. Time',  align: 'right' },
];

export default function GoogleAdsView() {
  const { queryParams } = useFilters();
  const [sortCol, setSortCol] = useState('spendNzd');
  const [sortDir, setSortDir] = useState('desc');

  const campaignsQ = useQuery({
    queryKey: ['google-campaigns', queryParams],
    queryFn: () => fetchGoogleCampaigns(queryParams),
  });

  const engQ = useQuery({
    queryKey: ['ga4-campaign-engagement', queryParams],
    queryFn: () => fetchGa4CampaignEngagement(queryParams),
  });

  const engMap = useMemo(() => {
    const m = {};
    for (const r of (engQ.data || [])) m[r.campaign] = r.avgEngagementSec;
    return m;
  }, [engQ.data]);

  const rows = useMemo(() => {
    const raw = (campaignsQ.data || []).map(r => ({
      ...r,
      avgCpc: r.clicks > 0 ? r.spendNzd / r.clicks : 0,
      ctrPct: r.ctr,   // already a fraction
      convRate: r.clicks > 0 ? r.conversions / r.clicks : 0,
      engTime: engMap[r.name] ?? null,
    }));

    return [...raw].sort((a, b) => {
      const av = a[sortCol] ?? (sortCol === 'name' ? '' : -Infinity);
      const bv = b[sortCol] ?? (sortCol === 'name' ? '' : -Infinity);
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [campaignsQ.data, engMap, sortCol, sortDir]);

  const totals = useMemo(() => {
    if (!rows.length) return null;
    const spend   = rows.reduce((s, r) => s + (r.spendNzd || 0), 0);
    const clicks  = rows.reduce((s, r) => s + (r.clicks || 0), 0);
    const impr    = rows.reduce((s, r) => s + (r.impressions || 0), 0);
    const conv    = rows.reduce((s, r) => s + (r.conversions || 0), 0);
    return {
      spend, clicks, impr, conv,
      ctr: impr > 0 ? clicks / impr : 0,
      convRate: clicks > 0 ? conv / clicks : 0,
      cpl: conv > 0 ? spend / conv : null,
      cpc: clicks > 0 ? spend / clicks : null,
    };
  }, [rows]);

  function handleSort(key) {
    if (key === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(key); setSortDir('desc'); }
  }

  function sortIcon(key) {
    if (key !== sortCol) return <span className="opacity-20">↕</span>;
    return sortDir === 'asc' ? '↑' : '↓';
  }

  function renderCell(row, key) {
    switch (key) {
      case 'name':                 return <span className="font-medium text-gray-800">{row.name}</span>;
      case 'impressions':          return row.impressions?.toLocaleString() ?? '—';
      case 'clicks':               return row.clicks?.toLocaleString() ?? '—';
      case 'avgCpc':               return fmtNzd(row.avgCpc, 2);
      case 'ctrPct':               return fmtPct(row.ctrPct);
      case 'conversions':          return row.conversions != null ? row.conversions.toFixed(2).replace(/\.00$/, '') : '—';
      case 'spendNzd':             return fmtNzd(row.spendNzd, 2);
      case 'convRate':             return fmtPct(row.convRate);
      case 'costPerConversionNzd': return row.conversions > 0 ? fmtNzd(row.costPerConversionNzd, 2) : '—';
      case 'engTime': {
        if (engQ.isLoading) return <span className="text-gray-400">…</span>;
        const s = fmtSec(row.engTime);
        return s ? <span className="text-teal-600 font-medium">{s}</span> : <span className="text-gray-300">—</span>;
      }
      default: return '—';
    }
  }

  const loading = campaignsQ.isLoading;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Google Ads — Campaigns</h1>
        <p className="text-sm text-gray-500 mt-1">Live data for the selected date range. Engagement time from GA4.</p>
      </div>

      {/* KPI summary cards */}
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Total Spend (NZD)</div>
            <div className="text-2xl font-bold text-blue-600">{fmtNzd(totals.spend)}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Clicks</div>
            <div className="text-2xl font-bold text-gray-900">{totals.clicks.toLocaleString()}</div>
            <div className="text-xs text-gray-400 mt-0.5">CTR {fmtPct(totals.ctr)}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Conversions</div>
            <div className="text-2xl font-bold text-green-600">{totals.conv.toFixed(1)}</div>
            <div className="text-xs text-gray-400 mt-0.5">Conv rate {fmtPct(totals.convRate)}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Avg Cost / Conv</div>
            <div className="text-2xl font-bold text-gray-900">{totals.cpl ? fmtNzd(totals.cpl, 2) : '—'}</div>
            <div className="text-xs text-gray-400 mt-0.5">Avg CPC {totals.cpc ? fmtNzd(totals.cpc, 2) : '—'}</div>
          </div>
        </div>
      )}

      {loading && <div className="text-gray-400 text-sm py-8 text-center">Loading…</div>}

      {!loading && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
          <table className="w-full text-sm border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-gray-50">
                {COLS.map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={`px-3 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200 cursor-pointer select-none whitespace-nowrap hover:bg-gray-100 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                  >
                    {col.label} {sortIcon(col.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id} className={i % 2 === 0 ? 'bg-white hover:bg-gray-50' : 'bg-gray-50 hover:bg-gray-100'}>
                  {COLS.map(col => (
                    <td
                      key={col.key}
                      className={`px-3 py-2.5 border-b border-gray-100 text-sm text-gray-600 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                    >
                      {renderCell(row, col.key)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400">
        Campaign-level data from Google Ads API. Engagement time is live from GA4 (avg active time on site per session).
      </p>
    </div>
  );
}
