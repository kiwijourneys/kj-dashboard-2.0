import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '../context/FilterContext';
import { fetchGa4CampaignEngagement } from '../api';

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
  { campaign:"SEM - NZ - Nelson - Trails - In-market", adGroup:"Nelson Trails",                   impr:169,   clicks:18,  cpc:2.97, ctr:10.65, conv:0.00,  cost:53.48,  cr:0.00, cpc2:0      },
  { campaign:"SEM - AU - Kawarau Gorge",               adGroup:"Bike Hire",                        impr:123,   clicks:19,  cpc:2.75, ctr:15.45, conv:0.00,  cost:52.23,  cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Cromwell - Single Day / Bike Hire", adGroup:"Single Day",               impr:398,   clicks:35,  cpc:1.27, ctr:8.79,  conv:0.00,  cost:44.52,  cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Hokitika - Trails - In-market", adGroup:"West Coast Wilderness Trail",  impr:96,    clicks:13,  cpc:2.89, ctr:13.54, conv:0.00,  cost:37.55,  cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Brand",                       adGroup:"KJ Brand",                        impr:189,   clicks:46,  cpc:0.73, ctr:24.34, conv:0.00,  cost:33.60,  cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Queenstown - Multi Day",      adGroup:"Queenstown Multi Day",            impr:247,   clicks:24,  cpc:1.18, ctr:9.72,  conv:0.00,  cost:28.41,  cr:0.00, cpc2:0      },
  { campaign:"SEM - AU - Nelson",                      adGroup:"Multi Day Tours",                 impr:82,    clicks:9,   cpc:2.79, ctr:10.98, conv:0.00,  cost:25.10,  cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Queenstown - Single Day / Bike Hire", adGroup:"Bike Hire - Gibbston",   impr:156,   clicks:16,  cpc:1.34, ctr:10.26, conv:0.00,  cost:21.42,  cr:0.00, cpc2:0      },
  { campaign:"SEM - AU - Cromwell",                    adGroup:"Multi Day",                       impr:97,    clicks:10,  cpc:1.98, ctr:10.31, conv:0.00,  cost:19.82,  cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Nelson - Multi Day",          adGroup:"Nelson Cycle Tours",              impr:64,    clicks:6,   cpc:2.98, ctr:9.38,  conv:0.00,  cost:17.90,  cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Hokitika - Multi Day",        adGroup:"West Coast Multi Day",            impr:36,    clicks:5,   cpc:2.71, ctr:13.89, conv:0.00,  cost:13.53,  cr:0.00, cpc2:0      },
  { campaign:"SEM - NZ - Queenstown - Multi Day",      adGroup:"Queenstown Tours",                impr:45,    clicks:4,   cpc:1.75, ctr:8.89,  conv:0.00,  cost:7.01,   cr:0.00, cpc2:0      },
  { campaign:"SEM - AU - Hokitika",                    adGroup:"Multi Day West Coast",            impr:28,    clicks:3,   cpc:2.01, ctr:10.71, conv:0.00,  cost:6.02,   cr:0.00, cpc2:0      },
  { campaign:"Pmax - NZ - Queenstown",                 adGroup:"(Performance Max)",               impr:3848,  clicks:139, cpc:2.01, ctr:3.61,  conv:0.00,  cost:279.53, cr:0.00, cpc2:0      },
  { campaign:"Pmax - NZ - Nelson",                     adGroup:"(Performance Max)",               impr:4049,  clicks:105, cpc:1.86, ctr:2.59,  conv:0.00,  cost:194.95, cr:0.00, cpc2:0      },
  { campaign:"Pmax - NZ - Cromwell",                   adGroup:"(Performance Max)",               impr:4325,  clicks:142, cpc:1.05, ctr:3.28,  conv:0.00,  cost:149.10, cr:0.00, cpc2:0      },
];

function fmtSec(sec) {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function GoogleAdsView() {
  const { queryParams } = useFilters();
  const [sortCol, setSortCol] = useState("cost");
  const [sortDir, setSortDir] = useState("desc");

  // Live engagement time from GA4 (keyed by campaign name)
  const engQ = useQuery({
    queryKey: ['ga4CampaignEngagement', queryParams],
    queryFn: () => fetchGa4CampaignEngagement(queryParams),
    staleTime: 5 * 60 * 1000,
  });
  const engMap = {};
  if (Array.isArray(engQ.data)) {
    for (const row of engQ.data) engMap[row.campaign] = row.avgEngagementSec;
  }

  const sorted = [...GA_30D].sort((a, b) => {
    const v = sortDir === "asc" ? 1 : -1;
    if (sortCol === "engTime") {
      const av = engMap[a.campaign] ?? -1;
      const bv = engMap[b.campaign] ?? -1;
      return (av - bv) * v;
    }
    return (a[sortCol] - b[sortCol]) * v;
  });

  const totals = GA_30D.reduce((acc, r) => ({
    impr: acc.impr + r.impr, clicks: acc.clicks + r.clicks,
    conv: acc.conv + r.conv, cost: acc.cost + r.cost,
  }), { impr: 0, clicks: 0, conv: 0, cost: 0 });

  const totCtr  = totals.clicks / totals.impr * 100;
  const totCpc  = totals.cost / totals.clicks;
  const totCr   = totals.conv / totals.clicks * 100;
  const totCpc2 = totals.conv > 0 ? totals.cost / totals.conv : 0;

  function thClick(col, label, title) {
    const active = sortCol === col;
    return (
      <th
        key={col}
        title={title}
        onClick={() => { setSortDir(d => active && d === "desc" ? "asc" : "desc"); setSortCol(col); }}
        className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase cursor-pointer select-none whitespace-nowrap hover:text-blue-600"
      >
        {label}{active ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
      </th>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-600">Google Ads — Campaigns &amp; Ad Groups</h3>
          <span className="text-xs text-gray-400">
            Spend/clicks snapshot · as at {GA_30D_DATE} · engagement time live from GA4
            {engQ.isLoading && <span className="ml-2 text-blue-400">loading…</span>}
            {engQ.isError && <span className="ml-2 text-red-400">engagement time unavailable</span>}
          </span>
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
              {thClick("campaign", "Campaign")}
              {thClick("adGroup", "Ad Group")}
              {thClick("impr", "Impr.")}
              {thClick("clicks", "Clicks")}
              {thClick("cpc", "Avg CPC")}
              {thClick("ctr", "CTR %")}
              {thClick("conv", "Conv.")}
              {thClick("cost", "Cost")}
              {thClick("cr", "Conv %")}
              {thClick("cpc2", "Cost/Conv")}
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">
                Eng. Rate <span className="text-gray-300 font-normal normal-case">(display)</span>
              </th>
              {thClick("engTime", "Avg Eng. Time", "Average engagement time from GA4 — time users actively engaged with the site per session from this campaign")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const engRate = GA_ENGAGE[r.campaign];
              const engSec  = engMap[r.campaign];
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
                  <td className="py-2 px-3 text-right tabular-nums text-xs">
                    {engQ.isLoading
                      ? <span className="text-gray-300">…</span>
                      : engSec != null
                        ? <span className="font-medium text-teal-600">{fmtSec(engSec)}</span>
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
              <td className="py-2 px-3 text-right text-xs text-gray-400">—</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-xs text-gray-400 italic">
          Click column headers to sort. Engagement rate (purple) applies to Demand Gen and Performance Max campaigns only —
          Google Ads search campaigns don't report this metric. Snapshot data as at {GA_30D_DATE}.
          Avg Eng. Time (teal) is live from GA4 — time users actively engaged with the site per session originating from each campaign.
        </p>
      </div>
    </div>
  );
}
