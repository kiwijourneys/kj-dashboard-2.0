const express = require('express');
const router = express.Router();
const rezdy = require('../services/rezdy');

function parseDateRange(query) {
  return {
    startDate: query.startDate || null,
    endDate:   query.endDate   || null,
  };
}

// GET /api/rezdy/bookings
// Returns confirmed bookings with daily + product breakdowns.
router.get('/bookings', async (req, res, next) => {
  try {
    const data = await rezdy.getBookings(parseDateRange(req.query));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
