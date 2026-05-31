const express = require('express');
const router = express.Router();
const hs = require('../services/hubspot');
const gads = require('../services/googleAds');
const ga4 = require('../services/ga4');
const meta = require('../services/meta');
const { computeSummaryKpis, computeDeltas } = require('../services/metrics');
const { getSyncTimestamps } = require('../cache');

function parseDateRange(query) {
  return {
    startDate: query.startDate || null,
    endDate: query.endDate || null,
    region: query.region || null,
  };
}

/**
 * Shift a date range back by the same number of days to get the prior period.
 */
function priorPeriod(startDate, endDate) {
  if (!startDate || !endDate) return { startDate: null, endDate: null };
  const s = new Date(startDate);
  const e = new Date(endDate);
  const diffMs = e - s + 86400000; // inclusive
  const priorEnd = new Date(s - 86400000);
  const priorStart = new Date(priorEnd - diffMs + 86400000);
  return {
    startDate: priorStart.toISOString().split('T')[0],
    endDate: priorEnd.toISOString().split('T')[0],
  };
}

// GET /api/summary
// Returns all KPIs + deltas for the executive summary view
router.get('/', async (req, res, next) => {
  try {
    const params = parseDateRange(req.query);
    const prior = priorPeriod(params.startDate, params.endDate);

    // Fetch current period — all sources in parallel, tolerate individual failures
    const [
      mdLeads, sdLeads,
      mdClosed, sdClosed,
      googleSummary, metaSummary,
      noRegion,
    ] = await Promise.allSettled([
      hs.getMultiDayLeads(params),
      hs.getSingleDayLeads(params),
      hs.getMultiDayClosedWon(params),
      hs.getSingleDayClosedWon(params),
      gads.isConfigured() ? gads.getSummary(params) : ga4.getAdvertiserAdSpend(params),
      meta.getSummary(params),
      hs.getDealsWithNoRegion(),
    ]);

    // Fetch prior period in parallel
    const [
      mdLeadsPrior, sdLeadsPrior,
      mdClosedPrior, sdClosedPrior,
      googlePrior, metaPrior,
    ] = await Promise.allSettled([
      hs.getMultiDayLeads({ ...prior, region: params.region }),
      hs.getSingleDayLeads({ ...prior, region: params.region }),
      hs.getMultiDayClosedWon({ ...prior, region: params.region }),
      hs.getSingleDayClosedWon({ ...prior, region: params.region }),
      gads.isConfigured() ? gads.getSummary({ ...prior, region: params.region }) : ga4.getAdvertiserAdSpend(prior),
      meta.getSummary({ ...prior, region: params.region }),
    ]);

    function val(settled, fallback = null) {
      return settled.status === 'fulfilled' ? settled.value : fallback;
    }

    function err(settled) {
      return settled.status === 'rejected' ? settled.reason?.message : null;
    }

    const current = computeSummaryKpis({
      googleSpendNzd: val(googleSummary)?.spendNzd ?? 0,
      metaSpendNzd: val(metaSummary)?.spendNzd ?? 0,
      multiDayLeadsCount: val(mdLeads)?.total ?? 0,
      singleDayLeadsCount: val(sdLeads)?.total ?? 0,
      multiDayClosedWonCount: val(mdClosed)?.total ?? 0,
      singleDayClosedWonCount: val(sdClosed)?.total ?? 0,
      multiDayRevenueNzd: val(mdClosed)?.totalRevenue ?? 0,
      singleDayRevenueNzd: val(sdClosed)?.totalRevenue ?? 0,
    });

    const priorKpis = computeSummaryKpis({
      googleSpendNzd: val(googlePrior)?.spendNzd ?? 0,
      metaSpendNzd: val(metaPrior)?.spendNzd ?? 0,
      multiDayLeadsCount: val(mdLeadsPrior)?.total ?? 0,
      singleDayLeadsCount: val(sdLeadsPrior)?.total ?? 0,
      multiDayClosedWonCount: val(mdClosedPrior)?.total ?? 0,
      singleDayClosedWonCount: val(sdClosedPrior)?.total ?? 0,
      multiDayRevenueNzd: val(mdClosedPrior)?.totalRevenue ?? 0,
      singleDayRevenueNzd: val(sdClosedPrior)?.totalRevenue ?? 0,
    });

    const kpis = computeDeltas(current, priorKpis);

    // Build data quality callouts
    const noRegionData = val(noRegion);
    const noAmountWarnings = [];
    if (val(mdClosed)?.noAmountCount > 0) {
      noAmountWarnings.push(`${val(mdClosed).noAmountCount} Multi Day closed won deal(s) have no amount set`);
    }
    if (val(sdClosed)?.noAmountCount > 0) {
      noAmountWarnings.push(`${val(sdClosed).noAmountCount} Single Day closed won deal(s) have no amount set`);
    }

    // Source errors
    const sourceErrors = {
      hubspot: err(mdLeads) || err(sdLeads) || err(mdClosed) || err(sdClosed),
      googleAds: err(googleSummary),
      meta: err(metaSummary),
    };

    res.json({
      kpis,
      dataQuality: {
        noRegionCount: noRegionData?.count ?? null,
        noRegionHubspotUrl: noRegionData?.hubspotFilterUrl ?? null,
        noAmountWarnings,
        multiRegionNote: 'Deals with multiple regions are counted in all matching regions — regional totals will exceed the overall total.',
      },
      sourceErrors,
      syncTimestamps: getSyncTimestamps(),
      periodParams: params,
      priorPeriodParams: prior,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
