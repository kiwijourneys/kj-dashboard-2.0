const express = require('express');
const router = express.Router();

// Store last 20 received payloads in memory for inspection
const _log = [];

// POST /api/webhooks/brm
// Receives Bike Rent Manager webhook events
router.post('/brm', (req, res) => {
  const entry = {
    receivedAt: new Date().toISOString(),
    headers: {
      'content-type': req.headers['content-type'],
      'user-agent':   req.headers['user-agent'],
      'x-brm-event':  req.headers['x-brm-event'],
    },
    body: req.body,
  };

  _log.unshift(entry);
  if (_log.length > 20) _log.pop();

  console.log('[webhook/brm] Received event:', JSON.stringify(entry, null, 2));
  res.json({ ok: true });
});

// GET /api/webhooks/brm/log
// Returns the last received payloads — use this to inspect BRM's payload structure
router.get('/brm/log', (req, res) => {
  res.json({ count: _log.length, events: _log });
});

module.exports = router;
