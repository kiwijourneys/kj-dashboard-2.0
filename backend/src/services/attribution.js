/**
 * Ad click-ID attribution — replicates the Claude.ai "Kiwi Journeys Ad
 * Attribution Dashboard" methodology using HubSpot's native click-ID contact
 * properties (hs_facebook_click_id, hs_google_click_id) cross-referenced with
 * deal associations, plus weekly Meta/Google spend and lag-correlation analysis.
 */

const axios = require('axios');
const config = require('../config');
const { getOrFetch, buildKey, NAMESPACES, recordSync } = require('../cache');
const meta = require('./meta');
const googleAds = require('./googleAds');
const hubspot = require('./hubspot');

const { ALL_DEPOTS, normaliseRegions } = hubspot;

const BASE = 'https://api.hubapi.com';
const HEADERS = () => ({
  Authorization: `Bearer ${config.hubspot.accessToken}`,
  'Content-Type': 'application/json',
});

// ── Week bucketing (Monday-anchored, matches HubSpot DATE_TRUNC('WEEK')) ─────

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0];
}

function buildWeekBuckets(startDate, endDate) {
  const weeks = [];
  let cur = mondayOf(startDate);
  const endMonday = mondayOf(endDate);
  while (cur <= endMonday) {
    weeks.push(cur);
    const d = new Date(cur + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 7);
    cur = d.toISOString().split('T')[0];
  }
  return weeks;
}

function toMs(dateStr) {
  return new Date(dateStr + 'T00:00:00Z').getTime() - 12 * 60 * 60 * 1000; // NZ midnight approx
}

// ── HubSpot contact search (paginated) with 429 retry ────────────────────────

async function _postWithRetry(url, body, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await axios.post(url, body, { headers: HEADERS() });
    } catch (err) {
      if (err.response?.status === 429 && attempt < retries) {
        await new Promise(r => setTimeout(r, (2 ** attempt) * 500));
      } else {
        throw err;
      }
    }
  }
}

async function searchContacts({ startDate, endDate }) {
  const filters = [
    ...(startDate ? [{ propertyName: 'createdate', operator: 'GTE', value: toMs(startDate).toString() }] : []),
    ...(endDate   ? [{ propertyName: 'createdate', operator: 'LTE', value: (toMs(endDate) + 86_399_999).toString() }] : []),
  ];
  const properties = ['createdate', 'hs_facebook_click_id', 'hs_google_click_id'];
  const results = [];
  let after;

  do {
    const body = { filterGroups: [{ filters }], properties, limit: 100, ...(after ? { after } : {}) };
    const resp = await _postWithRetry(`${BASE}/crm/v3/objects/contacts/search`, body);
    results.push(...resp.data.results);
    after = resp.data.paging?.next?.after;
  } while (after);

  return results;
}

/**
 * Batch-fetch each contact's first associated deal ID (if any).
 * Uses the v4 associations batch read API, chunked at 100 per request.
 * Returns a Map<contactId, dealId>.
 */
async function getContactToDealMap(contactIds) {
  const map = new Map();
  const chunkSize = 100;

  for (let i = 0; i < contactIds.length; i += chunkSize) {
    const chunk = contactIds.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    const resp = await _postWithRetry(
      `${BASE}/crm/v4/associations/contacts/deals/batch/read`,
      { inputs: chunk.map(id => ({ id })) }
    );
    for (const r of (resp.data.results || [])) {
      // toObjectId comes back as a number from the v4 associations API, but
      // the deals batch-read endpoint returns string IDs — normalise to
      // string here so Map lookups in getDealDepotInfo actually match.
      if (r.to && r.to.length > 0) map.set(r.from.id, String(r.to[0].toObjectId));
    }
  }
  return map;
}

/**
 * Batch-fetch deal properties (location, hubspot_owner_id) for depot
 * classification, chunked at 100 per request (HubSpot batch read limit).
 */
async function getDealDepotInfo(dealIds) {
  const info = new Map();
  const chunkSize = 100;

  for (let i = 0; i < dealIds.length; i += chunkSize) {
    const chunk = dealIds.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    const resp = await _postWithRetry(
      `${BASE}/crm/v3/objects/deals/batch/read`,
      { inputs: chunk.map(id => ({ id })), properties: ['location', 'hubspot_owner_id'] }
    );
    for (const r of (resp.data.results || [])) {
      info.set(r.id, { location: r.properties.location, ownerId: r.properties.hubspot_owner_id });
    }
  }
  return info;
}

// ── Pearson correlation ───────────────────────────────────────────────────────

function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const xs = x.slice(0, n), ys = y.slice(0, n);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, xi, i) => s + (xi - mx) * (ys[i] - my), 0);
  const den = Math.sqrt(
    xs.reduce((s, xi) => s + (xi - mx) ** 2, 0) *
    ys.reduce((s, yi) => s + (yi - my) ** 2, 0)
  );
  return den === 0 ? 0 : num / den;
}

function lagged(spend, contacts, lag) {
  if (lag === 0) return { s: spend, c: contacts };
  return { s: spend.slice(0, spend.length - lag), c: contacts.slice(lag) };
}

function strengthLabel(r) {
  if (r === null) return 'Insufficient data';
  const a = Math.abs(r);
  if (a >= 0.7) return r > 0 ? 'Strong positive' : 'Strong negative';
  if (a >= 0.4) return r > 0 ? 'Moderate positive' : 'Moderate negative';
  if (a >= 0.2) return r > 0 ? 'Weak positive' : 'Weak negative';
  return 'Negligible';
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

async function getAdAttribution({ startDate, endDate } = {}) {
  if (!startDate || !endDate) throw new Error('startDate and endDate are required');

  const cacheKey = buildKey(NAMESPACES.HUBSPOT, 'adAttribution', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const weeks = buildWeekBuckets(startDate, endDate);

    const [contacts, metaDaily, gadsDaily] = await Promise.all([
      searchContacts({ startDate, endDate }),
      meta.getDailySpend({ startDate, endDate }),
      googleAds.getDailySpend({ startDate, endDate }),
    ]);
    recordSync('hubspot');

    const contactIds = contacts.map(c => c.id);
    const contactToDeal = await getContactToDealMap(contactIds);

    // ── Stat cards ───────────────────────────────────────────────────────────
    let totalContacts = 0, totalDealContacts = 0, metaContacts = 0, googleContacts = 0;
    const weeklyMeta  = Object.fromEntries(weeks.map(w => [w, 0]));
    const weeklyGoogle = Object.fromEntries(weeks.map(w => [w, 0]));
    const weeklyTotal  = Object.fromEntries(weeks.map(w => [w, 0]));

    for (const c of contacts) {
      totalContacts++;
      const hasDeal = contactToDeal.has(c.id);
      if (!hasDeal) continue;
      totalDealContacts++;

      const createDate = c.properties.createdate?.split('T')[0];
      const week = createDate ? mondayOf(createDate) : null;
      if (week && weeklyTotal[week] !== undefined) weeklyTotal[week]++;

      const hasFb = !!c.properties.hs_facebook_click_id;
      const hasGg = !!c.properties.hs_google_click_id;
      if (hasFb) {
        metaContacts++;
        if (week && weeklyMeta[week] !== undefined) weeklyMeta[week]++;
      } else if (hasGg) {
        googleContacts++;
        if (week && weeklyGoogle[week] !== undefined) weeklyGoogle[week]++;
      }
    }

    // ── Weekly spend (aggregate daily into Monday-anchored weeks) ───────────
    const weeklyMetaSpend  = Object.fromEntries(weeks.map(w => [w, 0]));
    const weeklyGadsSpend  = Object.fromEntries(weeks.map(w => [w, 0]));

    const metaDailyList = Array.isArray(metaDaily) ? metaDaily : [];
    const gadsDailyList = Array.isArray(gadsDaily) ? gadsDaily : [];

    for (const row of metaDailyList) {
      const week = mondayOf(row.date);
      if (weeklyMetaSpend[week] !== undefined) weeklyMetaSpend[week] += row.spendNzd || 0;
    }
    for (const row of gadsDailyList) {
      const week = mondayOf(row.date);
      if (weeklyGadsSpend[week] !== undefined) weeklyGadsSpend[week] += row.spendNzd || 0;
    }

    // ── Build aligned arrays for chart + correlation ────────────────────────
    const metaC   = weeks.map(w => weeklyMeta[w]);
    const googleC = weeks.map(w => weeklyGoogle[w]);
    const totalC  = weeks.map(w => weeklyTotal[w]);
    const otherC  = weeks.map((w, i) => Math.max(0, totalC[i] - metaC[i] - googleC[i]));
    const metaS   = weeks.map(w => weeklyMetaSpend[w]);
    const googleS = weeks.map(w => weeklyGadsSpend[w]);

    const totalMetaSpend   = metaS.reduce((a, b) => a + b, 0);
    const totalGoogleSpend = googleS.reduce((a, b) => a + b, 0);

    // ── Correlation pairs at lags 0-3 ────────────────────────────────────────
    const pairs = [
      { key: 'metaOwn',     label: 'Meta spend → Meta contacts',     spend: metaS,   contacts: metaC },
      { key: 'googleOwn',   label: 'Google spend → Google contacts', spend: googleS, contacts: googleC },
      { key: 'metaTotal',   label: 'Meta spend → total contacts',    spend: metaS,   contacts: totalC },
      { key: 'googleTotal', label: 'Google spend → total contacts',  spend: googleS, contacts: totalC },
    ];

    const correlations = pairs.map(p => {
      const byLag = [0, 1, 2, 3].map(lag => {
        const { s, c } = lagged(p.spend, p.contacts, lag);
        const r = pearson(s, c);
        return { lag, r, strength: strengthLabel(r) };
      });
      const best = byLag.reduce((a, b) => (Math.abs(b.r || 0) > Math.abs(a.r || 0) ? b : a), byLag[0]);
      const bestLagged = lagged(p.spend, p.contacts, best.lag);
      return {
        key: p.key,
        label: p.label,
        byLag,
        bestLag: best.lag,
        bestR: best.r,
        bestStrength: best.strength,
        scatter: bestLagged.s.map((s, i) => ({ x: s, y: bestLagged.c[i] })),
      };
    });

    return {
      period: { startDate, endDate },
      weeks,
      statCards: {
        totalContacts,
        totalDealContacts,
        metaContacts,
        metaPct: totalDealContacts > 0 ? (metaContacts / totalDealContacts) * 100 : null,
        googleContacts,
        googlePct: totalDealContacts > 0 ? (googleContacts / totalDealContacts) * 100 : null,
        metaSpendNzd: totalMetaSpend,
        googleSpendNzd: totalGoogleSpend,
      },
      weeklyChart: weeks.map((w, i) => ({
        week: w,
        metaContacts: metaC[i],
        googleContacts: googleC[i],
        otherContacts: otherC[i],
        metaSpendNzd: metaS[i],
        googleSpendNzd: googleS[i],
      })),
      correlations,
    };
  });
}

/**
 * Click-ID-based Meta/Google attributed enquiry counts, bucketed by depot —
 * the same hard signal (hs_facebook_click_id / hs_google_click_id) used for
 * the Ad Attribution stat cards, instead of HubSpot's deal-level
 * hs_analytics_source field (which undercounts — see marketingDashboard.js).
 * Depot is classified from the associated deal's location/owner.
 */
async function getClickIdAttributionByDepot({ startDate, endDate } = {}) {
  if (!startDate || !endDate) throw new Error('startDate and endDate are required');

  const cacheKey = buildKey(NAMESPACES.HUBSPOT, 'clickIdAttributionByDepot', startDate, endDate);
  return getOrFetch(cacheKey, async () => {
    const contacts = await searchContacts({ startDate, endDate });
    recordSync('hubspot');

    const contactIds = contacts.map(c => c.id);
    const contactToDeal = await getContactToDealMap(contactIds);

    const dealIds = [...new Set(contactToDeal.values())];
    const dealDepotInfo = await getDealDepotInfo(dealIds);

    const emptyBucket = () => ({ meta: 0, gads: 0 });
    const totals = emptyBucket();
    const byDepot = {};
    for (const d of ALL_DEPOTS) byDepot[d] = emptyBucket();

    for (const c of contacts) {
      const dealId = contactToDeal.get(c.id);
      if (!dealId) continue;

      const hasFb = !!c.properties.hs_facebook_click_id;
      const hasGg = !!c.properties.hs_google_click_id;
      if (!hasFb && !hasGg) continue;

      const channel = hasFb ? 'meta' : 'gads';
      totals[channel]++;

      const dealInfo = dealDepotInfo.get(dealId);
      const regions = dealInfo
        ? normaliseRegions(dealInfo.location, dealInfo.ownerId).filter(r => ALL_DEPOTS.includes(r))
        : [];
      for (const r of regions) byDepot[r][channel]++;
    }

    return { total: totals, byDepot };
  });
}

module.exports = { getAdAttribution, getClickIdAttributionByDepot };
