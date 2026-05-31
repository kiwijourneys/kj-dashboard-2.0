import React, { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '../context/FilterContext';
import { fetchXeroPnl, fetchXeroMonthly, fetchXeroCostCentres, fetchXeroIncomeByPeriod, fetchMdClosed, fetchSdClosed, fetchGa4RezdyProducts } from '../api';
import KpiCard from '../components/KpiCard';
import {
  BarChart, Bar,
  XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { format, parseISO } from 'date-fns';

const COST_CENTRE_COLORS = {
  'Nelson':         '#22c55e',
  'West Coast':     '#3b82f6',
  'Central Otago':  '#f59e0b',
  'Kawarau Gorge':  '#fb923c',
  'Ferry':          '#a78bfa',
};

const INCOME_TYPE_COLORS = {
  'Multi-Day':  '#22c55e',
  'Single Day': '#3b82f6',
  'Bike Hire':  '#fb923c',
  'Ferry':      '#a78bfa',
  'Other':      '#6b7280',
};

// Clickable legend that dims hidden series
function ToggleLegend({ payload, hidden, onToggle }) {
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
      {payload.map(entry => {
        const isHidden = hidden.has(entry.value);
        return (
          <button
            key={entry.value}
            onClick={() => onToggle(entry.value)}
            className="flex items-center gap-1.5 text-xs transition-opacity"
            style={{ opacity: isHidden ? 0.35 : 1 }}
          >
            <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: entry.color }} />
            <span style={{ color: '#6b7280', textDecoration: isHidden ? 'line-through' : 'none' }}>{entry.value}</span>
          </button>
        );
      })}
    </div>
  );
}

function fmtMonth(yyyyMm) {
  try { return format(parseISO(yyyyMm + '-01'), 'MMM yy'); } catch { return yyyyMm; }
}

function fmtNzd(v) {
  if (v === null || v === undefined) return '—';
  return `$${Number(v).toLocaleString('en-NZ', { maximumFractionDigits: 0 })}`;
}

export default function PulseCheck() {
  const { queryParams } = useFilters();

  const xeroPnlQ     = useQuery({ queryKey: ['xeroPnl',     queryParams], queryFn: () => fetchXeroPnl(queryParams),          retry: 1 });
  const xeroMonthlyQ      = useQuery({ queryKey: ['xeroMonthly',      queryParams], queryFn: () => fetchXeroMonthly(queryParams),        retry: 1 });
  const xeroIncomeByPeriodQ = useQuery({ queryKey: ['xeroIncomeByPeriod', queryParams], queryFn: () => fetchXeroIncomeByPeriod(queryParams), retry: 1,
    enabled: !!(queryParams.startDate && queryParams.endDate) });
  const xeroCcQ      = useQuery({ queryKey: ['xeroCc',      queryParams], queryFn: () => fetchXeroCostCentres(queryParams),   retry: 1,
    enabled: !!(queryParams.startDate && queryParams.endDate) });
  const mdClosedQ      = useQuery({ queryKey: ['mdClosed',      queryParams], queryFn: () => fetchMdClosed(queryParams) });
  const sdClosedQ      = useQuery({ queryKey: ['sdClosed',      queryParams], queryFn: () => fetchSdClosed(queryParams) });
  const rezdyProductsQ = useQuery({ queryKey: ['rezdyProducts', queryParams], queryFn: () => fetchGa4RezdyProducts(queryParams) });

  const [hiddenCc, setHiddenCc]       = useState(new Set());
  const [hiddenInc, setHiddenInc]     = useState(new Set());

  const toggleCc  = useCallback(key => setHiddenCc(prev  => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; }), []);
  const toggleInc = useCallback(key => setHiddenInc(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; }), []);

  const xeroNotConfigured = xeroPnlQ.data?.configured === false;
  const xeroConfigured    = !xeroNotConfigured && (xeroPnlQ.data != null || xeroPnlQ.isLoading);

  // Revenue by income type — weekly or monthly depending on date range
  const incomeTypeData = React.useMemo(() => {
    const d = xeroIncomeByPeriodQ.data;
    if (!d?.periods?.length) return [];
    return d.periods.map((period, i) => {
      const row = { period };
      for (const [name, values] of Object.entries(d.incomeByAccount || {})) {
        const n = name.toLowerCase();
        if      (n.includes('multi day') || n.includes('multi-day'))      row['Multi-Day']  = (row['Multi-Day']  || 0) + (values[i] || 0);
        else if (n.includes('day tour')  || n.includes('day tours'))      row['Single Day'] = (row['Single Day'] || 0) + (values[i] || 0);
        else if (n.includes('bike')      || n.includes('hire'))           row['Bike Hire']  = (row['Bike Hire']  || 0) + (values[i] || 0);
        else if (n.includes('ferry'))                                      row['Ferry']      = (row['Ferry']      || 0) + (values[i] || 0);
        else                                                               row['Other']      = (row['Other']      || 0) + (values[i] || 0);
      }
      return row;
    });
  }, [xeroIncomeByPeriodQ.data]);

  return (
    <div className="p-6 space-y-6">

      {/* ── Revenue Metrics (Xero · accrual) ─────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          Recognised Revenue <span className="normal-case font-normal text-gray-600">(Xero · accrual)</span>
        </h2>
        {xeroNotConfigured ? (
          <div className="card text-sm text-gray-500 py-4">
            Xero not connected — run <code className="bg-gray-100 text-gray-700 px-1 rounded">node scripts/xero-auth.js</code> to set up credentials.
          </div>
        ) : (() => {
          const accs   = xeroPnlQ.data?.incomeAccounts || [];
          const sum    = (fn) => accs.filter(fn).reduce((s, a) => s + a.value, 0) || null;
          const mdXero = sum(a => a.name.toLowerCase().includes('multi'));
          const sdXero = sum(a => a.name.toLowerCase().includes('day tour'));
          const bikeX  = sum(a => a.name.toLowerCase().includes('bike'));
          const ferryX = sum(a => a.name.toLowerCase().includes('ferry'));
          const knownX = (mdXero||0) + (sdXero||0) + (bikeX||0) + (ferryX||0);
          const otherX = xeroPnlQ.data?.summary?.income ? xeroPnlQ.data.summary.income - knownX : null;
          return (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <KpiCard label="Total Revenue"   value={xeroPnlQ.data?.summary?.income} format="currency" loading={xeroPnlQ.isLoading} subtitle="Xero total income" />
              <KpiCard label="MD Tour Revenue" value={mdXero}  format="currency" loading={xeroPnlQ.isLoading} subtitle="Package Tour Income — Multi Day" />
              <KpiCard label="SD Tour Revenue" value={sdXero}  format="currency" loading={xeroPnlQ.isLoading} subtitle="Package Tour Income — Day Tours" />
              <KpiCard label="Bike Hire"       value={bikeX}   format="currency" loading={xeroPnlQ.isLoading} subtitle="Bike &amp; Accessory Hire" />
              <KpiCard label="Ferry Income"    value={ferryX}  format="currency" loading={xeroPnlQ.isLoading} subtitle="Ferry Ticket Sales &amp; TDC Tender" />
              <KpiCard label="Other Income"    value={otherX && otherX > 0.5 ? otherX : null} format="currency" loading={xeroPnlQ.isLoading} subtitle="Transport, Shop, Workshop, etc." />
            </div>
          );
        })()}
      </div>

      {/* ── Revenue by Cost Centre (stacked bar) ────────────────────────── */}
      {xeroConfigured && (
        <div className="card">
          <h3 className="text-sm font-medium text-gray-600 mb-1">
            Revenue by Cost Centre
            {xeroCcQ.data && (
              <span className="ml-2 text-xs text-gray-400 font-normal">
                ({xeroCcQ.data.granularity === 'weekly' ? 'weekly' : 'monthly'})
              </span>
            )}
          </h3>
          {xeroCcQ.isLoading ? (
            <div className="h-56 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
          ) : !xeroCcQ.data?.periods?.length ? (
            <div className="h-56 flex items-center justify-center text-gray-600 text-sm">
              Select a date range to see cost centre breakdown
            </div>
          ) : (() => {
            const { periods, data } = xeroCcQ.data;
            const centres = Object.keys(COST_CENTRE_COLORS);
            const chartData = periods.map((period, i) => {
              const row = { period };
              for (const c of centres) row[c] = data[c]?.[i] ?? 0;
              return row;
            });
            return (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="period" tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <YAxis tickFormatter={v => `$${v >= 1000 ? (v/1000).toFixed(0)+'k' : v}`} tick={{ fill: '#6b7280', fontSize: 11 }} width={52} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 6 }}
                    labelStyle={{ color: '#3b3b3b', marginBottom: 4 }}
                    formatter={(v, name) => [`$${v.toLocaleString('en-NZ', { maximumFractionDigits: 0 })}`, name]}
                  />
                  <Legend content={<ToggleLegend hidden={hiddenCc} onToggle={toggleCc} />} />
                  {centres.map((c, idx) => (
                    <Bar key={c} dataKey={c} stackId="rev" fill={COST_CENTRE_COLORS[c]}
                      hide={hiddenCc.has(c)}
                      radius={idx === centres.length - 1 ? [3,3,0,0] : [0,0,0,0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            );
          })()}
        </div>
      )}

      {/* ── Products Sold by Volume ─────────────────────────────────────── */}
      {xeroConfigured && (
        <div className="card overflow-x-auto">
          <h3 className="text-sm font-medium text-gray-600 mb-3">Products Sold by Volume</h3>
          {xeroPnlQ.isLoading ? (
            <div className="h-24 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
          ) : (() => {
            const accs      = xeroPnlQ.data?.incomeAccounts || [];
            const totalRev  = xeroPnlQ.data?.summary?.income || 0;

            // Group Xero accounts into product lines
            const classify = (name) => {
              const n = name.toLowerCase();
              if (n.includes('multi day') || n.includes('multi-day')) return 'Multi-Day Tours';
              if (n.includes('day tour')  || n.includes('day tours'))  return 'Single Day Tours';
              if (n.includes('bike')      || n.includes('hire'))        return 'Bike Hire';
              if (n.includes('ferry'))                                   return 'Ferry';
              return 'Other';
            };

            const grouped = {};
            for (const acc of accs) {
              const type = classify(acc.name);
              if (!grouped[type]) grouped[type] = { revenue: 0, accounts: [] };
              grouped[type].revenue += acc.value;
              grouped[type].accounts.push({ name: acc.name, value: acc.value });
            }

            // Booking counts from HubSpot (anchored to confirmed/close date)
            const mdCount = mdClosedQ.data?.total ?? null;
            const sdCount = sdClosedQ.data?.total ?? null;
            const counts = {
              'Multi-Day Tours':  mdCount,
              'Single Day Tours': sdCount,
              'Bike Hire':        null,
              'Ferry':            null,
              'Other':            null,
            };

            const ORDER = ['Multi-Day Tours', 'Single Day Tours', 'Bike Hire', 'Ferry', 'Other'];

            return (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium uppercase tracking-wide">Product</th>
                    <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium uppercase tracking-wide">Bookings</th>
                    <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium uppercase tracking-wide">Revenue (NZD)</th>
                    <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium uppercase tracking-wide">% of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {ORDER.filter(t => grouped[t]?.revenue > 0).map(type => {
                    const rev = grouped[type]?.revenue || 0;
                    const pct = totalRev > 0 ? (rev / totalRev) * 100 : 0;
                    const cnt = counts[type];
                    return (
                      <tr key={type} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="py-2.5 px-3 text-gray-800 font-medium">{type}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-gray-600">
                          {cnt !== null
                            ? cnt.toLocaleString()
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-gray-900 font-medium">
                          {fmtNzd(rev)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          <span className={pct > 30 ? 'text-[#99ca3c]' : pct > 10 ? 'text-gray-600' : 'text-gray-400'}>
                            {pct.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200">
                    <td className="py-2.5 px-3 text-xs text-gray-500 font-semibold uppercase">Total</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-gray-400 text-xs">
                      {(mdCount !== null || sdCount !== null)
                        ? ((mdCount || 0) + (sdCount || 0)).toLocaleString()
                        : ''}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-gray-900 font-semibold">{fmtNzd(totalRev)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-500 text-xs">100%</td>
                  </tr>
                </tfoot>
              </table>
            );
          })()}
          <p className="mt-3 text-xs text-gray-400 italic">
            Revenue: Xero accrual (anchored to tour start date). Bookings: HubSpot confirmed in period — available for Multi-Day and Single Day only.
          </p>
        </div>
      )}

      {/* ── Revenue by Income Type ───────────────────────────────────────── */}
      {xeroConfigured && (
        <div className="card">
          <h3 className="text-sm font-medium text-gray-600 mb-1">
            Revenue by Income Type
            <span className="ml-2 text-xs text-gray-400 font-normal">
              ({xeroIncomeByPeriodQ.data?.granularity === 'weekly' ? 'weekly' : 'monthly'} · Xero accrual)
            </span>
          </h3>
          {xeroIncomeByPeriodQ.isLoading ? (
            <div className="h-56 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
          ) : incomeTypeData.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-gray-400 text-sm">
              Select a date range to see income type breakdown
            </div>
          ) : (() => {
            const types = Object.keys(INCOME_TYPE_COLORS);
            return (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={incomeTypeData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="period" tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <YAxis tickFormatter={v => `$${v >= 1000 ? (v/1000).toFixed(0)+'k' : v}`} tick={{ fill: '#6b7280', fontSize: 11 }} width={52} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 6 }}
                    labelStyle={{ color: '#3b3b3b', marginBottom: 4 }}
                    formatter={(v, name) => [fmtNzd(v), name]}
                  />
                  <Legend content={<ToggleLegend hidden={hiddenInc} onToggle={toggleInc} />} />
                  {types.map((t, idx) => (
                    <Bar key={t} dataKey={t} stackId="inc" fill={INCOME_TYPE_COLORS[t]}
                      hide={hiddenInc.has(t)}
                      radius={idx === types.length - 1 ? [3,3,0,0] : [0,0,0,0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            );
          })()}
          <p className="mt-2 text-xs text-gray-400 italic">
            Whole-of-business Xero income by product type. Xero cannot filter by region at the income-type level.
          </p>
        </div>
      )}

      {/* ── Single Day / Rezdy Products ──────────────────────────────────── */}
      <div className="card overflow-x-auto">
        <h3 className="text-sm font-medium text-gray-600 mb-3">Single Day Products Sold (Rezdy)</h3>
        {rezdyProductsQ.isLoading ? (
          <div className="h-24 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
        ) : !rezdyProductsQ.data?.products?.length ? (
          <div className="h-24 flex items-center justify-center text-gray-600 text-sm">
            {rezdyProductsQ.isError ? 'Failed to load Rezdy product data' : 'No product data for selected period'}
          </div>
        ) : (() => {
          const { products, totalQuantity, totalRevenue } = rezdyProductsQ.data;
          return (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium uppercase tracking-wide">Product</th>
                    <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium uppercase tracking-wide">Qty Sold</th>
                    <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium uppercase tracking-wide">Revenue (NZD)</th>
                    <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium uppercase tracking-wide">% of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(p => {
                    const pct = totalRevenue > 0 ? (p.revenueNzd / totalRevenue) * 100 : 0;
                    return (
                      <tr key={p.name} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="py-2.5 px-3 text-gray-800 font-medium">{p.name}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-gray-600">{p.quantity.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-gray-900 font-medium">{fmtNzd(p.revenueNzd)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          <span className={pct > 30 ? 'text-[#99ca3c]' : pct > 10 ? 'text-gray-600' : 'text-gray-400'}>
                            {pct.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200">
                    <td className="py-2.5 px-3 text-xs text-gray-500 font-semibold uppercase">Total</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-gray-400 text-xs">{totalQuantity.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-gray-900 font-semibold">{fmtNzd(totalRevenue)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-500 text-xs">100%</td>
                  </tr>
                </tfoot>
              </table>
              <p className="mt-3 text-xs text-gray-400 italic">
                Source: GA4 ecommerce item data from Rezdy purchase events. Revenue is booking value tracked at time of purchase.
              </p>
            </>
          );
        })()}
      </div>

    </div>
  );
}
