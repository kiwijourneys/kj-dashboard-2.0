const axios = require('axios');
const config = require('../config');
const { getOrFetch, buildKey, NAMESPACES, recordSync } = require('../cache');

const META_BASE = 'https://graph.facebook.com';
const API_VERSION = config.meta.apiVersion;

// ── Adset → depot mapping (mirrors Google Ads CAMPAIGN_DEPOT_RULES) ───────────

// Meta adsets use region labels ("West Coast", "Central Otago") rather than
// town names ("Hokitika", "Cromwell") — so patterns here are broader than Google's.
// "Lake Dunstan" and "GTT/Great Taste" are product-level aliases for Central Otago
// and Nelson respectively.
const ADSET_DEPOT_RULES = [
  { pattern: /Nelson/i,                                depot: 'Nelson' },
  { pattern: /Great[\s_-]*Taste|GTT/i,                depot: 'Nelson' },
  { pattern: /Hokitika|West[\s_-]*Coast/i,            depot: 'West Coast' },
  { pattern: /Cromwell|Central[\s_-]*Otago|Lake[\s_-]*Dunstan/i, depot: 'Central Otago' },
  { pattern: /Kawarau/i,                              depot: 'Kawarau Gorge' },
];

const ALL_DEPOTS = ['Nelson', 'West Coast', 'Central Otago', 'Kawarau Gorge', 'General'];

function adsetToDepot(name) {
  for (const { pattern, depot } of ADSET_DEPOT_RULES) {
    if (pattern.test(name)) return depot;
  }
  return null;
}

// ── Tour type classification ──────────────────────────────────────────────────
// SD if: campaign name contains "SD" (e.g. "NZ | SD | Prospecting | School holidays"),
//        OR adset name matches legacy "one day / bike hire" patterns.
// Everything else defaults to MD (multi-day is the core product).
const ADSET_SD_PATTERNS = /one[\s_-]*day|bike[\s_-]*hire/i;

function adsetToTourType(adsetName, campaignName) {
  // Campaign-name rule: any campaign with "SD" as a word/segment is single-day
  if (/\bSD\b/.test(campaignName || '')) return 'SD';
  // Legacy adset-name rule
  if (ADSET_SD_PATTERNS.test(adsetName || '')) return 'SD';
  return 'MD';
}

function metaUrl(path) {
  return `${META_BASE}/${API_VERSION}/${path}`;
}

function defaultParams() {
  return { access_token: config.meta.accessToken };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert Meta spend (reported in USD) to NZD using configured FX rate.
 */
function toNzd(usdAmount) {
  return parseFloat(usdAmount || 0) * config.fxRateUsdToNzd;
}

function formatDate(dateStr) {
  // Meta expects YYYY-MM-DD
  return dateStr ? dateStr.split('T')[0] : null;
}

function buildTimeRange(startDate, endDate) {
  const s = formatDate(startDate);
  const e = formatDate(endDate);
  if (!s && !e) return null;
  return JSON.stringify({
    since: s || '2020-01-01',
    until: e || new Date().toISOString().split('T')[0],
  });
}

// ── Account-level summary ─────────────────────────────────────────────────────

async function getSummary({ startDate, endDate, region } = {}) {
  if (region) {
    const depot = await getDepotDailySpend({ startDate, endDate });
    const rows = Array.isArray(depot) ? depot : [];
    const spendNzd = rows.reduce((s, r) => s + (r[region] || 0), 0);
    return { spendNzd, spendUsd: spendNzd, fxRate: config.fxRateUsdToNzd, impressions: 0, clicks: 0, ctr: 0, leads: 0 };
  }

  const cacheKey = buildKey(NAMESPACES.META, 'summary', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const timeRange = buildTimeRange(startDate, endDate);
    const params = {
      ...defaultParams(),
      fields: 'spend,impressions,clicks,ctr,actions,cost_per_action_type',
      level: 'account',
      ...(timeRange ? { time_range: timeRange } : { date_preset: 'this_month' }),
    };

    const resp = await axios.get(
      metaUrl(`act_${config.meta.adAccountId}/insights`),
      { params }
    );

    const data = resp.data.data?.[0] || {};
    const spendNzd = toNzd(data.spend);
    const impressions = parseInt(data.impressions || 0, 10);
    const clicks = parseInt(data.clicks || 0, 10);
    const ctr = parseFloat(data.ctr || 0) / 100; // Meta returns % as string

    // Extract lead/conversion actions
    const actions = data.actions || [];
    const leads = actions
      .filter(a => ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped'].includes(a.action_type))
      .reduce((sum, a) => sum + parseInt(a.value || 0, 10), 0);

    recordSync('meta');

    return {
      spendUsd: parseFloat(data.spend || 0),
      spendNzd,
      fxRate: config.fxRateUsdToNzd,
      impressions,
      clicks,
      ctr,
      leads,
    };
  });
}

// ── Campaign-level detail ─────────────────────────────────────────────────────

async function getCampaigns({ startDate, endDate } = {}) {
  const cacheKey = buildKey(NAMESPACES.META, 'campaigns', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const timeRange = buildTimeRange(startDate, endDate);
    const params = {
      ...defaultParams(),
      fields: 'campaign_name,campaign_id,spend,impressions,clicks,ctr,actions,cost_per_action_type',
      level: 'campaign',
      ...(timeRange ? { time_range: timeRange } : { date_preset: 'this_month' }),
      limit: 100,
    };

    const rows = [];
    let url = metaUrl(`act_${config.meta.adAccountId}/insights`);

    while (url) {
      const resp = await axios.get(url, { params: url.includes('?') ? {} : params });
      rows.push(...(resp.data.data || []));
      url = resp.data.paging?.next || null;
      // After first page, params are baked into the cursor URL
    }

    recordSync('meta');

    return rows.map(row => {
      const actions = row.actions || [];
      const leads = actions
        .filter(a => ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped'].includes(a.action_type))
        .reduce((sum, a) => sum + parseInt(a.value || 0, 10), 0);

      const spendNzd = toNzd(row.spend);
      const cpr = leads > 0 ? spendNzd / leads : null;

      return {
        id: row.campaign_id,
        name: row.campaign_name,
        status: row.effective_status,
        spendUsd: parseFloat(row.spend || 0),
        spendNzd,
        impressions: parseInt(row.impressions || 0, 10),
        clicks: parseInt(row.clicks || 0, 10),
        ctr: parseFloat(row.ctr || 0) / 100,
        leads,
        costPerResultNzd: cpr,
      };
    });
  });
}

// ── Daily spend over time ─────────────────────────────────────────────────────

async function getDailySpend({ startDate, endDate, region } = {}) {
  if (region) {
    const depot = await getDepotDailySpend({ startDate, endDate });
    const rows = Array.isArray(depot) ? depot : [];
    return rows
      .filter(r => (r[region] || 0) > 0)
      .map(r => ({ date: r.date, spendNzd: r[region] || 0, impressions: 0, clicks: 0 }));
  }

  const cacheKey = buildKey(NAMESPACES.META, 'dailySpend', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const timeRange = buildTimeRange(startDate, endDate);
    const params = {
      ...defaultParams(),
      fields: 'spend,impressions,clicks,actions',
      level: 'account',
      time_increment: 1, // daily breakdown
      ...(timeRange ? { time_range: timeRange } : { date_preset: 'this_month' }),
      limit: 200,
    };

    const rows = [];
    let url = metaUrl(`act_${config.meta.adAccountId}/insights`);

    while (url) {
      const resp = await axios.get(url, { params: url.includes('?') ? {} : params });
      rows.push(...(resp.data.data || []));
      url = resp.data.paging?.next || null;
    }

    recordSync('meta');

    return rows.map(row => {
      const actions = row.actions || [];
      const leads = actions
        .filter(a => ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped'].includes(a.action_type))
        .reduce((sum, a) => sum + parseInt(a.value || 0, 10), 0);
      return {
        date: row.date_start,
        spendNzd: toNzd(row.spend),
        impressions: parseInt(row.impressions || 0, 10),
        clicks: parseInt(row.clicks || 0, 10),
        leads,
      };
    }).sort((a, b) => a.date.localeCompare(b.date));
  });
}

// ── Daily spend broken down by depot (adset-level) ───────────────────────────
// Queries Meta insights at adset level so adsets named with regional keywords
// (Nelson, Hokitika, Cromwell, Kawarau) are attributed to the matching depot.
// Adsets without a regional keyword are excluded from the per-depot totals but
// still appear in the overall Meta daily spend (getDailySpend).

async function getDepotDailySpend({ startDate, endDate } = {}) {
  const cacheKey = buildKey(NAMESPACES.META, 'depotDailySpend', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const timeRange = buildTimeRange(startDate, endDate);
    const params = {
      ...defaultParams(),
      fields: 'adset_name,spend,date_start',
      level: 'adset',
      time_increment: 1,
      ...(timeRange ? { time_range: timeRange } : { date_preset: 'this_month' }),
      limit: 500,
    };

    const rows = [];
    let url = metaUrl(`act_${config.meta.adAccountId}/insights`);

    while (url) {
      const resp = await axios.get(url, { params: url.includes('?') ? {} : params });
      rows.push(...(resp.data.data || []));
      url = resp.data.paging?.next || null;
    }

    recordSync('meta');

    // Aggregate spend per day per depot
    const byDate = {};
    for (const row of rows) {
      const date = row.date_start;
      if (!date) continue;
      const depot = adsetToDepot(row.adset_name || '') || 'General';

      if (!byDate[date]) {
        byDate[date] = { date, total: 0 };
        for (const d of ALL_DEPOTS) byDate[date][d] = 0;
      }
      const spend = toNzd(row.spend);
      byDate[date][depot] += spend;
      byDate[date].total  += spend;
    }

    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  });
}

/**
 * Full performance metrics (spend, impressions, clicks, leads/results) broken
 * down by depot — single adset-level fetch, aggregated in one pass.
 * Unlike getDepotDailySpend, this isn't bucketed by day (no time_increment),
 * so it's lighter and suitable for "Total & per Depot" KPI tables.
 */
async function getDepotPerformance({ startDate, endDate } = {}) {
  const cacheKey = buildKey(NAMESPACES.META, 'depotPerformance', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const timeRange = buildTimeRange(startDate, endDate);
    const params = {
      ...defaultParams(),
      fields: 'adset_name,spend,impressions,clicks,ctr,actions',
      level: 'adset',
      ...(timeRange ? { time_range: timeRange } : { date_preset: 'this_month' }),
      limit: 500,
    };

    const rows = [];
    let url = metaUrl(`act_${config.meta.adAccountId}/insights`);

    while (url) {
      const resp = await axios.get(url, { params: url.includes('?') ? {} : params });
      rows.push(...(resp.data.data || []));
      url = resp.data.paging?.next || null;
    }

    recordSync('meta');

    const emptyBucket = () => ({ spendNzd: 0, impressions: 0, clicks: 0, leads: 0 });
    const totals = emptyBucket();
    const byDepot = {};
    for (const d of ALL_DEPOTS) byDepot[d] = emptyBucket();

    for (const row of rows) {
      const depot = adsetToDepot(row.adset_name || '') || 'General';
      const spendNzd = toNzd(row.spend);
      const impressions = parseInt(row.impressions || 0, 10);
      const clicks = parseInt(row.clicks || 0, 10);
      const actions = row.actions || [];
      const leads = actions
        .filter(a => ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped'].includes(a.action_type))
        .reduce((sum, a) => sum + parseInt(a.value || 0, 10), 0);

      totals.spendNzd += spendNzd; totals.impressions += impressions; totals.clicks += clicks; totals.leads += leads;
      if (byDepot[depot]) {
        byDepot[depot].spendNzd += spendNzd; byDepot[depot].impressions += impressions;
        byDepot[depot].clicks += clicks; byDepot[depot].leads += leads;
      }
    }

    const finalize = (b) => ({
      ...b,
      ctr: b.impressions > 0 ? b.clicks / b.impressions : null,
      cpcNzd: b.clicks > 0 ? b.spendNzd / b.clicks : null,
      costPerResultNzd: b.leads > 0 ? b.spendNzd / b.leads : null,
    });

    return {
      total: finalize(totals),
      byDepot: Object.fromEntries(ALL_DEPOTS.filter(d => d !== 'General').map(d => [d, finalize(byDepot[d])])),
    };
  });
}

const TOUR_TYPES = ['MD', 'SD'];

/**
 * Spend/impressions/clicks/leads bucketed by BOTH depot and tour type
 * (MD/SD), single adset-level fetch. Adset names carry both tags (e.g.
 * "NZ| One Day Tours | Nelson Specific Tours" = Nelson + SD), giving real
 * spend attribution for $/MD Enquiry and $/SD Enquiry.
 */
async function getTourTypeDepotPerformance({ startDate, endDate } = {}) {
  const cacheKey = buildKey(NAMESPACES.META, 'tourTypeDepotPerformance', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const timeRange = buildTimeRange(startDate, endDate);
    const params = {
      ...defaultParams(),
      fields: 'campaign_name,adset_name,spend,impressions,clicks,actions',
      level: 'adset',
      ...(timeRange ? { time_range: timeRange } : { date_preset: 'this_month' }),
      limit: 500,
    };

    const rows = [];
    let url = metaUrl(`act_${config.meta.adAccountId}/insights`);

    while (url) {
      const resp = await axios.get(url, { params: url.includes('?') ? {} : params });
      rows.push(...(resp.data.data || []));
      url = resp.data.paging?.next || null;
    }

    recordSync('meta');

    const emptyBucket = () => ({ spendNzd: 0, impressions: 0, clicks: 0, leads: 0 });
    const byDepot = {};
    for (const d of ALL_DEPOTS) {
      byDepot[d] = {};
      for (const t of TOUR_TYPES) byDepot[d][t] = emptyBucket();
    }

    for (const row of rows) {
      const depot = adsetToDepot(row.adset_name || '') || 'General';
      const tourType = adsetToTourType(row.adset_name || '', row.campaign_name || '');
      const bucket = byDepot[depot]?.[tourType];
      if (!bucket) continue;

      const actions = row.actions || [];
      const leads = actions
        .filter(a => ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped'].includes(a.action_type))
        .reduce((sum, a) => sum + parseInt(a.value || 0, 10), 0);

      bucket.spendNzd += toNzd(row.spend);
      bucket.impressions += parseInt(row.impressions || 0, 10);
      bucket.clicks += parseInt(row.clicks || 0, 10);
      bucket.leads += leads;
    }

    return { byDepot };
  });
}

// ── Depot × Country matrix (spend + leads) ───────────────────────────────────
//
// Extracts the country code from campaign names following the pattern:
//   "NZ | SD | Prospecting | School holidays"
//   "AUS | MD | ..."
// The first pipe-delimited segment is the country. Falls back to 'Other'.

const KNOWN_COUNTRIES = ['NZ', 'AUS', 'UK', 'US', 'CA', 'DE', 'FR'];

function campaignToCountry(campaignName) {
  if (!campaignName) return 'Other';
  const segment = (campaignName.split('|')[0] || '').trim().toUpperCase();
  if (KNOWN_COUNTRIES.includes(segment)) return segment;
  return 'Other';
}

/**
 * Returns spend and Meta lead counts broken down by depot × country.
 * Shape: { countries: string[], depots: string[], matrix: { [depot]: { [country]: { spendNzd, leads, cpl } } } }
 */
async function getDepotCountryMatrix({ startDate, endDate } = {}) {
  const cacheKey = buildKey(NAMESPACES.META, 'depotCountryMatrix', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const timeRange = buildTimeRange(startDate, endDate);
    const params = {
      ...defaultParams(),
      fields: 'campaign_name,adset_name,spend,actions',
      level: 'adset',
      ...(timeRange ? { time_range: timeRange } : { date_preset: 'this_month' }),
      limit: 500,
    };

    const rows = [];
    let url = metaUrl(`act_${config.meta.adAccountId}/insights`);
    while (url) {
      const resp = await axios.get(url, { params: url.includes('?') ? {} : params });
      rows.push(...(resp.data.data || []));
      url = resp.data.paging?.next || null;
    }

    recordSync('meta');

    // Build matrix
    const matrix = {};
    const countrySet = new Set();
    for (const d of ALL_DEPOTS) matrix[d] = {};

    for (const row of rows) {
      const depot = adsetToDepot(row.adset_name || '') || 'General';
      const country = campaignToCountry(row.campaign_name);
      countrySet.add(country);

      if (!matrix[depot][country]) matrix[depot][country] = { spendNzd: 0, leads: 0 };
      matrix[depot][country].spendNzd += toNzd(row.spend);

      const actions = row.actions || [];
      const leads = actions
        .filter(a => ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped'].includes(a.action_type))
        .reduce((sum, a) => sum + parseInt(a.value || 0, 10), 0);
      matrix[depot][country].leads += leads;
    }

    // Compute cpl in each cell
    const countries = Array.from(countrySet).sort();
    for (const depot of ALL_DEPOTS) {
      for (const country of countries) {
        const cell = matrix[depot][country];
        if (cell) cell.cpl = cell.leads > 0 ? cell.spendNzd / cell.leads : null;
      }
    }

    return { countries, depots: ALL_DEPOTS, matrix };
  });
}

// ── Daily spend broken down by tour type (MD / SD / Unclassified) ─────────────
async function getTourTypeDailySpend({ startDate, endDate } = {}) {
  const cacheKey = buildKey(NAMESPACES.META, 'tourTypeDailySpend', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const timeRange = buildTimeRange(startDate, endDate);
    const params = {
      ...defaultParams(),
      fields: 'campaign_name,adset_name,spend,date_start',
      level: 'adset',
      time_increment: 1,
      ...(timeRange ? { time_range: timeRange } : { date_preset: 'this_month' }),
      limit: 500,
    };

    const rows = [];
    let url = metaUrl(`act_${config.meta.adAccountId}/insights`);
    while (url) {
      const resp = await axios.get(url, { params: url.includes('?') ? {} : params });
      rows.push(...(resp.data.data || []));
      url = resp.data.paging?.next || null;
    }

    recordSync('meta');

    const byDate = {};
    for (const row of rows) {
      const date = row.date_start;
      if (!date) continue;
      const tourType = adsetToTourType(row.adset_name || '', row.campaign_name || '');
      if (!byDate[date]) byDate[date] = { date, MD: 0, SD: 0, Unclassified: 0 };
      byDate[date][tourType] = (byDate[date][tourType] || 0) + toNzd(row.spend);
    }

    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  });
}

// ── Daily performance by country + depot + tour type ─────────────────────────
//
// Returns one row per (date, country, depot, tourType) with spend + leads.
// Used for the country-level weekly chart.

async function getCountryDailyPerformance({ startDate, endDate } = {}) {
  const cacheKey = buildKey(NAMESPACES.META, 'countryDailyPerf', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const timeRange = buildTimeRange(startDate, endDate);
    const params = {
      ...defaultParams(),
      fields: 'campaign_name,adset_name,spend,actions,date_start',
      level: 'adset',
      time_increment: 1,
      ...(timeRange ? { time_range: timeRange } : { date_preset: 'this_month' }),
      limit: 500,
    };

    const rows = [];
    let url = metaUrl(`act_${config.meta.adAccountId}/insights`);
    while (url) {
      const resp = await axios.get(url, { params: url.includes('?') ? {} : params });
      rows.push(...(resp.data.data || []));
      url = resp.data.paging?.next || null;
    }

    recordSync('meta');

    return rows.map(row => {
      const actions = row.actions || [];
      const leads = actions
        .filter(a => ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped'].includes(a.action_type))
        .reduce((sum, a) => sum + parseInt(a.value || 0, 10), 0);
      return {
        date:     row.date_start,
        country:  campaignToCountry(row.campaign_name),
        depot:    adsetToDepot(row.adset_name || '') || 'General',
        tourType: adsetToTourType(row.adset_name || '', row.campaign_name || ''),
        spendNzd: toNzd(row.spend),
        leads,
      };
    }).filter(r => r.date);
  });
}

module.exports = {
  getSummary,
  getCampaigns,
  getDailySpend,
  getDepotDailySpend,
  getDepotPerformance,
  getTourTypeDepotPerformance,
  getTourTypeDailySpend,
  getDepotCountryMatrix,
  getCountryDailyPerformance,
  toNzd,
};
