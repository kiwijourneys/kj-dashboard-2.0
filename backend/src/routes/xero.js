const router = require('express').Router();
const xero   = require('../services/xero');
const config = require('../config');

function parseDates(query) {
  return {
    startDate: query.startDate || null,
    endDate:   query.endDate   || null,
    region:    query.region    || null,
  };
}

// GET /api/xero/pnl — overall P&L summary for a date range
router.get('/pnl', async (req, res, next) => {
  if (!config.xero.clientId) {
    return res.json({ configured: false, message: 'Xero not configured — run: node scripts/xero-auth.js' });
  }
  try {
    const data = await xero.getPnLSummary(parseDates(req.query));
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/xero/cost-centre-breakdown — stacked revenue by cost centre over time
router.get('/cost-centre-breakdown', async (req, res, next) => {
  if (!config.xero.clientId) {
    return res.json({ configured: false });
  }
  try {
    const { startDate, endDate } = parseDates(req.query);
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }
    const data = await xero.getCostCentreBreakdown({ startDate, endDate });
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/xero/tracking-categories — list all tracking categories and options
router.get('/tracking-categories', async (req, res, next) => {
  if (!config.xero.clientId) {
    return res.json({ configured: false });
  }
  try {
    const data = await xero.getTrackingCategories();
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/xero/monthly — monthly P&L breakdown for charts
router.get('/monthly', async (req, res, next) => {
  if (!config.xero.clientId) {
    return res.json({ configured: false, message: 'Xero not configured — run: node scripts/xero-auth.js' });
  }
  try {
    const data = await xero.getMonthlyPnL(parseDates(req.query));
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/xero/income-by-period — weekly (≤61 days) or monthly income by account
router.get('/income-by-period', async (req, res, next) => {
  if (!config.xero.clientId) {
    return res.json({ configured: false });
  }
  try {
    const data = await xero.getIncomeByPeriod(parseDates(req.query));
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;
