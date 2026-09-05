const express = require('express');
const router = express.Router();
const rezdy = require('../services/rezdy');

// GET /api/rezdy/bookings
// Returns confirmed bookings with daily + product breakdowns, sorted by creation date.
// No date params accepted — the service always returns the last ~400 days by creation date.
// The frontend filters the daily array for the selected period.
router.get('/bookings', async (req, res, next) => {
  try {
    const data = await rezdy.getBookings();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
