const express = require('express');
const router = express.Router();
const meta = require('../services/meta');

function parseDateRange(query) {
  return {
    startDate: query.startDate || null,
    endDate:   query.endDate   || null,
    region:    query.region    || null,
  };
}

// GET /api/meta/summary
router.get('/summary', async (req, res, next) => {
  try {
    const data = await meta.getSummary(parseDateRange(req.query));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/meta/campaigns
router.get('/campaigns', async (req, res, next) => {
  try {
    const data = await meta.getCampaigns(parseDateRange(req.query));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/meta/daily-spend
router.get('/daily-spend', async (req, res, next) => {
  try {
    const data = await meta.getDailySpend(parseDateRange(req.query));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/meta/depot-daily-spend
// Returns per-depot daily spend derived from adset names (mirrors /api/google-ads/depot-daily-spend).
// Adsets must include a regional keyword (Nelson, Hokitika, Cromwell, Kawarau) to be attributed.
router.get('/depot-daily-spend', async (req, res, next) => {
  try {
    const data = await meta.getDepotDailySpend(parseDateRange(req.query));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
