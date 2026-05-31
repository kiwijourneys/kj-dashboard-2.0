const axios = require('axios');
const config = require('../config');

async function sendWebhook(payload) {
  const url = config.slack.webhookUrl;
  if (!url) throw new Error('SLACK_WEBHOOK_URL is not configured');
  const resp = await axios.post(url, payload);
  return resp.data;
}

// ── Alert builders ────────────────────────────────────────────────────────────

function buildNoLeadsAlert(date) {
  return {
    text: `⚠️ *No Multi Day leads received today (${date})*`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `⚠️ *No new Multi Day enquiries recorded today (${date}).*\nCheck HubSpot pipeline to confirm.`,
        },
      },
    ],
  };
}

function buildSpendAlert(channel, spendNzd, thresholdNzd) {
  return {
    text: `🚨 *${channel} daily spend exceeded threshold*`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🚨 *${channel} spend alert*\nToday's spend: *NZD $${spendNzd.toFixed(2)}*\nThreshold: NZD $${thresholdNzd.toFixed(2)}`,
        },
      },
    ],
  };
}

function buildCplAlert(cpl, thresholdNzd) {
  return {
    text: `📈 *CPL exceeded threshold: NZD $${cpl.toFixed(2)}*`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📈 *CPL alert*\nCurrent CPL: *NZD $${cpl.toFixed(2)}*\nThreshold: NZD $${thresholdNzd.toFixed(2)}`,
        },
      },
    ],
  };
}

function buildNewNoRegionAlert(count) {
  return {
    text: `🏷️ *${count} deal(s) with no region set detected*`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🏷️ *${count} deal(s) have no region/location set in HubSpot.*\nPlease update these deals to ensure accurate regional reporting.`,
        },
      },
    ],
  };
}

function buildWeeklySummary({ weekEnding, totalSpendNzd, totalLeads, cpl, closedWon, revenueNzd, roas }) {
  return {
    text: `📊 *Weekly Marketing Summary — w/e ${weekEnding}*`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `📊 Weekly Marketing Summary — w/e ${weekEnding}`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Total Spend:* NZD $${(totalSpendNzd || 0).toLocaleString('en-NZ', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` },
          { type: 'mrkdwn', text: `*Total Leads:* ${totalLeads ?? '—'}` },
          { type: 'mrkdwn', text: `*CPL:* $${cpl ? cpl.toFixed(0) : '—'}` },
          { type: 'mrkdwn', text: `*Closed Won:* ${closedWon ?? '—'} (NZD $${(revenueNzd || 0).toLocaleString('en-NZ', { minimumFractionDigits: 0, maximumFractionDigits: 0 })})` },
          { type: 'mrkdwn', text: `*ROAS:* ${roas ? roas.toFixed(2) + 'x' : '—'}` },
        ],
      },
    ],
  };
}

// ── Test ──────────────────────────────────────────────────────────────────────

async function sendTestMessage() {
  return sendWebhook({
    text: '✅ Kiwi Journeys marketing dashboard — Slack integration is working!',
  });
}

module.exports = {
  sendWebhook,
  buildNoLeadsAlert,
  buildSpendAlert,
  buildCplAlert,
  buildNewNoRegionAlert,
  buildWeeklySummary,
  sendTestMessage,
};
