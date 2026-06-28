const express = require('express');
const router = express.Router();
const { getMarketingPerformance } = require('../services/marketingDashboard');
const { getAdAttribution } = require('../services/attribution');

// GET /api/marketing/performance?startDate=&endDate=
router.get('/performance', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await getMarketingPerformance({ startDate, endDate });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/marketing/attribution?startDate=&endDate=
router.get('/attribution', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await getAdAttribution({ startDate, endDate });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
