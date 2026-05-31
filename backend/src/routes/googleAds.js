const express = require('express');
const router = express.Router();
const gads = require('../services/googleAds');
const ga4  = require('../services/ga4'); // fallback when Ads API not configured

function parseDateRange(query) {
  return {
    startDate: query.startDate || null,
    endDate:   query.endDate   || null,
    region:    query.region    || null,
  };
}

// GET /api/google-ads/summary
// Falls back to GA4-linked ad cost when the Ads API is not configured.
router.get('/summary', async (req, res, next) => {
  try {
    if (!gads.isConfigured()) {
      const ga4Data = await ga4.getAdvertiserAdSpend(parseDateRange(req.query));
      return res.json({
        source: 'ga4_linked',
        configured: false,
        note: 'Google Ads API credentials not set — spend pulled from GA4 linked account.',
        spendNzd: ga4Data.spendNzd,
        impressions: ga4Data.impressions,
        clicks: ga4Data.clicks,
        ctr: ga4Data.ctr,
        conversions: 0, // conversion attribution requires Ads API
        costPerConversionNzd: null,
      });
    }
    const data = await gads.getSummary(parseDateRange(req.query));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/google-ads/campaigns
router.get('/campaigns', async (req, res, next) => {
  try {
    const data = await gads.getCampaigns(parseDateRange(req.query));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/google-ads/daily-spend
// Falls back to GA4-linked daily ad cost when the Ads API is not configured.
router.get('/daily-spend', async (req, res, next) => {
  try {
    if (!gads.isConfigured()) {
      const ga4Data = await ga4.getAdvertiserAdSpend(parseDateRange(req.query));
      return res.json(ga4Data.daily); // bare array to match configured shape
    }
    const data = await gads.getDailySpend(parseDateRange(req.query));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/google-ads/depot-daily-spend
router.get('/depot-daily-spend', async (req, res, next) => {
  try {
    const data = await gads.getDepotDailySpend(parseDateRange(req.query));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
