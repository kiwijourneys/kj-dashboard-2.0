/**
 * Weekly AI insights — pulls last week's data from all sources, sends to
 * Claude, and returns a formatted strategic summary for Slack.
 */

const Anthropic = require('@anthropic-ai/sdk');

const hs      = require('./hubspot');
const gads    = require('./googleAds');
const meta    = require('./meta');
const xero    = require('./xero');
const { computeSummaryKpis } = require('./metrics');

function fmtNzd(v) {
  if (!v && v !== 0) return '—';
  return `$${Number(v).toLocaleString('en-NZ', { maximumFractionDigits: 0 })}`;
}
function fmtNum(v, dp = 0) {
  if (!v && v !== 0) return '—';
  return Number(v).toLocaleString('en-NZ', { maximumFractionDigits: dp });
}

/**
 * Collect all KPI data for the given date range.
 */
async function collectData({ startDate, endDate }) {
  const [mdLeads, sdLeads, mdClosed, sdClosed, googleData, metaData, xeroData] =
    await Promise.allSettled([
      hs.getMultiDayLeads({ startDate, endDate }),
      hs.getSingleDayLeads({ startDate, endDate }),
      hs.getMultiDayClosedWon({ startDate, endDate }),
      hs.getSingleDayClosedWon({ startDate, endDate }),
      gads.getSummary({ startDate, endDate }),
      meta.getSummary({ startDate, endDate }),
      xero.getPnLSummary({ startDate, endDate }).catch(() => null),
    ]);

  const get = (r) => r.status === 'fulfilled' ? r.value : null;

  const google  = get(googleData);
  const metaRes = get(metaData);
  const xeroRes = get(xeroData);
  const mdL     = get(mdLeads);
  const sdL     = get(sdLeads);
  const mdC     = get(mdClosed);
  const sdC     = get(sdClosed);

  const kpis = computeSummaryKpis({
    googleSpendNzd:        google?.spendNzd ?? 0,
    metaSpendNzd:          metaRes?.spendNzd ?? 0,
    multiDayLeadsCount:    mdL?.total ?? 0,
    singleDayLeadsCount:   sdL?.total ?? 0,
    multiDayClosedWonCount:  mdC?.total ?? 0,
    singleDayClosedWonCount: sdC?.total ?? 0,
    multiDayRevenueNzd:    mdC?.totalRevenue ?? 0,
    singleDayRevenueNzd:   sdC?.totalRevenue ?? 0,
  });

  return { google, meta: metaRes, xero: xeroRes, mdLeads: mdL, sdLeads: sdL, mdClosed: mdC, sdClosed: sdC, kpis };
}

/**
 * Format collected data into a structured prompt for Claude.
 */
function buildPrompt({ startDate, endDate, data }) {
  const { google, meta: metaRes, xero: xeroRes, mdLeads, sdLeads, mdClosed, sdClosed, kpis } = data;

  const lines = [
    `You are a strategic marketing advisor for Kiwi Journeys, a New Zealand adventure tourism operator running multi-day and single-day cycling tours across Nelson, West Coast, Central Otago, and Kawarau Gorge. They also operate ferry services.`,
    ``,
    `Below is last week's marketing and revenue performance data (${startDate} → ${endDate}). Please provide:`,
    `1. A brief headline performance summary (2–3 sentences)`,
    `2. Top 3 insights from the data (what's working, what's not, what's notable)`,
    `3. Top 3 strategic recommendations for next week`,
    `4. One watch-out or risk to flag`,
    ``,
    `Keep the tone direct and actionable. Format each section clearly with bold headings. Total response should be concise enough to read in 2 minutes.`,
    ``,
    `--- PERFORMANCE DATA ---`,
    ``,
    `PAID ADVERTISING`,
    `• Google Ads spend: ${fmtNzd(google?.spendNzd)} | Impressions: ${fmtNum(google?.impressions)} | Clicks: ${fmtNum(google?.clicks)} | CTR: ${google?.ctr ? (google.ctr * 100).toFixed(2) + '%' : '—'} | Conversions: ${fmtNum(google?.conversions)} | Cost/Conv: ${fmtNzd(google?.costPerConversionNzd)}`,
    `• Meta Ads spend: ${fmtNzd(metaRes?.spendNzd)} | Impressions: ${fmtNum(metaRes?.impressions)} | Clicks: ${fmtNum(metaRes?.clicks)} | CTR: ${metaRes?.ctr ? (metaRes.ctr * 100).toFixed(2) + '%' : '—'} | Results (leads): ${fmtNum(metaRes?.leads)} | Cost/Result: ${fmtNzd(metaRes?.costPerResultNzd)}`,
    `• Total ad spend: ${fmtNzd(kpis.totalAdSpendNzd)}`,
    ``,
    `LEADS & PIPELINE (HubSpot)`,
    `• Multi-Day enquiries: ${mdLeads?.total ?? '—'}`,
    `• Single-Day enquiries: ${sdLeads?.total ?? '—'}`,
    `• Total leads: ${kpis.totalLeads ?? '—'}`,
    `• Cost per lead (CPL): ${fmtNzd(kpis.cpl)}`,
    ``,
    `BOOKINGS CLOSED (HubSpot — confirmed in period)`,
    `• Multi-Day closed won: ${mdClosed?.total ?? '—'} bookings | Revenue: ${fmtNzd(mdClosed?.totalRevenue)}`,
    `• Single-Day closed won: ${sdClosed?.total ?? '—'} bookings | Revenue: ${fmtNzd(sdClosed?.totalRevenue)}`,
    `• Total closed: ${kpis.totalClosedWon ?? '—'} | Total revenue: ${fmtNzd(kpis.totalRevenueNzd)}`,
    `• ROAS: ${kpis.roas ? kpis.roas.toFixed(2) + 'x' : '—'}`,
  ];

  if (xeroRes?.summary) {
    const s = xeroRes.summary;
    lines.push(
      ``,
      `RECOGNISED REVENUE (Xero — accrual, anchored to tour start date)`,
      `• Total income: ${fmtNzd(s.income)}`,
      `• Gross profit: ${fmtNzd(s.grossProfit)}`,
      `• Net profit: ${fmtNzd(s.netProfit)}`,
    );
    if (xeroRes.incomeAccounts?.length) {
      lines.push(`• Income breakdown:`);
      for (const acc of xeroRes.incomeAccounts.slice(0, 6)) {
        lines.push(`  - ${acc.name}: ${fmtNzd(acc.value)}`);
      }
    }
  }

  lines.push(``, `--- END DATA ---`);

  return lines.join('\n');
}

/**
 * Call Claude API and return the insight text.
 */
async function generateInsights(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content[0].text;
}

/**
 * Convert Claude's markdown-style response to Slack blocks.
 * Splits on bold headings (**Heading**) into separate sections.
 */
function insightsToSlackBlocks({ weekEnding, insightText }) {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🧠 Weekly Strategic Insights — w/e ${weekEnding}` },
    },
    { type: 'divider' },
  ];

  // Split text into paragraphs and render as mrkdwn sections
  // Convert **bold** to *bold* for Slack
  const slackText = insightText
    .replace(/\*\*(.*?)\*\*/g, '*$1*')   // **bold** → *bold*
    .replace(/^#{1,3}\s+/gm, '*')        // ## Heading → *Heading
    .trim();

  // Slack blocks max 3000 chars per section — chunk if needed
  const MAX = 2900;
  for (let i = 0; i < slackText.length; i += MAX) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: slackText.slice(i, i + MAX) },
    });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `Generated by Claude · Data: Google Ads, Meta Ads, HubSpot, Xero · Period: w/e ${weekEnding}`,
    }],
  });

  return blocks;
}

/**
 * Main entry point — collect data, generate insights, return Slack payload.
 */
async function runWeeklyInsights({ startDate, endDate }) {
  console.log('[insights] Collecting data for', startDate, '→', endDate);
  const data = await collectData({ startDate, endDate });

  const prompt = buildPrompt({ startDate, endDate, data });
  console.log('[insights] Sending to Claude...');

  const insightText = await generateInsights(prompt);
  console.log('[insights] Got response, building Slack payload');

  const blocks = insightsToSlackBlocks({ weekEnding: endDate, insightText });
  return {
    text: `🧠 Weekly Strategic Insights — w/e ${endDate}`,
    blocks,
  };
}

module.exports = { runWeeklyInsights, collectData };
