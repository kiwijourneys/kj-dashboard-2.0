import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFilters } from '../context/FilterContext';
import { fetchMarketingPerformance } from '../api';
import ErrorWidget from '../components/ErrorWidget';

const DEPOTS = ['Nelson', 'West Coast', 'Central Otago', 'Kawarau Gorge'];

function fmtCurrency(v, dp = 0) {
  if (v === null || v === undefined) return '—';
  return `$${Number(v).toLocaleString('en-NZ', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}
function fmtPercent(v, dp = 1) {
  if (v === null || v === undefined) return '—';
  return `${Number(v).toFixed(dp)}%`;
}
function fmtRoas(v) {
  if (v === null || v === undefined) return '—';
  return `${Number(v).toFixed(2)}x`;
}
function fmtNum(v, dp = 0) {
  if (v === null || v === undefined) return '—';
  return Number(v).toLocaleString('en-NZ', { maximumFractionDigits: dp });
}
function fmtDays(v) {
  if (v === null || v === undefined) return '—';
  return `${Number(v).toFixed(1)}d`;
}

// rows: [{ label, fmt, total, byDepot }]
function MetricTable({ title, rows, loading }) {
  return (
    <div className="card">
      <h3 className="text-sm font-medium text-gray-600 mb-3">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wide">Metric</th>
              <th className="text-right py-2 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wide">Total</th>
              {DEPOTS.map(d => (
                <th key={d} className="text-right py-2 px-3 text-xs text-gray-500 font-semibold uppercase tracking-wide">{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: rows.length || 3 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-100 animate-pulse">
                  <td className="py-3 px-3"><div className="h-3 bg-gray-100 rounded w-40" /></td>
                  {[0, ...DEPOTS].map((_, j) => (
                    <td key={j} className="py-3 px-3 text-right"><div className="h-3 bg-gray-100 rounded w-16 ml-auto" /></td>
                  ))}
                </tr>
              ))
            ) : (
              rows.map(row => (
                <tr key={row.label} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="py-2.5 px-3 text-gray-800 font-medium">{row.label}</td>
                  <td className="py-2.5 px-3 text-right text-gray-900 font-semibold">{row.fmt(row.total)}</td>
                  {DEPOTS.map(d => (
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

export default function MarketingPerformance() {
  const { queryParams } = useFilters();
  const { startDate, endDate } = queryParams;

  const perfQ = useQuery({
    queryKey: ['marketingPerformance', startDate, endDate],
    queryFn: () => fetchMarketingPerformance({ startDate, endDate }),
    enabled: !!(startDate && endDate),
    retry: 1,
  });

  if (perfQ.isError) {
    return (
      <div className="p-6">
        <ErrorWidget message={perfQ.error?.message} onRetry={() => perfQ.refetch()} />
      </div>
    );
  }

  const d = perfQ.data;
  const loading = perfQ.isLoading || !d;

  const costPerEnquiryRows = loading ? [] : [
    { label: '$/MD Enquiry', fmt: v => fmtCurrency(v, 0), total: d.costPerEnquiry.md.total, byDepot: d.costPerEnquiry.md.byDepot },
    { label: '$/SD Enquiry', fmt: v => fmtCurrency(v, 0), total: d.costPerEnquiry.sd.total, byDepot: d.costPerEnquiry.sd.byDepot },
  ];

  const attributedRows = loading ? [] : [
    { label: '$/Attributed Meta MD Enquiries',  fmt: v => fmtCurrency(v, 0), total: d.attributedPerformance.metaMdEnquiries.total, byDepot: d.attributedPerformance.metaMdEnquiries.byDepot },
    { label: '$/Attributed GAds MD Enquiries',  fmt: v => fmtCurrency(v, 0), total: d.attributedPerformance.gadsMdEnquiries.total, byDepot: d.attributedPerformance.gadsMdEnquiries.byDepot },
    { label: '$/Attributed Meta SD Enquiries',  fmt: v => fmtCurrency(v, 0), total: d.attributedPerformance.metaSdEnquiries.total, byDepot: d.attributedPerformance.metaSdEnquiries.byDepot },
    { label: '$/Attributed GAds SD Enquiries',  fmt: v => fmtCurrency(v, 0), total: d.attributedPerformance.gadsSdEnquiries.total, byDepot: d.attributedPerformance.gadsSdEnquiries.byDepot },
    { label: '$/Attributed Meta Leads/Results', fmt: v => fmtCurrency(v, 2), total: d.attributedPerformance.metaLeadsResults.total, byDepot: d.attributedPerformance.metaLeadsResults.byDepot },
    { label: '$/Attributed GAds Conversions',   fmt: v => fmtCurrency(v, 2), total: d.attributedPerformance.gadsConversions.total, byDepot: d.attributedPerformance.gadsConversions.byDepot },
  ];

  const costRoiRows = loading ? [] : [
    { label: 'Total Ad Spend', fmt: v => fmtCurrency(v, 0), total: d.costRoi.totalAdSpend.total, byDepot: d.costRoi.totalAdSpend.byDepot },
    { label: 'ROAS MD',        fmt: fmtRoas,                total: d.costRoi.roasMd.total,        byDepot: d.costRoi.roasMd.byDepot },
    { label: 'ROAS SD',        fmt: fmtRoas,                total: d.costRoi.roasSd.total,        byDepot: d.costRoi.roasSd.byDepot },
  ];

  const leadQualityRows = loading ? [] : [
    { label: 'Lead-to-Opportunity Rate (MD)',  fmt: fmtPercent, total: d.leadQuality.leadToOpportunityRateMd.total,  byDepot: d.leadQuality.leadToOpportunityRateMd.byDepot },
    { label: 'Lead-to-Opportunity Rate (SD)',  fmt: fmtPercent, total: d.leadQuality.leadToOpportunityRateSd.total,  byDepot: d.leadQuality.leadToOpportunityRateSd.byDepot },
    { label: 'Opportunity-to-Close Rate (MD)', fmt: fmtPercent, total: d.leadQuality.opportunityToCloseRateMd.total, byDepot: d.leadQuality.opportunityToCloseRateMd.byDepot },
  ];

  const channelRows = loading ? [] : [
    { label: 'CTR — Meta',     fmt: v => fmtPercent(v ? v * 100 : v, 2), total: d.channelPerformance.ctrMeta.total, byDepot: d.channelPerformance.ctrMeta.byDepot },
    { label: 'CTR — Google Ads', fmt: v => fmtPercent(v ? v * 100 : v, 2), total: d.channelPerformance.ctrGads.total, byDepot: d.channelPerformance.ctrGads.byDepot },
    { label: 'CPC — Meta',     fmt: v => fmtCurrency(v, 2), total: d.channelPerformance.cpcMeta.total, byDepot: d.channelPerformance.cpcMeta.byDepot },
    { label: 'CPC — Google Ads', fmt: v => fmtCurrency(v, 2), total: d.channelPerformance.cpcGads.total, byDepot: d.channelPerformance.cpcGads.byDepot },
  ];

  const pipelineRows = loading ? [] : [
    { label: 'Total Open Opportunities (MD)', fmt: v => fmtNum(v), total: d.pipelineHealth.openOpportunitiesMd.total, byDepot: d.pipelineHealth.openOpportunitiesMd.byDepot },
    { label: 'Total Open Opportunities (SD)', fmt: v => fmtNum(v), total: d.pipelineHealth.openOpportunitiesSd.total, byDepot: d.pipelineHealth.openOpportunitiesSd.byDepot },
    { label: 'Pipeline Value — MD',           fmt: v => fmtCurrency(v, 0), total: d.pipelineHealth.pipelineValueMd.total, byDepot: d.pipelineHealth.pipelineValueMd.byDepot },
    { label: 'Pipeline Value — SD',           fmt: v => fmtCurrency(v, 0), total: d.pipelineHealth.pipelineValueSd.total, byDepot: d.pipelineHealth.pipelineValueSd.byDepot },
    { label: 'Avg. Deal Cycle Length — MD',   fmt: fmtDays, total: d.pipelineHealth.avgDealCycleMd.total, byDepot: d.pipelineHealth.avgDealCycleMd.byDepot },
    { label: 'Avg. Deal Cycle Length — SD',   fmt: fmtDays, total: d.pipelineHealth.avgDealCycleSd.total, byDepot: d.pipelineHealth.avgDealCycleSd.byDepot },
  ];

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          Cost Per Enquiry <span className="normal-case font-normal text-gray-400">(blended — total ad spend ÷ enquiries)</span>
        </h2>
        <MetricTable title="Cost Per Enquiry" rows={costPerEnquiryRows} loading={loading} />
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          Attributed Performance <span className="normal-case font-normal text-gray-400">(channel-specific, via HubSpot source tracking)</span>
        </h2>
        <MetricTable title="Attributed Performance" rows={attributedRows} loading={loading} />
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Cost &amp; ROI</h2>
        <MetricTable title="Cost & ROI" rows={costRoiRows} loading={loading} />
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Lead Quality</h2>
        <MetricTable title="Lead Quality" rows={leadQualityRows} loading={loading} />
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Channel Performance</h2>
        <MetricTable title="Channel Performance" rows={channelRows} loading={loading} />
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Pipeline Health</h2>
        <MetricTable title="Pipeline Health" rows={pipelineRows} loading={loading} />
      </div>

      <p className="text-xs text-gray-400 italic">
        Attribution: Meta = HubSpot original source "Paid Social"; Google Ads = "Paid Search". Cost Per Enquiry uses blended total ad spend (not channel-split). SD Lead-to-Opportunity Rate is a current-stage snapshot (no stage-history tracking available for the Single Day pipeline).
      </p>
    </div>
  );
}
