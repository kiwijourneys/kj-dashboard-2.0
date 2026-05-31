const express = require('express');
const router = express.Router();
const hs = require('../services/hubspot');

function parseDateRange(query) {
  const { startDate, endDate, region } = query;
  return {
    startDate: startDate || null,
    endDate: endDate || null,
    region: region || null,
  };
}

// GET /api/hubspot/leads/multiday
router.get('/leads/multiday', async (req, res, next) => {
  try {
    const params = parseDateRange(req.query);
    const data = await hs.getMultiDayLeads(params);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/hubspot/leads/singleday
router.get('/leads/singleday', async (req, res, next) => {
  try {
    const params = parseDateRange(req.query);
    const data = await hs.getSingleDayLeads(params);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/hubspot/closedwon/multiday
router.get('/closedwon/multiday', async (req, res, next) => {
  try {
    const params = parseDateRange(req.query);
    const data = await hs.getMultiDayClosedWon(params);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/hubspot/closedwon/singleday
router.get('/closedwon/singleday', async (req, res, next) => {
  try {
    const params = parseDateRange(req.query);
    const data = await hs.getSingleDayClosedWon(params);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/hubspot/actual/multiday — accrual revenue anchored to tour start_date
router.get('/actual/multiday', async (req, res, next) => {
  try {
    const params = parseDateRange(req.query);
    const data = await hs.getMultiDayActual(params);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/hubspot/actual/singleday — accrual revenue anchored to tour start_date
router.get('/actual/singleday', async (req, res, next) => {
  try {
    const params = parseDateRange(req.query);
    const data = await hs.getSingleDayActual(params);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/hubspot/booked-revenue/multiday — revenue anchored to booking date (createdate of ops deal)
router.get('/booked-revenue/multiday', async (req, res, next) => {
  try {
    const params = parseDateRange(req.query);
    const data = await hs.getMultiDayRevenueByBookedDate(params);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/hubspot/funnel/multiday
router.get('/funnel/multiday', async (req, res, next) => {
  try {
    const params = parseDateRange(req.query);
    const data = await hs.getMultiDayFunnel(params);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/hubspot/no-region
router.get('/no-region', async (req, res, next) => {
  try {
    const data = await hs.getDealsWithNoRegion();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
