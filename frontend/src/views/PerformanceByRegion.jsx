import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilter } from '../context/FilterContext';
import { fetchGoogleDepotCountry, fetchMetaDepotCountry, fetchHubspotCountryDeals } from '../api';

const DEPOTS = ['Nelson', 'West Coast', 'Central Otago', 'Kawarau Gorge'];
const COUNTRIES = ['NZ', 'AUS', 'Other'];
const COUNTRY_LABELS = { NZ: 'New Zealand', AUS: 'Australia', Other: 'International' };

const DEPOT_COLORS = {
  Nelson: '#22c55e',
  'West Coast': '#3b82f6',
  'Central Otago': '#f59e0b',
  'Kawarau Gorge': '#a855f7',
};

function toCountryBucket(raw) {
  if (!raw) return 'Other';
  const c = raw.trim().toLowerCase();
  if (c === 'nz' || c === 'new zealand') return 'NZ';
  if (c === 'au' || c === 'aus' || c === 'australia') return 'AUS';
  return 'Other';
}

function fmtNzd(n) {
  if (n == null || isNaN(n) || n === 0) return null;
  return n.toLocaleString('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 0 });
}

function CplBadge({ cpl }) {
  if (cpl == null) return <span className="text-gray-300">—</span>;
  const color = cpl > 500 ? 'text-red-500' : cpl < 100 ? 'text-green-600' : 'text-gray-700';
  return <span className={`font-medium ${color}`}>{fmtNzd(cpl)}</span>;
}

export default function PerformanceByRegion() {
  const { queryParams } = useFilter();

  const gQ  = useQuery({ queryKey: ['g-depot-country', queryParams],  queryFn: () => fetchGoogleDepotCountry(queryParams) });
  const mQ  = useQuery({ queryKey: ['m-depot-country', queryParams],  queryFn: () => fetchMetaDepotCountry(queryParams) });
  const hsQ = useQuery({ queryKey: ['hs-country-deals', queryParams], queryFn: () => fetchHubspotCountryDeals(queryParams) });

  const loading = gQ.isLoading || mQ.isLoading || hsQ.isLoading;

  const spendMatrix = useMemo(() => {
    const m = {};
    for (const d of DEPOTS) {
      m[d] = {};
      for (const c of COUNTRIES) m[d][c] = { google: 0, meta: 0 };
    }
    const applySource = (data, key) => {
      if (!data?.matrix) return;
      for (const depot of DEPOTS) {
        const row = data.matrix[depot] || {};
        for (const country of COUNTRIES) {
          m[depot][country][key] += row[country]?.spendNzd || 0;
        }
      }
    };
    applySource(gQ.data, 'google');
    applySource(mQ.data, 'meta');
    return m;
  }, [gQ.data, mQ.data]);

  const enquiriesMatrix = useMemo(() => {
    const m = {};
    for (const d of DEPOTS) { m[d] = { NZ: 0, AUS: 0, Other: 0 }; }
    for (const deal of (hsQ.data || [])) {
      const bucket = toCountryBucket(deal.country);
      for (const depot of (deal.regions || [])) {
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
        const spend = (spendMatrix[depot]?.[country]?.google || 0) + (spendMatrix[depot]?.[country]?.meta || 0);
        const enquiries = enquiriesMatrix[depot]?.[country] || 0;
        result[depot][country] = { spend, enquiries, cpl: spend > 0 && enquiries > 0 ? spend / enquiries : null };
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

  const thBase = 'px-3 py-2 text-xs font-medium text-gray-500 border-b border-gray-200 bg-gray-50';
  const tdBase = 'px-3 py-3 text-right text-sm border-b border-gray-100';

  return (
    <div className="p-6 space-y-6 max-w-full">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Performance by Region</h1>
        <p className="text-sm text-gray-500 mt-1">
          Ad investment (Google + Meta) mapped to HubSpot enquiries, broken down by region and origin market
        </p>
      </div>

      {loading && <div className="text-gray-400 text-sm py-8 text-center">Loading…</div>}

      {!loading && (
        <>
          {/* Summary KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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

          {/* Detail table */}
          <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
            <table className="w-full text-sm border-collapse min-w-[900px]">
              <thead>
                <tr>
                  <th className={`${thBase} text-left w-44 border-r border-gray-200`} rowSpan={2}>Region</th>
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
                    {/* row total */}
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
                {/* Country totals row */}
                <tr className="bg-gray-100 border-t-2 border-gray-300">
                  <td className="px-4 py-3 font-semibold text-gray-900 border-b border-r border-gray-200">All Regions</td>
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
                  <td className="px-3 py-3 text-right text-sm font-bold text-gray-900 border-t border-l border-gray-200">
                    {grandTotal.spend > 0 ? fmtNzd(grandTotal.spend) : '—'}
                  </td>
                  <td className="px-3 py-3 text-right text-sm font-bold text-gray-900 border-t border-gray-200">
                    {grandTotal.enquiries > 0 ? grandTotal.enquiries : '—'}
                  </td>
                  <td className="px-3 py-3 text-right text-sm border-t border-gray-200">
                    <CplBadge cpl={grandTotal.cpl} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-400">
            Spend = Google Ads + Meta for the selected date range. Enquiries = HubSpot deals tagged to each region.
            CPL = Spend ÷ Enquiries.
            <span className="text-green-600 ml-2">Green</span> = under $100/lead.
            <span className="text-red-500 ml-1">Red</span> = over $500/lead.
          </p>
        </>
      )}
    </div>
  );
}
