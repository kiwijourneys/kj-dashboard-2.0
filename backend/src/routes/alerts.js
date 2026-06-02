const express = require('express');
const router = express.Router();
const slack = require('../services/slack');
const config = require('../config');

// POST /api/alerts/test-slack
// Body: { webhookUrl? }  — if omitted uses env var
router.post('/test-slack', async (req, res, next) => {
  try {
    await slack.sendTestMessage();
    res.json({ ok: true, message: 'Test message sent to Slack' });
  } catch (err) {
    next(err);
  }
});

// GET /api/alerts/config
// Returns the current FX rate and other configurable settings
router.get('/config', (req, res) => {
  res.json({
    fxRateUsdToNzd: config.fxRateUsdToNzd,
    slackWebhookConfigured: !!config.slack.webhookUrl,
  });
});

// POST /api/alerts/weekly-summary
// Manually trigger the weekly summary (scheduler calls this internally too)
router.post('/weekly-summary', async (req, res, next) => {
  try {
    const { scheduler } = require('../scheduler');
    await scheduler.runWeeklySummary();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/alerts/weekly-insights
// Manually trigger the AI strategic insights report.
// Pass { dryRun: true } in body to post raw data to Slack without calling Claude.
router.post('/weekly-insights', async (req, res, next) => {
  try {
    const scheduler = require('../scheduler');
    const dryRun = req.body?.dryRun === true;
    const result = await scheduler.runWeeklyInsightsNow({ dryRun });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
