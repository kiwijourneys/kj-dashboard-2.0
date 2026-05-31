const express = require('express');
const router = express.Router();
const ga4 = require('../services/ga4');

function parseDateRange(query) {
  return {
    startDate: query.startDate || null,
    endDate: query.endDate || null,
  };
}

// GET /api/ga4/channels
router.get('/channels', async (req, res, next) => {
  try {
    const data = await ga4.getChannelPerformance(parseDateRange(req.query));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/ga4/organic
router.get('/organic', async (req, res, next) => {
  try {
    const data = await ga4.getOrganicMetrics(parseDateRange(req.query));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/ga4/top-pages
router.get('/top-pages', async (req, res, next) => {
  try {
    const { limit } = req.query;
    const data = await ga4.getTopOrganicLandingPages({
      ...parseDateRange(req.query),
      limit: limit ? parseInt(limit, 10) : 5,
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/ga4/bike-rental
router.get('/bike-rental', async (req, res, next) => {
  try {
    const { eventName } = req.query;
    const data = await ga4.getBikeRentalConversions({
      ...parseDateRange(req.query),
      ...(eventName ? { eventName } : {}),
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/ga4/single-day-conversions
router.get('/single-day-conversions', async (req, res, next) => {
  try {
    const data = await ga4.getSingleDayConversions(parseDateRange(req.query));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/ga4/daily-sessions
router.get('/daily-sessions', async (req, res, next) => {
  try {
    const data = await ga4.getDailySessions(parseDateRange(req.query));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/ga4/ad-spend  — Google Ads cost via GA4 linked account
router.get('/ad-spend', async (req, res, next) => {
  try {
    const data = await ga4.getAdvertiserAdSpend(parseDateRange(req.query));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/ga4/rezdy-revenue  — Rezdy (purchase event) revenue by date
router.get('/rezdy-revenue', async (req, res, next) => {
  try {
    const data = await ga4.getSingleDayConversions(parseDateRange(req.query));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/ga4/rezdy-products  — Rezdy product-level breakdown (itemName, quantity, revenue)
router.get('/rezdy-products', async (req, res, next) => {
  try {
    const data = await ga4.getRezdyProducts(parseDateRange(req.query));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
