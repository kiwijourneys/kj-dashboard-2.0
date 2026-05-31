/**
 * All KPI formulas in one place.
 * All monetary values in NZD.
 */

function cpl(totalAdSpendNzd, totalLeads) {
  if (!totalLeads || totalLeads === 0) return null;
  return totalAdSpendNzd / totalLeads;
}

function cac(totalAdSpendNzd, totalClosedWon) {
  if (!totalClosedWon || totalClosedWon === 0) return null;
  return totalAdSpendNzd / totalClosedWon;
}

function roas(totalRevenueNzd, totalAdSpendNzd) {
  if (!totalAdSpendNzd || totalAdSpendNzd === 0) return null;
  return totalRevenueNzd / totalAdSpendNzd;
}

function leadToCloseRate(totalClosedWon, totalLeads) {
  if (!totalLeads || totalLeads === 0) return null;
  return (totalClosedWon / totalLeads) * 100;
}

function avgDealValue(totalRevenue, dealCount) {
  if (!dealCount || dealCount === 0) return null;
  return totalRevenue / dealCount;
}

function totalAdSpend(googleSpendNzd, metaSpendNzd) {
  return (googleSpendNzd || 0) + (metaSpendNzd || 0);
}

/**
 * Compute all summary KPIs from raw source data.
 * Returns null for any metric where inputs are missing.
 */
function computeSummaryKpis({
  googleSpendNzd,
  metaSpendNzd,
  multiDayLeadsCount,
  singleDayLeadsCount,
  multiDayClosedWonCount,
  singleDayClosedWonCount,
  multiDayRevenueNzd,
  singleDayRevenueNzd,
}) {
  const spend = totalAdSpend(googleSpendNzd, metaSpendNzd);
  const leads = (multiDayLeadsCount || 0) + (singleDayLeadsCount || 0);
  const closedWon = (multiDayClosedWonCount || 0) + (singleDayClosedWonCount || 0);
  const revenue = (multiDayRevenueNzd || 0) + (singleDayRevenueNzd || 0);

  return {
    totalAdSpendNzd: spend,
    totalLeads: leads,
    totalClosedWon: closedWon,
    totalRevenueNzd: revenue,
    cpl: cpl(spend, leads),
    cac: cac(spend, closedWon),
    roas: roas(revenue, spend),
    leadToCloseRate: leadToCloseRate(closedWon, leads),
    avgDealValueMultiDay: avgDealValue(multiDayRevenueNzd, multiDayClosedWonCount),
    avgDealValueSingleDay: avgDealValue(singleDayRevenueNzd, singleDayClosedWonCount),
  };
}

/**
 * Compute period-over-period deltas.
 * Returns { current, prior, delta, deltaPercent } for each metric.
 */
function computeDeltas(current, prior) {
  const result = {};
  for (const key of Object.keys(current)) {
    const cur = current[key];
    const pri = prior[key];
    let delta = null;
    let deltaPercent = null;
    if (cur !== null && pri !== null) {
      delta = cur - pri;
      deltaPercent = pri !== 0 ? (delta / Math.abs(pri)) * 100 : null;
    }
    result[key] = { current: cur, prior: pri, delta, deltaPercent };
  }
  return result;
}

module.exports = {
  cpl,
  cac,
  roas,
  leadToCloseRate,
  avgDealValue,
  totalAdSpend,
  computeSummaryKpis,
  computeDeltas,
};
