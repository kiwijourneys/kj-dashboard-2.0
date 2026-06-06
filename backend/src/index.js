require('dotenv').config();
const express = require('express');
const cors = require('cors');
const config = require('./config');
const scheduler = require('./scheduler');
const { getSyncTimestamps, getStats } = require('./cache');

const app = express();

app.use(cors());
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/api/summary',    require('./routes/summary'));
app.use('/api/hubspot',    require('./routes/hubspot'));
app.use('/api/google-ads', require('./routes/googleAds'));
app.use('/api/meta',       require('./routes/meta'));
app.use('/api/ga4',        require('./routes/ga4'));
app.use('/api/alerts',     require('./routes/alerts'));
app.use('/api/xero',       require('./routes/xero'));
app.use('/api/webhooks',   require('./routes/webhooks'));

// Health check + metadata
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    syncTimestamps: getSyncTimestamps(),
    cacheStats: getStats(),
    fxRateUsdToNzd: config.fxRateUsdToNzd,
    credentials: {
      hubspot: !!config.hubspot.accessToken,
      ga4: !!config.ga4.propertyId,
      googleAds: !!config.googleAds.developerToken,
      meta: !!config.meta.accessToken,
      slack: !!config.slack.webhookUrl,
      xero: !!config.xero.clientId,
    },
  });
});

// ── Error handler ─────────────────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  const status = err.status || err.response?.status || 500;
  const message = err.message || 'Internal server error';
  console.error(`[error] ${req.method} ${req.path}:`, message);
  // Log Google API error details if present
  if (err.response?.data) {
    console.error(`[error] API response:`, JSON.stringify(err.response.data));
  }
  if (config.nodeEnv !== 'production') {
    console.error(err.stack);
  }
  res.status(status).json({
    error: message,
    ...(config.nodeEnv !== 'production' && { stack: err.stack }),
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(config.port, () => {
  console.log(`[server] Marketing dashboard API running on port ${config.port}`);
  console.log(`[server] Environment: ${config.nodeEnv}`);
  scheduler.init();
});

module.exports = app;
