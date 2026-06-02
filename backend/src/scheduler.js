const cron = require('node-cron');
const hs = require('./services/hubspot');
const gads = require('./services/googleAds');
const meta = require('./services/meta');
const ga4 = require('./services/ga4');
const slack = require('./services/slack');
const { computeSummaryKpis } = require('./services/metrics');
const { invalidateNamespace, NAMESPACES } = require('./cache');
const insights = require('./services/insights');

// ── Alert configuration (loaded from environment / persisted settings) ────────
// In production, these would come from a settings store. For now, env-based.

function getAlertConfig() {
  return {
    noLeadsEnabled: process.env.ALERT_NO_LEADS_ENABLED !== 'false',
    spendThresholdGoogle: parseFloat(process.env.ALERT_SPEND_THRESHOLD_GOOGLE || '500'),
    spendThresholdMeta: parseFloat(process.env.ALERT_SPEND_THRESHOLD_META || '500'),
    spendAlertEnabled: process.env.ALERT_SPEND_ENABLED !== 'false',
    cplThreshold: parseFloat(process.env.ALERT_CPL_THRESHOLD || '200'),
    cplAlertEnabled: process.env.ALERT_CPL_ENABLED !== 'false',
    weeklySummaryEnabled: process.env.ALERT_WEEKLY_SUMMARY_ENABLED !== 'false',
    noRegionAlertEnabled: process.env.ALERT_NO_REGION_ENABLED !== 'false',
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayNzst() {
  // NZST is UTC+12 (UTC+13 in NZDT, but we use a fixed offset for simplicity)
  const now = new Date();
  const nzOffset = 12 * 60;
  const localMs = now.getTime() + (nzOffset - now.getTimezoneOffset()) * 60000;
  const nzDate = new Date(localMs);
  return nzDate.toISOString().split('T')[0];
}

function priorWeekRange() {
  const today = new Date(todayNzst());
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon ...
  const daysToLastMonday = ((dayOfWeek + 6) % 7) + 7; // go back to Monday of prior week
  const lastMonday = new Date(today);
  lastMonday.setDate(today.getDate() - daysToLastMonday);
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);
  return {
    startDate: lastMonday.toISOString().split('T')[0],
    endDate: lastSunday.toISOString().split('T')[0],
  };
}

// ── Alert runners ─────────────────────────────────────────────────────────────

async function checkNoLeadsAlert() {
  const cfg = getAlertConfig();
  if (!cfg.noLeadsEnabled) return;

  const today = todayNzst();
  const data = await hs.getMultiDayLeads({ startDate: today, endDate: today });
  if (data.total === 0) {
    await slack.sendWebhook(slack.buildNoLeadsAlert(today));
    console.log('[scheduler] No leads alert fired for', today);
  }
}

async function checkSpendAlerts() {
  const cfg = getAlertConfig();
  if (!cfg.spendAlertEnabled) return;

  const today = todayNzst();
  const [googleData, metaData] = await Promise.allSettled([
    gads.getSummary({ startDate: today, endDate: today }),
    meta.getSummary({ startDate: today, endDate: today }),
  ]);

  if (googleData.status === 'fulfilled') {
    const spend = googleData.value.spendNzd;
    if (spend > cfg.spendThresholdGoogle) {
      await slack.sendWebhook(slack.buildSpendAlert('Google Ads', spend, cfg.spendThresholdGoogle));
    }
  }

  if (metaData.status === 'fulfilled') {
    const spend = metaData.value.spendNzd;
    if (spend > cfg.spendThresholdMeta) {
      await slack.sendWebhook(slack.buildSpendAlert('Meta Ads', spend, cfg.spendThresholdMeta));
    }
  }
}

async function checkCplAlert() {
  const cfg = getAlertConfig();
  if (!cfg.cplAlertEnabled) return;

  const today = todayNzst();
  const [mdLeads, sdLeads, googleData, metaData] = await Promise.allSettled([
    hs.getMultiDayLeads({ startDate: today, endDate: today }),
    hs.getSingleDayLeads({ startDate: today, endDate: today }),
    gads.getSummary({ startDate: today, endDate: today }),
    meta.getSummary({ startDate: today, endDate: today }),
  ]);

  const leads =
    (mdLeads.status === 'fulfilled' ? mdLeads.value.total : 0) +
    (sdLeads.status === 'fulfilled' ? sdLeads.value.total : 0);

  const spend =
    (googleData.status === 'fulfilled' ? googleData.value.spendNzd : 0) +
    (metaData.status === 'fulfilled' ? metaData.value.spendNzd : 0);

  if (leads > 0) {
    const currentCpl = spend / leads;
    if (currentCpl > cfg.cplThreshold) {
      await slack.sendWebhook(slack.buildCplAlert(currentCpl, cfg.cplThreshold));
    }
  }
}

async function checkNoRegionAlert() {
  const cfg = getAlertConfig();
  if (!cfg.noRegionAlertEnabled) return;

  const data = await hs.getDealsWithNoRegion();
  if (data.count > 0) {
    await slack.sendWebhook(slack.buildNewNoRegionAlert(data.count));
  }
}

async function runWeeklySummary() {
  const cfg = getAlertConfig();
  if (!cfg.weeklySummaryEnabled) return;

  const { startDate, endDate } = priorWeekRange();

  const [mdLeads, sdLeads, mdClosed, sdClosed, googleData, metaData] = await Promise.allSettled([
    hs.getMultiDayLeads({ startDate, endDate }),
    hs.getSingleDayLeads({ startDate, endDate }),
    hs.getMultiDayClosedWon({ startDate, endDate }),
    hs.getSingleDayClosedWon({ startDate, endDate }),
    gads.getSummary({ startDate, endDate }),
    meta.getSummary({ startDate, endDate }),
  ]);

  const kpis = computeSummaryKpis({
    googleSpendNzd: googleData.status === 'fulfilled' ? googleData.value.spendNzd : 0,
    metaSpendNzd: metaData.status === 'fulfilled' ? metaData.value.spendNzd : 0,
    multiDayLeadsCount: mdLeads.status === 'fulfilled' ? mdLeads.value.total : 0,
    singleDayLeadsCount: sdLeads.status === 'fulfilled' ? sdLeads.value.total : 0,
    multiDayClosedWonCount: mdClosed.status === 'fulfilled' ? mdClosed.value.total : 0,
    singleDayClosedWonCount: sdClosed.status === 'fulfilled' ? sdClosed.value.total : 0,
    multiDayRevenueNzd: mdClosed.status === 'fulfilled' ? mdClosed.value.totalRevenue : 0,
    singleDayRevenueNzd: sdClosed.status === 'fulfilled' ? sdClosed.value.totalRevenue : 0,
  });

  await slack.sendWebhook(slack.buildWeeklySummary({
    weekEnding: endDate,
    totalSpendNzd: kpis.totalAdSpendNzd,
    totalLeads: kpis.totalLeads,
    cpl: kpis.cpl,
    closedWon: kpis.totalClosedWon,
    revenueNzd: kpis.totalRevenueNzd,
    roas: kpis.roas,
  }));

  console.log('[scheduler] Weekly summary sent for', startDate, '→', endDate);
}

// ── Cache refresh ──────────────────────────────────────────────────────────────

async function refreshAllCaches() {
  console.log('[scheduler] Starting hourly cache refresh...');
  // Invalidate all namespaces so the next request fetches fresh data
  for (const ns of Object.values(NAMESPACES)) {
    invalidateNamespace(ns);
  }
  console.log('[scheduler] Cache cleared. Data will be lazily re-fetched on next request.');
}

// ── Schedule setup ─────────────────────────────────────────────────────────────

function init() {
  // Hourly cache refresh
  cron.schedule('0 * * * *', refreshAllCaches);

  // Daily at 6pm NZST (06:00 UTC — approximation; adjust for DST if needed)
  cron.schedule('0 6 * * *', async () => {
    console.log('[scheduler] Running daily alert checks...');
    await Promise.allSettled([
      checkNoLeadsAlert(),
      checkSpendAlerts(),
      checkCplAlert(),
      checkNoRegionAlert(),
    ]);
  });

  // Weekly summary: Monday 8am NZST (Sunday 20:00 UTC)
  cron.schedule('0 20 * * 0', async () => {
    console.log('[scheduler] Running weekly summary...');
    await runWeeklySummary().catch(err => console.error('[scheduler] Weekly summary error:', err));
  });

  // Weekly AI insights: Monday 8:05am NZST (Sunday 20:05 UTC) — 5 min after summary
  cron.schedule('5 20 * * 0', async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('[scheduler] Skipping AI insights — ANTHROPIC_API_KEY not set');
      return;
    }
    console.log('[scheduler] Running weekly AI insights...');
    try {
      const { startDate, endDate } = priorWeekRange();
      const payload = await insights.runWeeklyInsights({ startDate, endDate });
      await slack.sendWebhook(payload);
      console.log('[scheduler] AI insights sent for', startDate, '→', endDate);
    } catch (err) {
      console.error('[scheduler] AI insights error:', err.message);
    }
  });

  console.log('[scheduler] Cron jobs registered');
}

async function runWeeklyInsightsNow() {
  const { startDate, endDate } = priorWeekRange();
  const payload = await insights.runWeeklyInsights({ startDate, endDate });
  await slack.sendWebhook(payload);
  return { ok: true, startDate, endDate };
}

module.exports = { init, runWeeklySummary, runWeeklyInsightsNow, refreshAllCaches };
