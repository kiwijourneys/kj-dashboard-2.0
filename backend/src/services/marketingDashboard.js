/**
 * Marketing performance dashboard — orchestrates HubSpot, Meta, and Google Ads
 * data into the full KPI set: Cost Per Enquiry, Attributed Performance,
 * Cost & ROI, Lead Quality, Channel Performance, Pipeline Health.
 *
 * All KPIs are computed Total + per-depot (Nelson, West Coast, Central Otago,
 * Kawarau Gorge), independent of the dashboard's global region filter.
 */

const hubspot  = require('./hubspot');
const meta     = require('./meta');
const googleAds = require('./googleAds');
const { cpl, roas } = require('./metrics');

const { ALL_DEPOTS } = hubspot;

/**
 * Bucket a list of HubSpot deals (each with a `.regions` array) into
 * Total + per-depot counts and an optional summed value (e.g. revenue).
 */
function bucketDeals(deals, valueFn) {
  const totals = { count: 0, value: 0 };
  const byDepot = {};
  for (const d of ALL_DEPOTS) byDepot[d] = { count: 0, value: 0 };

  for (const deal of deals) {
    const val = valueFn ? valueFn(deal) : 0;
    totals.count++; totals.value += val;
    for (const r of (deal.regions || [])) {
      if (byDepot[r]) { byDepot[r].count++; byDepot[r].value += val; }
    }
  }
  return { total: totals, byDepot };
}

function divideByDepot(numeratorByDepot, denominatorByDepot, numKey, denKey) {
  const result = {};
  for (const d of ALL_DEPOTS) {
    const num = numeratorByDepot[d]?.[numKey] ?? 0;
    const den = denominatorByDepot[d]?.[denKey] ?? 0;
    result[d] = den > 0 ? num / den : null;
  }
  return result;
}

async function getMarketingPerformance({ startDate, endDate } = {}) {
  // ── Fetch everything in parallel ────────────────────────────────────────────
  const [
    mdLeads, sdLeads, mdClosed, sdClosed,
    attributedMd, attributedSd,
    pipelineHealthMd, pipelineHealthSd,
    oppRatesMd, oppRatesSd,
    metaPerf, gadsPerf,
    metaTourType, gadsTourType,
  ] = await Promise.all([
    hubspot.getMultiDayLeads({ startDate, endDate }),
    hubspot.getSingleDayLeads({ startDate, endDate }),
    hubspot.getMultiDayClosedWon({ startDate, endDate }),
    hubspot.getSingleDayClosedWon({ startDate, endDate }),
    hubspot.getAttributedLeadCounts({ pipeline: 'md', startDate, endDate }),
    hubspot.getAttributedLeadCounts({ pipeline: 'sd', startDate, endDate }),
    hubspot.getPipelineHealth({ pipeline: 'md', startDate, endDate }),
    hubspot.getPipelineHealth({ pipeline: 'sd', startDate, endDate }),
    hubspot.getOpportunityRates({ pipeline: 'md', startDate, endDate }),
    hubspot.getOpportunityRates({ pipeline: 'sd', startDate, endDate }),
    meta.getDepotPerformance({ startDate, endDate }),
    googleAds.getDepotPerformance({ startDate, endDate }),
    meta.getTourTypeDepotPerformance({ startDate, endDate }),
    googleAds.getTourTypeDepotPerformance({ startDate, endDate }),
  ]);

  const mdEnquiry = bucketDeals(mdLeads.deals);
  const sdEnquiry = bucketDeals(sdLeads.deals);
  const mdRevenue = bucketDeals(mdClosed.deals, d => d.amount || 0);
  const sdRevenue = bucketDeals(sdClosed.deals, d => d.amount || 0);

  // ── Total Ad Spend (Meta + Google Ads combined) ─────────────────────────────
  const totalAdSpend = {
    total: (metaPerf.total?.spendNzd || 0) + (gadsPerf.total?.spendNzd || 0),
    byDepot: Object.fromEntries(ALL_DEPOTS.map(d => [
      d, (metaPerf.byDepot[d]?.spendNzd || 0) + (gadsPerf.byDepot[d]?.spendNzd || 0),
    ])),
  };

  // ── Cost Per Enquiry (real spend attribution by campaign/adset tour-type tag) ─
  // Google campaigns and Meta adsets are tagged with tour type (e.g. "SEM - NZ -
  // Cromwell - Multi Day", "NZ| One Day Tours | Nelson"). This sums actual MD-
  // tagged and SD-tagged spend separately, rather than dividing total spend by
  // each enquiry count (which double-counts spend across both types).
  function tourTypeSpend(depot, type) {
    const gBucket = depot === 'all'
      ? Object.values(gadsTourType.byDepot).reduce((s, d) => s + (d[type]?.spendNzd || 0), 0)
      : (gadsTourType.byDepot[depot]?.[type]?.spendNzd || 0);
    const mBucket = depot === 'all'
      ? Object.values(metaTourType.byDepot).reduce((s, d) => s + (d[type]?.spendNzd || 0), 0)
      : (metaTourType.byDepot[depot]?.[type]?.spendNzd || 0);
    return gBucket + mBucket;
  }

  const unclassifiedSpendNzd = tourTypeSpend('all', 'Unclassified');

  const costPerEnquiry = {
    md: {
      total: cpl(tourTypeSpend('all', 'MD'), mdEnquiry.total.count),
      byDepot: Object.fromEntries(ALL_DEPOTS.map(d =>
        [d, cpl(tourTypeSpend(d, 'MD'), mdEnquiry.byDepot[d].count)])),
    },
    sd: {
      total: cpl(tourTypeSpend('all', 'SD'), sdEnquiry.total.count),
      byDepot: Object.fromEntries(ALL_DEPOTS.map(d =>
        [d, cpl(tourTypeSpend(d, 'SD'), sdEnquiry.byDepot[d].count)])),
    },
    unclassifiedSpendNzd,
  };

  // ── Attributed Performance (channel-specific via HubSpot source tracking) ──
  const attributedPerformance = {
    metaMdEnquiries: {
      total: cpl(metaPerf.total?.spendNzd, attributedMd.total.meta),
      byDepot: Object.fromEntries(ALL_DEPOTS.map(d =>
        [d, cpl(metaPerf.byDepot[d]?.spendNzd, attributedMd.byDepot[d].meta)])),
    },
    gadsMdEnquiries: {
      total: cpl(gadsPerf.total?.spendNzd, attributedMd.total.gads),
      byDepot: Object.fromEntries(ALL_DEPOTS.map(d =>
        [d, cpl(gadsPerf.byDepot[d]?.spendNzd, attributedMd.byDepot[d].gads)])),
    },
    metaSdEnquiries: {
      total: cpl(metaPerf.total?.spendNzd, attributedSd.total.meta),
      byDepot: Object.fromEntries(ALL_DEPOTS.map(d =>
        [d, cpl(metaPerf.byDepot[d]?.spendNzd, attributedSd.byDepot[d].meta)])),
    },
    gadsSdEnquiries: {
      total: cpl(gadsPerf.total?.spendNzd, attributedSd.total.gads),
      byDepot: Object.fromEntries(ALL_DEPOTS.map(d =>
        [d, cpl(gadsPerf.byDepot[d]?.spendNzd, attributedSd.byDepot[d].gads)])),
    },
    metaLeadsResults: {
      total: metaPerf.total?.costPerResultNzd ?? null,
      byDepot: Object.fromEntries(ALL_DEPOTS.map(d => [d, metaPerf.byDepot[d]?.costPerResultNzd ?? null])),
    },
    gadsConversions: {
      total: gadsPerf.total?.costPerConversionNzd ?? null,
      byDepot: Object.fromEntries(ALL_DEPOTS.map(d => [d, gadsPerf.byDepot[d]?.costPerConversionNzd ?? null])),
    },
  };

  // ── Cost & ROI ───────────────────────────────────────────────────────────────
  const costRoi = {
    totalAdSpend,
    roasMd: {
      total: roas(mdRevenue.total.value, totalAdSpend.total),
      byDepot: Object.fromEntries(ALL_DEPOTS.map(d =>
        [d, roas(mdRevenue.byDepot[d].value, totalAdSpend.byDepot[d])])),
    },
    roasSd: {
      total: roas(sdRevenue.total.value, totalAdSpend.total),
      byDepot: Object.fromEntries(ALL_DEPOTS.map(d =>
        [d, roas(sdRevenue.byDepot[d].value, totalAdSpend.byDepot[d])])),
    },
  };

  // ── Lead Quality ─────────────────────────────────────────────────────────────
  const leadQuality = {
    leadToOpportunityRateMd:  { total: oppRatesMd.total.leadToOpportunityRate,  byDepot: Object.fromEntries(ALL_DEPOTS.map(d => [d, oppRatesMd.byDepot[d].leadToOpportunityRate])) },
    leadToOpportunityRateSd:  { total: oppRatesSd.total.leadToOpportunityRate,  byDepot: Object.fromEntries(ALL_DEPOTS.map(d => [d, oppRatesSd.byDepot[d].leadToOpportunityRate])) },
    opportunityToCloseRateMd: { total: oppRatesMd.total.opportunityToCloseRate, byDepot: Object.fromEntries(ALL_DEPOTS.map(d => [d, oppRatesMd.byDepot[d].opportunityToCloseRate])) },
  };

  // ── Pipeline Health ──────────────────────────────────────────────────────────
  const pipelineHealth = {
    openOpportunitiesMd: { total: pipelineHealthMd.total.openCount, byDepot: Object.fromEntries(ALL_DEPOTS.map(d => [d, pipelineHealthMd.byDepot[d].openCount])) },
    openOpportunitiesSd: { total: pipelineHealthSd.total.openCount, byDepot: Object.fromEntries(ALL_DEPOTS.map(d => [d, pipelineHealthSd.byDepot[d].openCount])) },
    pipelineValueMd:     { total: pipelineHealthMd.total.openValueNzd, byDepot: Object.fromEntries(ALL_DEPOTS.map(d => [d, pipelineHealthMd.byDepot[d].openValueNzd])) },
    pipelineValueSd:     { total: pipelineHealthSd.total.openValueNzd, byDepot: Object.fromEntries(ALL_DEPOTS.map(d => [d, pipelineHealthSd.byDepot[d].openValueNzd])) },
    avgDealCycleMd:      { total: pipelineHealthMd.total.avgDealCycleDays, byDepot: Object.fromEntries(ALL_DEPOTS.map(d => [d, pipelineHealthMd.byDepot[d].avgDealCycleDays])) },
    avgDealCycleSd:      { total: pipelineHealthSd.total.avgDealCycleDays, byDepot: Object.fromEntries(ALL_DEPOTS.map(d => [d, pipelineHealthSd.byDepot[d].avgDealCycleDays])) },
  };

  return {
    period: { startDate, endDate },
    depots: ALL_DEPOTS,
    costPerEnquiry,
    attributedPerformance,
    costRoi,
    leadQuality,
    pipelineHealth,
  };
}

module.exports = { getMarketingPerformance };
