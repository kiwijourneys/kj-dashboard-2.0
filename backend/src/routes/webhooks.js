const express = require('express');
const router = express.Router();

// ── In-memory reservation store ───────────────────────────────────────────────
// Keyed by reference so reservation.update overwrites reservation.create.
// Lost on restart — repopulates as webhooks arrive. Fine for live/today view.
const _reservations = new Map();
const _log = [];

const CONFIRMED_STAGES = new Set(['confirmed', 'completed', 'checked_out']);
const CANCELLED_STAGES = new Set(['cancelled', 'canceled']);

function storeReservation(data) {
  if (!data?.reference) return;
  _reservations.set(data.reference, {
    reference:    data.reference,
    stage:        data.stage,
    status:       data.status,
    startDate:    data.start_date,
    endDate:      data.end_date,
    totalPrice:   parseFloat(data.total_price || 0),
    totalReceived: parseFloat(data.total_received || 0),
    billableDays: data.billable_days,
    startLocation: data.start_location || null,
    endLocation:   data.end_location   || null,
    customerName:  `${data.customer_first_name || ''} ${data.customer_last_name || ''}`.trim(),
    itemCount:    data.item_count || 0,
    items:        data.items || [],
    createdTs:    data.created_ts,
    updatedTs:    data.updated_ts,
  });
}

// POST /api/webhooks/brm
router.post('/brm', (req, res) => {
  const body = req.body;
  const event = body?.event;
  const data  = body?.data;

  // Log for debugging
  _log.unshift({ receivedAt: new Date().toISOString(), event, reference: data?.reference, stage: data?.stage });
  if (_log.length > 50) _log.pop();

  if (data && (event === 'reservation.create' || event === 'reservation.update')) {
    storeReservation(data);
    console.log(`[webhook/brm] ${event} — ${data.reference} (${data.stage}) $${data.total_price}`);
  }

  res.json({ ok: true });
});

// GET /api/webhooks/brm/stats?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// Returns confirmed reservation counts and revenue for the date range
router.get('/brm/stats', (req, res) => {
  const { startDate, endDate } = req.query;

  const all = Array.from(_reservations.values());

  const inRange = all.filter(r => {
    if (!r.startDate) return false;
    if (startDate && r.startDate < startDate) return false;
    if (endDate   && r.startDate > endDate)   return false;
    return true;
  });

  const confirmed = inRange.filter(r => CONFIRMED_STAGES.has(r.stage));
  const cancelled = inRange.filter(r => CANCELLED_STAGES.has(r.stage));
  const provisional = inRange.filter(r => !CONFIRMED_STAGES.has(r.stage) && !CANCELLED_STAGES.has(r.stage));

  const totalRevenue   = confirmed.reduce((s, r) => s + r.totalPrice, 0);
  const totalReceived  = confirmed.reduce((s, r) => s + r.totalReceived, 0);

  // Group by location
  const byLocation = {};
  for (const r of confirmed) {
    const loc = r.startLocation || 'Unknown';
    if (!byLocation[loc]) byLocation[loc] = { count: 0, revenue: 0 };
    byLocation[loc].count++;
    byLocation[loc].revenue += r.totalPrice;
  }

  res.json({
    period: { startDate, endDate },
    totalStored: _reservations.size,
    confirmed:   { count: confirmed.length,   revenue: totalRevenue, received: totalReceived },
    provisional: { count: provisional.length },
    cancelled:   { count: cancelled.length },
    byLocation,
    reservations: confirmed,
  });
});

// GET /api/webhooks/brm/log — recent webhook events (for debugging)
router.get('/brm/log', (req, res) => {
  res.json({ count: _log.length, events: _log });
});

module.exports = router;
