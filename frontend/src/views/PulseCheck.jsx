import React, { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '../context/FilterContext';
import { fetchXeroPnl, fetchXeroMonthly, fetchXeroCostCentres, fetchXeroIncomeByPeriod, fetchMdClosed, fetchSdClosed, fetchGa4RezdyProducts } from '../api';
import KpiCard from '../components/KpiCard';
import {
  BarChart, Bar,
  XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { format, parseISO } from 'date-fns';

// ── Google Ads snapshot (last 30 days, as at 9 Oct 2026) ──
const GA_30D_DATE = "9 Oct 2026";
// Engagement rate from Google Ads API (engagements ÷ impressions).
// Only populated for display-type campaigns; SEM/search returns 0 by definition.
const GA_ENGAGE = {
  "Demand Gen (NZ Pilot Test)": 14.52,
  "Pmax - NZ - Queenstown":     37.94,
  "Pmax - NZ - Nelson":         36.01,
  "Pmax - NZ - Cromwell":       46.57,
};
const GA_30D = [
  { campaign:"SEM - AU - Cromwell",                    adGroup:"Trails - Otago Rail Trail",       impr:1609,  clicks:237, cpc:2.59, ctr:14.73, conv:5.00,  cost:612.78, cr:2.11, cpc2:122.56 },
  { campaign:"SEM - NZ - Kawarau Gorge - Multi Day",   adGroup:"Kawarau Gorge Multi Day Tours",   impr:3046,  clicks:330, cpc:1.64, ctr:10.83, conv:2.00,  cost:541.41, cr:0.61, cpc2:270.70 },
  { campaign:"SEM - NZ - Cromwell - Single Day / Bike Hire", adGroup:"Bike Hire",                 impr:1545,  clicks:247, cpc:2.14, ctr:15.99, conv:8.00,  cost:529.28, cr:3.24, cpc2:66.17  },
  { campaign:"SEM - NZ - Hokitika - Trails",           adGroup:"West Coast Wilderness",            impr:1135,  clicks:172, cpc:2.83, ctr:15.15, conv:5.00,  cost:487.54, cr:2.91, cpc2:97.51  },
  { campaign:"SEM - NZ - Nelson - Multi Day",          adGroup:"Cycle Tours",                      impr:1416,  clicks:153, cpc:3.13, ctr:10.81, conv:3.65,  cost:479.53, cr:2.39, cpc2:131.26 },
  { campaign:"SEM - NZ - Queenstown - Single Day / Bike Hire", adGroup:"Bike Hire - Queenstown",  impr:2040,  clicks:209, cpc:2.25, ctr:10.25, conv:2.00,  cost:469.43, cr:0.96, cpc2:234.71 },
  { campaign:"SEM - NZ - Cromwell - Multi Day",        adGroup:"Cycle Tours",                      impr:1012,  clicks:125, cpc:3.71, ctr:12.35, conv:3.00,  cost:463.58, cr:2.40, cpc2:154.53 },
  { campaign:"SEM - NZ - Nelson - Single Day / Bike Hire", adGroup:"Bike Hire - Nelson",           impr:882,   clicks:137, cpc:2.72, ctr:15.53, conv:4.00,  cost:372.14, cr:2.92, cpc2:93.03  },
  { campaign:"SEM - AU - Nelson",                      adGroup:"Cycle Tours",                      impr:287,   clicks:50,  cpc:7.33, ctr:17.42, conv:0.50,  cost:366.50, cr:1.00, cpc2:733.00 },
  { campaign:"SEM - NZ - Hokitika - Multi Day",        adGroup:"Cycle Tours",                      impr:532,   clicks:87,  cpc:3.80, ctr:16.35, conv:4.05,  cost:330.60, cr:4.66, cpc2:81.58  },
  { campaign:"SEM - NZ - Cromwell - Trails",           adGroup:"Otago Rail Trail",                 impr:2040,  clicks:253, cpc:1.19, ctr:12.40, conv:6.00,  cost:300.07, cr:2.37, cpc2:50.01  },
  { campaign:"SEM - NZ - Competitor",                  adGroup:"Central Otago",                    impr:1297,  clicks:84,  cpc:3.57, ctr:6.48,  conv:2.00,  cost:299.57, cr:2.38, cpc2:149.79 },
  { campaign:"SEM - AU - Kawarau Gorge",               adGroup:"Kawarau Gorge Trail",              impr:1091,  clicks:170, cpc:1.76, ctr:15.58, conv:0.00,  cost:298.75, cr:0.00, cpc2:0      },
  { campaign:"SEM - AU - Cromwell",                    adGroup:"Bike Hire",                        impr:841,   clicks:90,  cpc:3.25, ctr:10.70, conv:0.00,  cost:292.59, cr:0.00, cpc2:0      },
  { campaign:"SEM - AU - Nelson",                      adGroup:"Trails - Great Taste Trail",       impr:271,   clicks:45,  cpc:6.21, ctr:16.61, conv:2.19,  cost:279.55, cr:4.86, cpc2:127.81 },
  { campaign:"Demand Gen (NZ Pilot Test)",             adGroup:"Interests",                        impr:60811, clicks:520, cpc:0.54, ctr:0.86,  conv:0.00,  cost:278.97, cr:0.00, cpc2:0      },
  { campaign:"SEM - AU - Kawarau Gorge",               adGroup:"Kawarau Gorge Multi Day Tours",   impr:440,   clicks:59,  cpc:4.49, ctr:13.41, conv:4.00,  cost:264.72, cr:6.78, cpc2:66.18  },
  { campaign:"SEM - AU - Cromwell",                    adGroup:"Cycle Tours",                      impr:514,   clicks:68,  cpc:3.86, ctr:13.23, conv:4.00,  cost:262.70, cr:5.88, cpc2:65.68  },
  { campaign:"Demand Gen (NZ Pilot Test)",             adGroup:"Lookalikes",                       impr:50735, clicks:829, cpc:0.30, ctr:1.63,  conv:0.00,  cost:249.06, cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Cromwell - Trails",           adGroup:"Lake Dunstan Trail",               impr:1547,  clicks:180, cpc:1.18, ctr:11.64, conv:2.00,  cost:211.78, cr:1.11, cpc2:105.89 },
  { campaign:"SEM - NZ - Cromwell - Multi Day",        adGroup:"Multi Day",                        impr:798,   clicks:69,  cpc:3.07, ctr:8.65,  conv:1.00,  cost:211.53, cr:1.45, cpc2:211.53 },
  { campaign:"SEM - NZ - Brand",                       adGroup:"Brand",                            impr:681,   clicks:220, cpc:0.86, ctr:32.31, conv:14.61, cost:189.89, cr:6.64, cpc2:12.99  },
  { campaign:"SEM - AU - Hokitika",                    adGroup:"Trails - West Coast Wilderness",   impr:157,   clicks:43,  cpc:4.41, ctr:27.39, conv:1.00,  cost:189.62, cr:2.33, cpc2:189.62 },
  { campaign:"SEM - NZ - Nelson - Trails - In-market", adGroup:"Great Taste Trail",                impr:645,   clicks:80,  cpc:2.35, ctr:12.40, conv:0.00,  cost:188.08, cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Nelson - Trails",             adGroup:"Great Taste Trail",                impr:644,   clicks:113, cpc:1.66, ctr:17.55, conv:4.00,  cost:188.07, cr:3.54, cpc2:47.02  },
  { campaign:"SEM - NZ - Hokitika - Single Day / Bike Hire", adGroup:"Bike Hire",                 impr:219,   clicks:47,  cpc:3.98, ctr:21.46, conv:0.00,  cost:186.84, cr:0.00, cpc2:0      },
  { campaign:"SEM - AU - Cromwell",                    adGroup:"Trails - Lake Dunstan Trail",      impr:493,   clicks:74,  cpc:2.37, ctr:15.01, conv:2.00,  cost:175.23, cr:2.70, cpc2:87.61  },
  { campaign:"SEM - NZ - Cromwell - Trails - In-market", adGroup:"Lake Dunstan Trail",            impr:465,   clicks:62,  cpc:2.24, ctr:13.33, conv:5.00,  cost:139.15, cr:8.06, cpc2:27.83  },
  { campaign:"SEM - AU - Nelson",                      adGroup:"Bike Hire",                        impr:135,   clicks:17,  cpc:7.46, ctr:12.59, conv:1.00,  cost:126.79, cr:5.88, cpc2:126.79 },
  { campaign:"SEM - NZ - Hokitika - Trails - In-market", adGroup:"West Coast Wilderness",         impr:209,   clicks:26,  cpc:3.61, ctr:12.44, conv:0.00,  cost:93.91,  cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Competitor",                  adGroup:"West Coast",                       impr:379,   clicks:23,  cpc:4.02, ctr:6.07,  conv:1.00,  cost:92.42,  cr:4.35, cpc2:92.42  },
  { campaign:"SEM - NZ - Queenstown - Single Day / Bike Hire", adGroup:"Single Day - Queenstown", impr:451,   clicks:30,  cpc:2.95, ctr:6.65,  conv:0.00,  cost:88.48,  cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Nelson - Single Day / Bike Hire", adGroup:"Bike Hire - Mapua",           impr:90,    clicks:37,  cpc:1.88, ctr:41.11, conv:1.43,  cost:69.49,  cr:3.87, cpc2:48.56  },
  { campaign:"SEM - AU - Hokitika",                    adGroup:"Bike Hire",                        impr:73,    clicks:12,  cpc:5.49, ctr:16.44, conv:1.00,  cost:65.91,  cr:8.33, cpc2:65.91  },
  { campaign:"SEM - NZ - Cromwell - Trails - In-market", adGroup:"Otago Rail Trail",              impr:181,   clicks:22,  cpc:2.59, ctr:12.15, conv:0.00,  cost:56.92,  cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Cromwell - Trails",           adGroup:"Wine Tour",                        impr:244,   clicks:26,  cpc:1.75, ctr:10.66, conv:1.00,  cost:45.58,  cr:3.85, cpc2:45.58  },
  { campaign:"SEM - NZ - Competitor",                  adGroup:"Nelson",                           impr:247,   clicks:10,  cpc:4.45, ctr:4.05,  conv:0.00,  cost:44.52,  cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Cromwell - Trails - In-market", adGroup:"Wine Tour",                     impr:188,   clicks:15,  cpc:2.74, ctr:7.98,  conv:0.00,  cost:41.12,  cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Cromwell - Trails",           adGroup:"Roxburgh Gorge Trail",             impr:241,   clicks:28,  cpc:1.46, ctr:11.62, conv:0.00,  cost:40.84,  cr:0.00, cpc2:0      },
  { campaign:"SEM - AU - Hokitika",                    adGroup:"Cycle Tours",                      impr:35,    clicks:5,   cpc:6.04, ctr:14.29, conv:0.00,  cost:30.19,  cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Cromwell - Trails",           adGroup:"Clutha Gold Trail",                impr:283,   clicks:28,  cpc:1.05, ctr:9.89,  conv:1.00,  cost:29.46,  cr:3.57, cpc2:29.46  },
  { campaign:"SEM - AU - Cromwell",                    adGroup:"Trails - Clutha Gold Trail",       impr:53,    clicks:11,  cpc:1.86, ctr:20.75, conv:0.00,  cost:20.48,  cr:0.00, cpc2:0      },
  { campaign:"SEM - AU - Cromwell",                    adGroup:"Trails - Roxburgh Gorge Trail",    impr:43,    clicks:5,   cpc:2.64, ctr:11.63, conv:0.00,  cost:13.19,  cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Queenstown - Single Day / Bike Hire", adGroup:"Bike Hire - Gibbston",    impr:68,    clicks:5,   cpc:2.07, ctr:7.35,  conv:0.00,  cost:10.34,  cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Cromwell - Trails - In-market", adGroup:"Clutha Gold Trail",             impr:20,    clicks:5,   cpc:1.21, ctr:25.00, conv:0.00,  cost:6.06,   cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Competitor",                  adGroup:"Trail Journeys",                   impr:24,    clicks:1,   cpc:2.88, ctr:4.17,  conv:0.00,  cost:2.88,   cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Cromwell - Trails - In-market", adGroup:"Roxburgh Gorge Trail",          impr:15,    clicks:2,   cpc:1.38, ctr:13.33, conv:0.00,  cost:2.76,   cr:0.00, cpc2:0      },
  { campaign:"SEM - AU - Cromwell",                    adGroup:"Trails - Wine Tour",               impr:35,    clicks:2,   cpc:1.29, ctr:5.71,  conv:0.00,  cost:2.57,   cr:0.00, cpc2:0      },
  { campaign:"SEM - AU - Cromwell",                    adGroup:"Single Day",                       impr:4,     clicks:1,   cpc:1.85, ctr:25.00, conv:0.00,  cost:1.85,   cr:0.00, cpc2:0      },
  { campaign:"Pmax - NZ - Queenstown",                 adGroup:"(Performance Max)",                impr:3848,  clicks:139, cpc:2.01, ctr:3.61,  conv:0.00,  cost:279.53, cr:0.00, cpc2:0      },
  { campaign:"Pmax - NZ - Nelson",                     adGroup:"(Performance Max)",                impr:4049,  clicks:105, cpc:1.86, ctr:2.59,  conv:0.00,  cost:194.95, cr:0.00, cpc2:0      },
  { campaign:"Pmax - NZ - Cromwell",                   adGroup:"(Performance Max)",                impr:4325,  clicks:142, cpc:1.05, ctr:3.28,  conv:0.00,  cost:149.10, cr:0.00, cpc2:0      },
];

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

// Standalone clickable legend — rendered outside Recharts
// hidden is a plain object { [name]: true } for hidden series
function ToggleLegend({ colorMap, hidden, onToggle }) {
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2 mb-1">
      {Object.entries(colorMap).map(([name, color]) => {
        const isHidden = !!hidden[name];
        return (
          <button
            key={name}
            onClick={() => onToggle(name)}
            className="flex items-center gap-1.5 text-xs transition-opacity select-none"
            style={{ opacity: isHidden ? 0.35 : 1 }}
          >
            <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
            <span style={{ color: '#6b7280', textDecoration: isHidden ? 'line-through' : 'none' }}>{name}</span>
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
  const { queryParams, region } = useFilters();

  const xeroPnlQ     = useQuery({ queryKey: ['xeroPnl',     queryParams], queryFn: () => fetchXeroPnl(queryParams),          retry: 1 });
  const xeroMonthlyQ      = useQuery({ queryKey: ['xeroMonthly',      queryParams], queryFn: () => fetchXeroMonthly(queryParams),        retry: 1 });
  const xeroIncomeByPeriodQ = useQuery({ queryKey: ['xeroIncomeByPeriod', queryParams], queryFn: () => fetchXeroIncomeByPeriod(queryParams), retry: 1,
    enabled: !!(queryParams.startDate && queryParams.endDate) });
  const xeroCcQ      = useQuery({ queryKey: ['xeroCc',      queryParams], queryFn: () => fetchXeroCostCentres(queryParams),   retry: 1,
    enabled: !!(queryParams.startDate && queryParams.endDate) });
  const mdClosedQ      = useQuery({ queryKey: ['mdClosed',      queryParams], queryFn: () => fetchMdClosed(queryParams) });
  const sdClosedQ      = useQuery({ queryKey: ['sdClosed',      queryParams], queryFn: () => fetchSdClosed(queryParams) });
  const rezdyProductsQ = useQuery({ queryKey: ['rezdyProducts', queryParams], queryFn: () => fetchGa4RezdyProducts(queryParams) });

  const [hiddenCc,  setHiddenCc]  = useState({});
  const [hiddenInc, setHiddenInc] = useState({});
  const [gaSortCol, setGaSortCol] = useState("cost");
  const [gaSortDir, setGaSortDir] = useState("desc");

  const toggleCc  = useCallback(key => setHiddenCc(prev  => ({ ...prev, [key]: !prev[key] })), []);
  const toggleInc = useCallback(key => setHiddenInc(prev => ({ ...prev, [key]: !prev[key] })), []);

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
            const allCentres = Object.keys(COST_CENTRE_COLORS);
            // When a region is selected, only show that region's bar
            const centres = region ? allCentres.filter(c => c === region) : allCentres;
            const colorMap = Object.fromEntries(centres.map(c => [c, COST_CENTRE_COLORS[c]]));
            const chartData = periods.map((period, i) => {
              const row = { period };
              for (const c of centres) row[c] = data[c]?.[i] ?? 0;
              return row;
            });
            return (
              <>
                {centres.length > 1 && (
                  <ToggleLegend colorMap={colorMap} hidden={hiddenCc} onToggle={toggleCc} />
                )}
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
                    {centres.filter(c => !hiddenCc[c]).map((c, idx, arr) => (
                      <Bar key={c} dataKey={c} stackId="rev" fill={COST_CENTRE_COLORS[c]}
                        radius={idx === arr.length - 1 ? [3,3,0,0] : [0,0,0,0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </>
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
              <>
              <ToggleLegend colorMap={INCOME_TYPE_COLORS} hidden={hiddenInc} onToggle={toggleInc} />
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
                  {types.filter(t => !hiddenInc[t]).map((t, idx, arr) => (
                    <Bar key={t} dataKey={t} stackId="inc" fill={INCOME_TYPE_COLORS[t]}
                      radius={idx === arr.length - 1 ? [3,3,0,0] : [0,0,0,0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
              </>
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

      {/* ── Google Ads Campaigns ────────────────────────────────────────── */}
      {(() => {
        const sorted = [...GA_30D].sort((a, b) => {
          const v = gaSortDir === "asc" ? 1 : -1;
          return (a[gaSortCol] - b[gaSortCol]) * v;
        });
        const totals = GA_30D.reduce((acc, r) => ({
          impr: acc.impr + r.impr, clicks: acc.clicks + r.clicks,
          conv: acc.conv + r.conv, cost: acc.cost + r.cost,
        }), { impr: 0, clicks: 0, conv: 0, cost: 0 });
        const totCtr  = totals.clicks / totals.impr * 100;
        const totCpc  = totals.cost / totals.clicks;
        const totCr   = totals.conv / totals.clicks * 100;
        const totCpc2 = totals.conv > 0 ? totals.cost / totals.conv : 0;
        const thClick = (col, label) => (
          <th key={col} onClick={() => { setGaSortDir(d => gaSortCol === col && d === "desc" ? "asc" : "desc"); setGaSortCol(col); }}
            className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase cursor-pointer select-none whitespace-nowrap hover:text-blue-600">
            {label}{gaSortCol === col ? (gaSortDir === "asc" ? " ▲" : " ▼") : ""}
          </th>
        );
        return (
          <div className="card overflow-x-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-600">Google Ads — Campaigns &amp; Ad Groups</h3>
              <span className="text-xs text-gray-400">Last 30 days · as at {GA_30D_DATE} · {GA_30D.length} ad groups</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Spend (NZD)</div>
                <div className="text-xl font-semibold text-blue-600">${totals.cost.toLocaleString('en-NZ', {maximumFractionDigits:0})}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Clicks</div>
                <div className="text-xl font-semibold text-gray-800">{totals.clicks.toLocaleString()}</div>
                <div className="text-xs text-gray-400">CTR {totCtr.toFixed(2)}%</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Conversions</div>
                <div className="text-xl font-semibold text-green-600">{totals.conv.toFixed(1)}</div>
                <div className="text-xs text-gray-400">Conv rate {totCr.toFixed(2)}%</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Avg Cost / Conv</div>
                <div className="text-xl font-semibold text-gray-800">{totCpc2 > 0 ? `$${totCpc2.toFixed(2)}` : '—'}</div>
                <div className="text-xs text-gray-400">Avg CPC ${totCpc.toFixed(2)}</div>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  {thClick("campaign","Campaign")}
                  {thClick("adGroup","Ad Group")}
                  {thClick("impr","Impr.")}
                  {thClick("clicks","Clicks")}
                  {thClick("cpc","Avg CPC")}
                  {thClick("ctr","CTR %")}
                  {thClick("conv","Conv.")}
                  {thClick("cost","Cost")}
                  {thClick("cr","Conv %")}
                  {thClick("cpc2","Cost/Conv")}
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">
                    Eng. Rate <span className="text-gray-300 font-normal normal-case">(display)</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => {
                  const engRate = GA_ENGAGE[r.campaign];
                  return (
                    <tr key={i} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="py-2 px-3 text-xs text-gray-700 max-w-[200px] truncate">{r.campaign}</td>
                      <td className="py-2 px-3 text-xs text-gray-500 max-w-[160px] truncate">{r.adGroup}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-xs">{r.impr.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-xs">{r.clicks.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-xs">${r.cpc.toFixed(2)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-xs">{r.ctr.toFixed(2)}%</td>
                      <td className="py-2 px-3 text-right tabular-nums text-xs">{r.conv.toFixed(2)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-xs font-medium">${r.cost.toFixed(2)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-xs">{r.cr.toFixed(2)}%</td>
                      <td className="py-2 px-3 text-right tabular-nums text-xs">{r.cpc2 > 0 ? `$${r.cpc2.toFixed(2)}` : '—'}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-xs">
                        {engRate != null
                          ? <span className="font-medium text-purple-600">{engRate.toFixed(1)}%</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-gray-200 bg-blue-50 font-semibold">
                  <td className="py-2 px-3 text-xs" colSpan={2}>TOTAL</td>
                  <td className="py-2 px-3 text-right tabular-nums text-xs">{totals.impr.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-xs">{totals.clicks.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-xs">${totCpc.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-xs">{totCtr.toFixed(2)}%</td>
                  <td className="py-2 px-3 text-right tabular-nums text-xs">{totals.conv.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-xs">${totals.cost.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-xs">{totCr.toFixed(2)}%</td>
                  <td className="py-2 px-3 text-right tabular-nums text-xs">${totCpc2.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right text-xs text-gray-400">—</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-3 text-xs text-gray-400 italic">
              Click column headers to sort. Engagement rate (purple) applies to Demand Gen and Performance Max campaigns only —
              Google Ads search campaigns don't report this metric. Snapshot as at {GA_30D_DATE}.
            </p>
          </div>
        );
      })()}

    </div>
  );
}
