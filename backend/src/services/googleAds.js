/**
 * Google Ads service — REST API implementation.
 *
 * Uses google-auth-library OAuth2Client to exchange the refresh token for an
 * access token, then calls the Google Ads REST API (v17) directly via axios.
 * This avoids the gRPC client (google-ads-api / google-ads-node) which hangs
 * on require() when initialising channel descriptors at load time.
 *
 * Credentials required in .env:
 *   GOOGLE_ADS_DEVELOPER_TOKEN
 *   GOOGLE_ADS_CLIENT_ID
 *   GOOGLE_ADS_CLIENT_SECRET
 *   GOOGLE_ADS_REFRESH_TOKEN
 *   GOOGLE_ADS_CUSTOMER_ID   (bare ID, no dashes)
 */

const { OAuth2Client } = require('google-auth-library');
const axios = require('axios');
const config = require('../config');
const { getOrFetch, buildKey, NAMESPACES, recordSync } = require('../cache');

// ── Credentials check ─────────────────────────────────────────────────────────

function isConfigured() {
  const c = config.googleAds;
  return !!(c.developerToken && c.clientId && c.clientSecret && c.refreshToken && c.customerId);
}

const NOT_CONFIGURED = {
  configured: false,
  note: 'Google Ads credentials not configured. Set GOOGLE_ADS_DEVELOPER_TOKEN, CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN, CUSTOMER_ID in .env.',
};

// ── Auth ──────────────────────────────────────────────────────────────────────

let _oauth2Client = null;

function getOAuth2Client() {
  if (!_oauth2Client) {
    const c = config.googleAds;
    _oauth2Client = new OAuth2Client(c.clientId, c.clientSecret);
    _oauth2Client.setCredentials({ refresh_token: c.refreshToken });
  }
  return _oauth2Client;
}

async function getAccessToken() {
  const client = getOAuth2Client();
  const { token } = await client.getAccessToken();
  return token;
}

// ── REST helper ───────────────────────────────────────────────────────────────

const GADS_VERSION = 'v21';
const GADS_BASE = `https://googleads.googleapis.com/${GADS_VERSION}`;

/**
 * Execute a GAQL query against the Google Ads REST API.
 * Returns the array of result rows (may be empty).
 */
async function gaqlSearch(gaql) {
  const customerId = config.googleAds.customerId.replace(/-/g, '');
  const token = await getAccessToken();

  const resp = await axios.post(
    `${GADS_BASE}/customers/${customerId}/googleAds:search`,
    { query: gaql },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'developer-token': config.googleAds.developerToken,
        'Content-Type': 'application/json',
        // Required when accessing a client account via an MCC manager account
        ...(config.googleAds.loginCustomerId ? { 'login-customer-id': config.googleAds.loginCustomerId } : {}),
      },
      timeout: 30000,
    }
  );

  return resp.data.results || [];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toGadsDate(dateStr) {
  return dateStr ? dateStr.split('T')[0] : null;
}

function defaultDateRange(startDate, endDate) {
  const s = toGadsDate(startDate);
  const e = toGadsDate(endDate);
  if (s && e) return { s, e };

  const now = new Date();
  const defaultEnd = now.toISOString().split('T')[0];
  const defaultStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  return { s: s || defaultStart, e: e || defaultEnd };
}

// ── Campaign → depot mapping ──────────────────────────────────────────────────

const CAMPAIGN_DEPOT_RULES = [
  { pattern: /Nelson/i,    depot: 'Nelson' },
  { pattern: /Hokitika/i,  depot: 'West Coast' },
  { pattern: /Cromwell/i,  depot: 'Central Otago' },
  { pattern: /Kawarau/i,   depot: 'Kawarau Gorge' },
];

const ALL_DEPOTS = ['Nelson', 'West Coast', 'Central Otago', 'Kawarau Gorge', 'General'];

function campaignToDepot(name) {
  for (const { pattern, depot } of CAMPAIGN_DEPOT_RULES) {
    if (pattern.test(name)) return depot;
  }
  return null;
}

// ── Campaign → tour type mapping ──────────────────────────────────────────────
// Naming convention is explicit: "SEM - NZ - Cromwell - Multi Day" / "... - Single Day / Bike Hire".
// Brand, Trails-only, Pmax, and AU-general campaigns don't target one specific tour
// type, so they're left Unclassified rather than guessed.
const CAMPAIGN_TOUR_TYPE_RULES = [
  { pattern: /multi[\s_-]*day/i,                      type: 'MD' },
  { pattern: /single[\s_-]*day|bike[\s_-]*hire/i,      type: 'SD' },
];

function campaignToTourType(name) {
  for (const { pattern, type } of CAMPAIGN_TOUR_TYPE_RULES) {
    if (pattern.test(name)) return type;
  }
  return 'Unclassified';
}

// ── Campaign-level detail ─────────────────────────────────────────────────────

async function getCampaigns({ startDate, endDate, region } = {}) {
  if (!isConfigured()) return { ...NOT_CONFIGURED, campaigns: [] };

  const cacheKey = buildKey(NAMESPACES.GOOGLE_ADS, 'campaigns', startDate, endDate, region || 'all');
  return getOrFetch(cacheKey, async () => {
    const { s, e } = defaultDateRange(startDate, endDate);

    const gaql = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.conversions,
        metrics.cost_per_conversion
      FROM campaign
      WHERE segments.date BETWEEN '${s}' AND '${e}'
        AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
    `;

    const rows = await gaqlSearch(gaql);
    recordSync('google_ads');

    let mapped = rows.map(row => ({
      id: row.campaign?.id,
      name: row.campaign?.name,
      status: row.campaign?.status,
      spendNzd: Number(row.metrics?.costMicros ?? 0) / 1_000_000,
      impressions: Number(row.metrics?.impressions ?? 0),
      clicks: Number(row.metrics?.clicks ?? 0),
      ctr: Number(row.metrics?.ctr ?? 0),
      conversions: Number(row.metrics?.conversions ?? 0),
      costPerConversionNzd: Number(row.metrics?.costPerConversion ?? 0) / 1_000_000,
    }));

    if (region) mapped = mapped.filter(c => campaignToDepot(c.name) === region);
    return mapped;
  });
}

// ── Summary spend/performance ─────────────────────────────────────────────────

async function getSummary({ startDate, endDate, region } = {}) {
  if (!isConfigured()) return { ...NOT_CONFIGURED, spendNzd: 0, impressions: 0, clicks: 0, ctr: 0, conversions: 0, costPerConversionNzd: null };

  const cacheKey = buildKey(NAMESPACES.GOOGLE_ADS, 'summary', startDate, endDate, region || 'all');
  return getOrFetch(cacheKey, async () => {
    const campaigns = await getCampaigns({ startDate, endDate, region });
    const list = Array.isArray(campaigns) ? campaigns : (campaigns.campaigns || []);

    const totalSpendNzd = list.reduce((sum, c) => sum + (c.spendNzd || 0), 0);
    const totalImpressions = list.reduce((sum, c) => sum + (c.impressions || 0), 0);
    const totalClicks = list.reduce((sum, c) => sum + (c.clicks || 0), 0);
    const totalConversions = list.reduce((sum, c) => sum + (c.conversions || 0), 0);

    return {
      spendNzd: totalSpendNzd,
      impressions: totalImpressions,
      clicks: totalClicks,
      ctr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
      cpcNzd: totalClicks > 0 ? totalSpendNzd / totalClicks : null,
      conversions: totalConversions,
      costPerConversionNzd: totalConversions > 0 ? totalSpendNzd / totalConversions : null,
    };
  });
}

// ── Daily spend over time ─────────────────────────────────────────────────────

async function getDailySpend({ startDate, endDate, region } = {}) {
  if (!isConfigured()) return { ...NOT_CONFIGURED, daily: [] };

  if (region) {
    const depot = await getDepotDailySpend({ startDate, endDate });
    const rows = Array.isArray(depot) ? depot : [];
    return rows
      .filter(r => (r[region] || 0) > 0)
      .map(r => ({ date: r.date, spendNzd: r[region] || 0, impressions: 0, clicks: 0, conversions: 0 }));
  }

  const cacheKey = buildKey(NAMESPACES.GOOGLE_ADS, 'dailySpend', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const { s, e } = defaultDateRange(startDate, endDate);

    const gaql = `
      SELECT
        segments.date,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions
      FROM campaign
      WHERE segments.date BETWEEN '${s}' AND '${e}'
        AND campaign.status != 'REMOVED'
      ORDER BY segments.date ASC
    `;

    const rows = await gaqlSearch(gaql);
    recordSync('google_ads');

    // Aggregate by date across all campaigns
    const byDate = {};
    for (const row of rows) {
      const date = row.segments?.date;
      if (!date) continue;
      if (!byDate[date]) {
        byDate[date] = { date, spendNzd: 0, impressions: 0, clicks: 0, conversions: 0 };
      }
      byDate[date].spendNzd += Number(row.metrics?.costMicros ?? 0) / 1_000_000;
      byDate[date].impressions += Number(row.metrics?.impressions ?? 0);
      byDate[date].clicks += Number(row.metrics?.clicks ?? 0);
      byDate[date].conversions += Number(row.metrics?.conversions ?? 0);
    }

    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  });
}

// ── Daily spend broken down by depot ─────────────────────────────────────────

async function getDepotDailySpend({ startDate, endDate } = {}) {
  if (!isConfigured()) return { ...NOT_CONFIGURED, daily: [] };

  const cacheKey = buildKey(NAMESPACES.GOOGLE_ADS, 'depotDailySpend', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const { s, e } = defaultDateRange(startDate, endDate);

    const gaql = `
      SELECT
        campaign.name,
        segments.date,
        metrics.cost_micros
      FROM campaign
      WHERE segments.date BETWEEN '${s}' AND '${e}'
        AND campaign.status != 'REMOVED'
      ORDER BY segments.date ASC
    `;

    const rows = await gaqlSearch(gaql);
    recordSync('google_ads');

    const byDate = {};
    for (const row of rows) {
      const date = row.segments?.date;
      if (!date) continue;
      const depot = campaignToDepot(row.campaign?.name || '') || 'General';

      if (!byDate[date]) {
        byDate[date] = { date, total: 0 };
        for (const d of ALL_DEPOTS) byDate[date][d] = 0;
      }
      const spend = Number(row.metrics?.costMicros ?? 0) / 1_000_000;
      byDate[date][depot] += spend;
      byDate[date].total  += spend;
    }

    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  });
}

/**
 * Full performance metrics (spend, impressions, clicks, conversions) broken
 * down by depot — single campaign-level fetch, aggregated in one pass.
 */
async function getDepotPerformance({ startDate, endDate } = {}) {
  if (!isConfigured()) return { total: null, byDepot: {} };

  const cacheKey = buildKey(NAMESPACES.GOOGLE_ADS, 'depotPerformance', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const allCampaigns = await getCampaigns({ startDate, endDate }); // no region filter — fetch once
    const list = Array.isArray(allCampaigns) ? allCampaigns : [];

    const emptyBucket = () => ({ spendNzd: 0, impressions: 0, clicks: 0, conversions: 0 });
    const totals = emptyBucket();
    const byDepot = {};
    for (const d of ALL_DEPOTS) byDepot[d] = emptyBucket();

    for (const c of list) {
      const depot = campaignToDepot(c.name) || 'General';
      totals.spendNzd += c.spendNzd; totals.impressions += c.impressions;
      totals.clicks += c.clicks; totals.conversions += c.conversions;
      if (byDepot[depot]) {
        byDepot[depot].spendNzd += c.spendNzd; byDepot[depot].impressions += c.impressions;
        byDepot[depot].clicks += c.clicks; byDepot[depot].conversions += c.conversions;
      }
    }

    const finalize = (b) => ({
      ...b,
      ctr: b.impressions > 0 ? b.clicks / b.impressions : null,
      cpcNzd: b.clicks > 0 ? b.spendNzd / b.clicks : null,
      costPerConversionNzd: b.conversions > 0 ? b.spendNzd / b.conversions : null,
    });

    return {
      total: finalize(totals),
      byDepot: Object.fromEntries(ALL_DEPOTS.filter(d => d !== 'General').map(d => [d, finalize(byDepot[d])])),
    };
  });
}

const TOUR_TYPES = ['MD', 'SD', 'Unclassified'];

/**
 * Spend/impressions/clicks/conversions bucketed by BOTH depot and tour type
 * (MD/SD/Unclassified), single campaign-level fetch. Campaign names carry
 * both tags (e.g. "SEM - NZ - Cromwell - Multi Day" = Central Otago + MD),
 * so this gives real spend attribution for $/MD Enquiry and $/SD Enquiry —
 * not a guess based on total spend.
 */
async function getTourTypeDepotPerformance({ startDate, endDate } = {}) {
  if (!isConfigured()) return { byDepot: {} };

  const cacheKey = buildKey(NAMESPACES.GOOGLE_ADS, 'tourTypeDepotPerformance', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const allCampaigns = await getCampaigns({ startDate, endDate });
    const list = Array.isArray(allCampaigns) ? allCampaigns : [];

    const emptyBucket = () => ({ spendNzd: 0, impressions: 0, clicks: 0, conversions: 0 });
    const byDepot = {};
    for (const d of ALL_DEPOTS) {
      byDepot[d] = {};
      for (const t of TOUR_TYPES) byDepot[d][t] = emptyBucket();
    }

    for (const c of list) {
      const depot = campaignToDepot(c.name) || 'General';
      const tourType = campaignToTourType(c.name);
      const bucket = byDepot[depot]?.[tourType];
      if (!bucket) continue;
      bucket.spendNzd += c.spendNzd; bucket.impressions += c.impressions;
      bucket.clicks += c.clicks; bucket.conversions += c.conversions;
    }

    return { byDepot };
  });
}

module.exports = {
  getSummary,
  getCampaigns,
  getDailySpend,
  getDepotDailySpend,
  getDepotPerformance,
  getTourTypeDepotPerformance,
  isConfigured,
};
