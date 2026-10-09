import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '../context/FilterContext';
import {
  fetchGoogleDepotCountry, fetchHubspotCountryDeals,
  fetchGoogleCountryDaily,
} from '../api';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

// ── Constants ────────────────────────────────────────────────────────────────
const DEPOTS = ['Nelson', 'West Coast', 'Central Otago'];  // Kawarau Gorge merged in
const COUNTRIES = ['NZ', 'AUS', 'Other'];
const COUNTRY_LABELS = { NZ: 'New Zealand', AUS: 'Australia', Other: 'International' };

const DEPOT_COLORS = {
  Nelson: '#22c55e',
  'West Coast': '#3b82f6',
  'Central Otago': '#f59e0b',
};

const GOOGLE_COLOR = '#99ca3c';
const ENQ_COLOR    = '#8b5cf6';

// ── Helpers ──────────────────────────────────────────────────────────────────
function normaliseDepot(d) {
  if (d === 'Kawarau Gorge' || d === 'Queenstown') return 'Central Otago';
  return d;
}

function toCountryBucket(raw) {
  if (!raw) return 'Other';
  const c = raw.trim().toLowerCase();
  if (c === 'nz' || c === 'new zealand') return 'NZ';
  if (c === 'au' || c === 'aus' || c === 'australia') return 'AUS';
  return 'Other';
}

function fmtNzd(n, dec = 0) {
  if (!n) return null;
  return n.toLocaleString('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: dec });
}

function nzDateStr(iso) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date(iso));
}

function weekStart(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.abs((new Date(b) - new Date(a)) / 86400000);
}

function fmtLabel(dateStr, granularity) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDate();
  const mon = d.toLocaleString('en-NZ', { month: 'short', timeZone: 'UTC' });
  if (granularity === 'monthly') return mon + ' ' + d.getUTCFullYear().toString().slice(2);
  return `${day} ${mon}`;
}

// ── Summary table cell ───────────────────────────────────────────────────────
function CplBadge({ cpl }) {
  if (cpl == null) return <span className="text-gray-300">—</span>;
  const color = cpl > 500 ? 'text-red-500' : cpl < 100 ? 'text-green-600' : 'text-gray-700';
  return <span className={`font-medium ${color}`}>{fmtNzd(cpl)}</span>;
}

// ── Combined tooltip ─────────────────────────────────────────────────────────
function CombinedTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const spend = payload.find(p => p.dataKey === 'google')?.value || 0;
  const enq   = payload.find(p => p.dataKey === 'enquiries')?.value || 0;
  return (
    <div className="bg-white border border-gray-200 rounded shadow-lg p-3 text-xs">
      <div className="font-medium text-gray-700 mb-2">{label}</div>
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: GOOGLE_COLOR }} />
        <span className="text-gray-600">Spend</span>
        <span className="font-semibold text-gray-800 ml-auto">{fmtNzd(spend, 0) ?? '$0'}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: ENQ_COLOR }} />
        <span className="text-gray-600">Enquiries</span>
        <span className="font-semibold text-gray-800 ml-auto">{enq}</span>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function PerformanceByRegion() {
  const { queryParams } = useFilters();
  const [chartCountry,  setChartCountry]  = useState('Total');   // Total | NZ | AUS
  const [chartDepot,    setChartDepot]    = useState('All');     // All | Nelson | West Coast | Central Otago
  const [granularity,   setGranularity]   = useState('weekly');  // daily | weekly | monthly

  // Summary table queries
  const gMatrixQ  = useQuery({ queryKey: ['g-depot-country', queryParams],  queryFn: () => fetchGoogleDepotCountry(queryParams) });
  const hsQ       = useQuery({ queryKey: ['hs-country-deals', queryParams], queryFn: () => fetchHubspotCountryDeals(queryParams) });

  // Time-series queries
  const gDailyQ   = useQuery({ queryKey: ['g-country-daily', queryParams],  queryFn: () => fetchGoogleCountryDaily(queryParams) });

  const tableLoading = gMatrixQ.isLoading || hsQ.isLoading;
  const chartLoading = gDailyQ.isLoading  || hsQ.isLoading;

  // ── Summary table data ──────────────────────────────────────────────────
  const spendMatrix = useMemo(() => {
    const m = {};
    for (const d of DEPOTS) { m[d] = {}; for (const c of COUNTRIES) m[d][c] = { google: 0 }; }
    if (gMatrixQ.data?.matrix) {
      for (const rawDepot of Object.keys(gMatrixQ.data.matrix)) {
        const depot = normaliseDepot(rawDepot);
        if (!m[depot]) continue;
        const row = gMatrixQ.data.matrix[rawDepot] || {};
        for (const country of COUNTRIES) {
          m[depot][country].google += row[country]?.spendNzd || 0;
        }
      }
    }
    return m;
  }, [gMatrixQ.data]);

  const enquiriesMatrix = useMemo(() => {
    const m = {};
    for (const d of DEPOTS) m[d] = { NZ: 0, AUS: 0, Other: 0 };
    for (const deal of (hsQ.data || [])) {
      const bucket = toCountryBucket(deal.country);
      for (const rawDepot of (deal.regions || [])) {
        const depot = normaliseDepot(rawDepot);
        if (m[depot]) m[depot][bucket]++;
      }
    }
    return m;
  }, [hsQ.data]);

  const cells = useMemo(() => {
    const result = {};
    for (const depot of DEPOTS) {
      result[depot] = {};
      for (const country of COUNTRIES) {
        const spend = spendMatrix[depot]?.[country]?.google || 0;
        const enq   = enquiriesMatrix[depot]?.[country] || 0;
        result[depot][country] = { spend, enquiries: enq, cpl: spend > 0 && enq > 0 ? spend / enq : null };
      }
    }
    return result;
  }, [spendMatrix, enquiriesMatrix]);

  const depotTotals = useMemo(() => {
    const t = {};
    for (const depot of DEPOTS) {
      let spend = 0, enq = 0;
      for (const c of COUNTRIES) { spend += cells[depot]?.[c]?.spend || 0; enq += cells[depot]?.[c]?.enquiries || 0; }
      t[depot] = { spend, enquiries: enq, cpl: spend > 0 && enq > 0 ? spend / enq : null };
    }
    return t;
  }, [cells]);

  const countryTotals = useMemo(() => {
    const t = {};
    for (const country of COUNTRIES) {
      let spend = 0, enq = 0;
      for (const depot of DEPOTS) { spend += cells[depot]?.[country]?.spend || 0; enq += cells[depot]?.[country]?.enquiries || 0; }
      t[country] = { spend, enquiries: enq, cpl: spend > 0 && enq > 0 ? spend / enq : null };
    }
    return t;
  }, [cells]);

  const grandTotal = useMemo(() => {
    let spend = 0, enq = 0;
    for (const d of DEPOTS) { spend += depotTotals[d]?.spend || 0; enq += depotTotals[d]?.enquiries || 0; }
    return { spend, enquiries: enq, cpl: spend > 0 && enq > 0 ? spend / enq : null };
  }, [depotTotals]);

  // ── Chart data ──────────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    const byBucket = {};

    function monthStart(dateStr) {
      return dateStr.slice(0, 7) + '-01';
    }
    const bucket = d => {
      if (granularity === 'daily')   return d;
      if (granularity === 'monthly') return monthStart(d);
      return weekStart(d);
    };
    const ensure = b => { if (!byBucket[b]) byBucket[b] = { date: b, google: 0, enquiries: 0 }; };

    // Google Ads spend rows
    for (const r of (gDailyQ.data || [])) {
      const depot = normaliseDepot(r.depot || '');
      if (chartDepot !== 'All' && depot !== chartDepot) continue;
      if (chartCountry !== 'Total' && r.country !== chartCountry) continue;
      const b = bucket(r.date);
      if (!b) continue;
      ensure(b);
      byBucket[b].google += r.spendNzd || 0;
    }

    // Enquiries — count each deal once
    for (const deal of (hsQ.data || [])) {
      const dc = toCountryBucket(deal.country);
      if (chartCountry !== 'Total' && dc !== chartCountry) continue;
      const dateStr = nzDateStr(deal.createdate);
      if (!dateStr) continue;
      const matches = chartDepot === 'All'
        ? true
        : (deal.regions || []).some(r => normaliseDepot(r) === chartDepot);
      if (!matches) continue;
      const b = bucket(dateStr);
      ensure(b);
      byBucket[b].enquiries++;
    }

    return Object.values(byBucket)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(r => ({ ...r, label: fmtLabel(r.date, granularity) }));
  }, [gDailyQ.data, hsQ.data, chartDepot, chartCountry, granularity]);

  // ── Render ───────────────────────────────────────────────────────────────
  const thBase = 'px-3 py-2 text-xs font-medium text-gray-500 border-b border-gray-200 bg-gray-50';
  const tdBase = 'px-3 py-3 text-right text-sm border-b border-gray-100';

  const CountryTab = ({ value, label }) => (
    <button
      onClick={() => setChartCountry(value)}
      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
        chartCountry === value
          ? 'bg-gray-900 text-white'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      {label}
    </button>
  );

  const DepotBtn = ({ value }) => (
    <button
      onClick={() => setChartDepot(value)}
      className={`px-3 py-1 rounded text-sm font-medium transition-colors border ${
        chartDepot === value
          ? 'border-transparent text-white'
          : 'border-gray-200 text-gray-600 hover:border-gray-300 bg-white'
      }`}
      style={chartDepot === value ? { backgroundColor: value === 'All' ? '#374151' : DEPOT_COLORS[value] } : {}}
    >
      {value}
    </button>
  );

  return (
    <div className="p-6 space-y-8 max-w-full">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Performance by Region</h1>
        <p className="text-sm text-gray-500 mt-1">
          Google Ads spend mapped to HubSpot enquiries, broken down by region and origin market
        </p>
      </div>

      {/* ── Summary KPI cards ── */}
      {!tableLoading && (
        <div className="grid grid-cols-3 gap-4">
          {DEPOTS.map(depot => {
            const t = depotTotals[depot];
            return (
              <div key={depot} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: DEPOT_COLORS[depot] }} />
                  <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">{depot}</span>
                </div>
                <div className="text-xl font-bold text-gray-900">{fmtNzd(t.spend) ?? '$0'}</div>
                <div className="text-sm text-gray-500 mt-1">
                  {t.enquiries} {t.enquiries === 1 ? 'enquiry' : 'enquiries'}
                  {t.cpl != null && <span className="ml-2 text-xs">· {fmtNzd(t.cpl)}/lead</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tableLoading && <div className="text-gray-400 text-sm py-4 text-center">Loading…</div>}

      {/* ── Summary table ── */}
      {!tableLoading && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
          <table className="w-full text-sm border-collapse min-w-[800px]">
            <thead>
              <tr>
                <th className={`${thBase} text-left w-40 border-r border-gray-200`} rowSpan={2}>Region</th>
                {COUNTRIES.map(c => (
                  <th key={c} className={`${thBase} text-center border-r border-gray-200`} colSpan={3}>
                    {COUNTRY_LABELS[c]}
                  </th>
                ))}
                <th className={`${thBase} text-center`} colSpan={3}>Total</th>
              </tr>
              <tr>
                {[...COUNTRIES, 'Total'].map((c, i) => (
                  <React.Fragment key={c}>
                    <th className={`${thBase} text-right ${i === 0 ? 'border-l border-gray-200' : ''}`}>Spend</th>
                    <th className={`${thBase} text-right`}>Leads</th>
                    <th className={`${thBase} text-right ${i < 3 ? 'border-r border-gray-200' : ''}`}>CPL</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {DEPOTS.map((depot, i) => (
                <tr key={depot} className={i % 2 === 0 ? 'bg-white hover:bg-gray-50' : 'bg-gray-50 hover:bg-gray-100'}>
                  <td className="px-4 py-3 font-medium text-gray-700 border-b border-r border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: DEPOT_COLORS[depot] }} />
                      {depot}
                    </div>
                  </td>
                  {COUNTRIES.map((country, ci) => {
                    const cell = cells[depot]?.[country];
                    return (
                      <React.Fragment key={country}>
                        <td className={`${tdBase} text-gray-600 ${ci === 0 ? 'border-l border-gray-200' : ''}`}>
                          {cell?.spend > 0 ? fmtNzd(cell.spend) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className={`${tdBase} text-gray-600`}>
                          {cell?.enquiries > 0 ? cell.enquiries : <span className="text-gray-300">—</span>}
                        </td>
                        <td className={`${tdBase} ${ci < 2 ? 'border-r border-gray-100' : ''}`}>
                          <CplBadge cpl={cell?.cpl ?? null} />
                        </td>
                      </React.Fragment>
                    );
                  })}
                  <td className={`${tdBase} font-semibold text-gray-800 border-l border-gray-200`}>
                    {depotTotals[depot]?.spend > 0 ? fmtNzd(depotTotals[depot].spend) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className={`${tdBase} font-semibold text-gray-800`}>
                    {depotTotals[depot]?.enquiries > 0 ? depotTotals[depot].enquiries : <span className="text-gray-300">—</span>}
                  </td>
                  <td className={`${tdBase}`}>
                    <CplBadge cpl={depotTotals[depot]?.cpl ?? null} />
                  </td>
                </tr>
              ))}
              <tr className="bg-gray-100 font-semibold">
                <td className="px-4 py-3 text-gray-900 border-t border-r border-gray-300">All Regions</td>
                {COUNTRIES.map((country, ci) => {
                  const t = countryTotals[country];
                  return (
                    <React.Fragment key={country}>
                      <td className={`${tdBase} font-semibold text-gray-800 border-t border-gray-200 ${ci === 0 ? 'border-l border-gray-200' : ''}`}>
                        {t.spend > 0 ? fmtNzd(t.spend) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className={`${tdBase} font-semibold text-gray-800 border-t border-gray-200`}>
                        {t.enquiries > 0 ? t.enquiries : <span className="text-gray-400">—</span>}
                      </td>
                      <td className={`${tdBase} border-t border-gray-200 ${ci < 2 ? 'border-r border-gray-200' : ''}`}>
                        <CplBadge cpl={t.cpl} />
                      </td>
                    </React.Fragment>
                  );
                })}
                <td className="px-3 py-3 text-right text-sm font-bold text-gray-900 border-t border-l border-gray-300">{grandTotal.spend > 0 ? fmtNzd(grandTotal.spend) : '—'}</td>
                <td className="px-3 py-3 text-right text-sm font-bold text-gray-900 border-t border-gray-300">{grandTotal.enquiries > 0 ? grandTotal.enquiries : '—'}</td>
                <td className="px-3 py-3 text-right text-sm border-t border-gray-300"><CplBadge cpl={grandTotal.cpl} /></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ── Charts section ── */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-800">Performance over time</h2>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Granularity */}
            <div className="flex gap-1 rounded-lg border border-gray-200 p-0.5 bg-gray-50">
              {['daily','weekly','monthly'].map(g => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  className={`px-3 py-1 rounded text-xs font-medium capitalize transition-colors ${
                    granularity === g ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >{g}</button>
              ))}
            </div>
            <div className="h-5 w-px bg-gray-200" />
            {/* Country tabs */}
            <div className="flex gap-1">
              <CountryTab value="Total"   label="Total" />
              <CountryTab value="NZ"      label="New Zealand" />
              <CountryTab value="AUS"     label="Australia" />
            </div>
            <div className="h-5 w-px bg-gray-200" />
            {/* Region filter */}
            <div className="flex gap-1">
              <DepotBtn value="All" />
              {DEPOTS.map(d => <DepotBtn key={d} value={d} />)}
            </div>
          </div>
        </div>

        {chartLoading && <div className="text-gray-400 text-sm py-8 text-center">Loading…</div>}

        {!chartLoading && chartData.length === 0 && (
          <div className="text-gray-400 text-sm py-8 text-center">No data for this selection</div>
        )}

        {!chartLoading && chartData.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="text-sm font-medium text-gray-700 mb-4">
              {chartDepot === 'All' ? 'All Regions' : chartDepot}
              {chartCountry !== 'Total' && ` · ${COUNTRY_LABELS[chartCountry]}`}
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                <YAxis
                  yAxisId="left"
                  orientation="left"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false} tickLine={false}
                  tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v}`}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11, fill: ENQ_COLOR }}
                  axisLine={false} tickLine={false}
                  allowDecimals={false}
                  width={32}
                />
                <Tooltip content={<CombinedTooltip />} />
                <Legend
                  formatter={v => v === 'google' ? 'Google Ads Spend' : 'Enquiries'}
                  wrapperStyle={{ fontSize: 12 }}
                />
                <Bar    yAxisId="left"  dataKey="google"     name="google"     fill={GOOGLE_COLOR} radius={[3,3,0,0]} />
                <Line  yAxisId="right" dataKey="enquiries"  name="enquiries"  stroke={ENQ_COLOR} strokeWidth={2} dot={{ r: 4, fill: ENQ_COLOR }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Spend = Google Ads only (depot attributed from campaign name). Enquiries = HubSpot deals tagged to each region.
        CPL = Spend ÷ Enquiries. Kawarau Gorge campaigns and Queenstown enquiries are included in Central Otago.
        <span className="text-green-600 ml-2">Green</span> = under $100/lead.
        <span className="text-red-500 ml-1">Red</span> = over $500/lead.
      </p>
    </div>
  );
}
