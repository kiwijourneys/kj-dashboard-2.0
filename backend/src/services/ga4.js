const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');
const config = require('../config');
const { getOrFetch, buildKey, NAMESPACES, recordSync } = require('../cache');

// ── Auth ──────────────────────────────────────────────────────────────────────

const { google } = require('googleapis');

let _auth = null;
let _oauth2Client = null;

function getAuth() {
  // Prefer OAuth2 user credentials (GA4_OAUTH_REFRESH_TOKEN) — works without
  // needing to add the service account as a GA4 property user.
  const refreshToken = process.env.GA4_OAUTH_REFRESH_TOKEN;
  if (refreshToken) {
    if (!_oauth2Client) {
      _oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_ADS_CLIENT_ID,
        process.env.GOOGLE_ADS_CLIENT_SECRET,
        'http://localhost:4242/callback'
      );
      _oauth2Client.setCredentials({ refresh_token: refreshToken });
    }
    return _oauth2Client;
  }

  // Fall back to service account / ADC
  if (!_auth) {
    const raw = config.ga4.serviceAccountJson;
    if (raw && raw.trim()) {
      let credentials;
      if (raw.trim().startsWith('{')) {
        credentials = JSON.parse(raw);
      } else {
        credentials = require(raw.trim());
      }
      _auth = new GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
      });
    } else {
      _auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
      });
    }
  }
  return _auth;
}

async function getAccessToken() {
  const auth = getAuth();
  // OAuth2Client uses getAccessToken() differently from GoogleAuth
  if (auth instanceof google.auth.OAuth2) {
    const { token } = await auth.getAccessToken();
    return token;
  }
  const token = await auth.getAccessToken();
  return token;
}

// ── REST helper ───────────────────────────────────────────────────────────────

const GA4_BASE = `https://analyticsdata.googleapis.com/v1beta/properties/${config.ga4.propertyId}`;

async function runReport(body) {
  const token = await getAccessToken();
  const resp = await axios.post(`${GA4_BASE}:runReport`, body, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 30000,
  });
  return resp.data;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function toGa4Date(dateStr) {
  return dateStr ? dateStr.split('T')[0] : null;
}

/**
 * Return a safe GA4 REST start date.
 * GA4 REST API accepts YYYY-MM-DD, today, yesterday, NdaysAgo.
 * It does NOT accept 'firstSessionDate' (gRPC-only special value).
 * Default: 730daysAgo (~2 years) as a practical "all time" substitute.
 */
function defaultStart(dateStr) {
  return toGa4Date(dateStr) || '730daysAgo';
}

function defaultEnd(dateStr) {
  return toGa4Date(dateStr) || 'today';
}

// ── Sessions & channel performance ───────────────────────────────────────────

async function getChannelPerformance({ startDate, endDate } = {}) {
  const cacheKey = buildKey(NAMESPACES.GA4, 'channels', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const s = defaultStart(startDate);
    const e = defaultEnd(endDate);

    const data = await runReport({
      dimensions: [{ name: 'sessionDefaultChannelGrouping' }],
      metrics: [
        { name: 'sessions' },
        { name: 'conversions' },
        { name: 'sessionConversionRate' },
      ],
      dateRanges: [{ startDate: s, endDate: e }],
    });

    recordSync('ga4');

    const rows = (data.rows || []).map(row => ({
      channel: row.dimensionValues[0].value,
      sessions: parseInt(row.metricValues[0].value, 10),
      conversions: parseInt(row.metricValues[1].value, 10),
      conversionRate: parseFloat(row.metricValues[2].value),
    }));

    return rows;
  });
}

// ── Organic sessions + conversions ───────────────────────────────────────────

async function getOrganicMetrics({ startDate, endDate } = {}) {
  const cacheKey = buildKey(NAMESPACES.GA4, 'organic', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const channels = await getChannelPerformance({ startDate, endDate });
    const organic = channels.find(c =>
      c.channel.toLowerCase().includes('organic search')
    ) || { sessions: 0, conversions: 0, conversionRate: 0 };

    return {
      sessions: organic.sessions,
      conversions: organic.conversions,
      conversionRate: organic.conversionRate,
      channel: organic.channel,
    };
  });
}

// ── Top landing pages (organic) ───────────────────────────────────────────────

async function getTopOrganicLandingPages({ startDate, endDate, limit = 5 } = {}) {
  const cacheKey = buildKey(NAMESPACES.GA4, 'topPages', startDate, endDate, limit);
  return getOrFetch(cacheKey, async () => {
    const s = defaultStart(startDate);
    const e = defaultEnd(endDate);

    const data = await runReport({
      dimensions: [
        { name: 'landingPagePlusQueryString' },
        { name: 'sessionDefaultChannelGrouping' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'conversions' },
      ],
      dateRanges: [{ startDate: s, endDate: e }],
      dimensionFilter: {
        filter: {
          fieldName: 'sessionDefaultChannelGrouping',
          stringFilter: { matchType: 'CONTAINS', value: 'Organic' },
        },
      },
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit,
    });

    recordSync('ga4');

    return (data.rows || []).map(row => ({
      page: row.dimensionValues[0].value,
      channel: row.dimensionValues[1].value,
      sessions: parseInt(row.metricValues[0].value, 10),
      conversions: parseInt(row.metricValues[1].value, 10),
    }));
  });
}

// ── Bike Rental conversion events ─────────────────────────────────────────────

async function getBikeRentalConversions({ startDate, endDate, eventName } = {}) {
  eventName = eventName || config.ga4.eventBikeRental; // defaults to 'BRM'
  const cacheKey = buildKey(NAMESPACES.GA4, 'bikeRental', startDate, endDate, eventName);
  return getOrFetch(cacheKey, async () => {
    const s = defaultStart(startDate);
    const e = defaultEnd(endDate);

    let regionalData = null;
    let regionalAvailable = false;

    // Attempt regional split using city dimension as best-effort proxy
    try {
      const regionData = await runReport({
        dimensions: [
          { name: 'eventName' },
          { name: 'city' },
        ],
        metrics: [{ name: 'eventCount' }],
        dateRanges: [{ startDate: s, endDate: e }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            stringFilter: { matchType: 'EXACT', value: eventName },
          },
        },
      });

      if (regionData.rows?.length > 0) {
        regionalAvailable = true;
        regionalData = (regionData.rows || []).map(row => ({
          eventName: row.dimensionValues[0].value,
          city: row.dimensionValues[1].value,
          count: parseInt(row.metricValues[0].value, 10),
        }));
      }
    } catch (_) {
      // Regional split failed — fall through to combined
    }

    // Always fetch total — include purchaseRevenue in case the BRM event sends a value
    const totalData = await runReport({
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }, { name: 'purchaseRevenue' }],
      dateRanges: [{ startDate: s, endDate: e }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          stringFilter: { matchType: 'EXACT', value: eventName },
        },
      },
    });

    recordSync('ga4');

    const totalRow = totalData.rows?.[0];
    const total = totalRow ? parseInt(totalRow.metricValues[0].value, 10) : 0;
    const revenueNzd = totalRow ? parseFloat(totalRow.metricValues[1].value || 0) : 0;

    return {
      eventName,
      total,
      revenueNzd,
      regionalAvailable,
      regionalNote: regionalAvailable
        ? 'Regional split is best-effort using GA4 city dimension — may not align exactly with business regions'
        : 'Regional split not available — showing all regions combined',
      regional: regionalData,
      revenueNote: revenueNzd > 0
        ? 'Revenue from GA4 purchaseRevenue metric'
        : 'GA4 conversions only — no $ figure available via API. Use manual override input.',
    };
  });
}

// ── Single Day (Rezdy) GA4 conversions + revenue ─────────────────────────────

async function getSingleDayConversions({ startDate, endDate } = {}) {
  const eventName = config.ga4.eventSingleDay; // 'purchase'
  const cacheKey = buildKey(NAMESPACES.GA4, 'singleDayConv', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const s = defaultStart(startDate);
    const e = defaultEnd(endDate);

    // Channel breakdown (for attribution)
    const byChannelData = await runReport({
      dimensions: [{ name: 'sessionDefaultChannelGrouping' }],
      metrics: [{ name: 'eventCount' }, { name: 'purchaseRevenue' }],
      dateRanges: [{ startDate: s, endDate: e }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          stringFilter: { matchType: 'EXACT', value: eventName },
        },
      },
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    });

    // Daily revenue breakdown for charts
    const dailyData = await runReport({
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'eventCount' }, { name: 'purchaseRevenue' }],
      dateRanges: [{ startDate: s, endDate: e }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          stringFilter: { matchType: 'EXACT', value: eventName },
        },
      },
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
    });

    recordSync('ga4');

    const byChannel = (byChannelData.rows || []).map(row => ({
      channel: row.dimensionValues[0].value,
      conversions: parseInt(row.metricValues[0].value, 10),
      revenueNzd: parseFloat(row.metricValues[1].value || 0),
    }));

    const daily = (dailyData.rows || []).map(row => {
      const d = row.dimensionValues[0].value; // YYYYMMDD
      return {
        date: `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`,
        conversions: parseInt(row.metricValues[0].value, 10),
        revenueNzd: parseFloat(row.metricValues[1].value || 0),
      };
    });

    const total = byChannel.reduce((sum, r) => sum + r.conversions, 0);
    const revenueNzd = byChannel.reduce((sum, r) => sum + r.revenueNzd, 0);

    return {
      eventName,
      total,
      revenueNzd,
      daily,
      byChannel,
      attributionNote: 'GA4-attributed via sessionDefaultChannelGrouping. Revenue from Rezdy purchase events.',
    };
  });
}

// ── Google Ads spend via GA4 linked account ───────────────────────────────────

async function getAdvertiserAdSpend({ startDate, endDate } = {}) {
  const cacheKey = buildKey(NAMESPACES.GA4, 'adSpend', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const s = defaultStart(startDate);
    const e = defaultEnd(endDate);

    const data = await runReport({
      dimensions: [{ name: 'date' }, { name: 'sessionCampaignName' }],
      metrics: [
        { name: 'advertiserAdCost' },
        { name: 'advertiserAdImpressions' },
        { name: 'advertiserAdClicks' },
      ],
      dateRanges: [{ startDate: s, endDate: e }],
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
    });

    recordSync('ga4');

    // Aggregate by date across all campaigns
    const byDate = {};
    for (const row of (data.rows || [])) {
      const raw = row.dimensionValues[0].value; // YYYYMMDD
      const date = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
      if (!byDate[date]) byDate[date] = { date, spendNzd: 0, impressions: 0, clicks: 0 };
      byDate[date].spendNzd    += parseFloat(row.metricValues[0].value || 0);
      byDate[date].impressions += parseInt(row.metricValues[1].value || 0, 10);
      byDate[date].clicks      += parseInt(row.metricValues[2].value || 0, 10);
    }

    const daily = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    const spendNzd    = daily.reduce((s, r) => s + r.spendNzd, 0);
    const impressions = daily.reduce((s, r) => s + r.impressions, 0);
    const clicks      = daily.reduce((s, r) => s + r.clicks, 0);

    return {
      source: 'ga4_linked',
      spendNzd,
      impressions,
      clicks,
      ctr: impressions > 0 ? clicks / impressions : 0,
      daily,
    };
  });
}

// ── Daily sessions over time ──────────────────────────────────────────────────

async function getDailySessions({ startDate, endDate } = {}) {
  const cacheKey = buildKey(NAMESPACES.GA4, 'dailySessions', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const s = defaultStart(startDate);
    const e = defaultEnd(endDate);

    const data = await runReport({
      dimensions: [
        { name: 'date' },
        { name: 'sessionDefaultChannelGrouping' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'conversions' },
      ],
      dateRanges: [{ startDate: s, endDate: e }],
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
    });

    recordSync('ga4');

    return (data.rows || []).map(row => ({
      date: row.dimensionValues[0].value, // YYYYMMDD from GA4
      channel: row.dimensionValues[1].value,
      sessions: parseInt(row.metricValues[0].value, 10),
      conversions: parseInt(row.metricValues[1].value, 10),
    }));
  });
}

// ── Rezdy product-level breakdown ─────────────────────────────────────────────

async function getRezdyProducts({ startDate, endDate } = {}) {
  const eventName = config.ga4.eventSingleDay; // 'purchase'
  const cacheKey = buildKey(NAMESPACES.GA4, 'rezdyProducts', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const s = defaultStart(startDate);
    const e = defaultEnd(endDate);

    const data = await runReport({
      dimensions: [{ name: 'itemName' }],
      metrics: [
        { name: 'itemsPurchased' },
        { name: 'itemRevenue' },
      ],
      dateRanges: [{ startDate: s, endDate: e }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          stringFilter: { matchType: 'EXACT', value: eventName },
        },
      },
      orderBys: [{ metric: { metricName: 'itemRevenue' }, desc: true }],
    });

    recordSync('ga4');

    const products = (data.rows || [])
      .map(row => ({
        name: row.dimensionValues[0].value,
        quantity: parseInt(row.metricValues[0].value || 0, 10),
        revenueNzd: parseFloat(row.metricValues[1].value || 0),
      }))
      .filter(p => p.name && p.name !== '(not set)' && p.revenueNzd > 0);

    const totalQuantity = products.reduce((s, p) => s + p.quantity, 0);
    const totalRevenue  = products.reduce((s, p) => s + p.revenueNzd, 0);

    return { products, totalQuantity, totalRevenue };
  });
}

module.exports = {
  getChannelPerformance,
  getOrganicMetrics,
  getTopOrganicLandingPages,
  getBikeRentalConversions,
  getSingleDayConversions,
  getDailySessions,
  getAdvertiserAdSpend,
  getRezdyProducts,
};
