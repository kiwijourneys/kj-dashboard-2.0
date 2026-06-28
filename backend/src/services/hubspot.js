const axios = require('axios');
const config = require('../config');
const { getOrFetch, buildKey, NAMESPACES, recordSync } = require('../cache');

const BASE = 'https://api.hubapi.com';
const HEADERS = () => ({
  Authorization: `Bearer ${config.hubspot.accessToken}`,
  'Content-Type': 'application/json',
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Maps HubSpot owner ID → canonical region name for the three depot inboxes.
 * Deals with no location set fall back to this mapping.
 */
const OWNER_REGION_MAP = {
  '359217253': 'West Coast',     // westcoast@kiwijourneys.co.nz
  '359217254': 'Central Otago',  // centralotago@kiwijourneys.co.nz
  '359217255': 'Nelson',         // nelson@kiwijourneys.co.nz
};

const ALL_DEPOTS = ['Nelson', 'West Coast', 'Central Otago', 'Kawarau Gorge'];

/**
 * Normalise a HubSpot location value into canonical region names.
 * Returns an array because a deal can have multiple regions (semicolon-delimited).
 * Falls back to owner ID when location is empty.
 */
function normaliseRegions(locationValue, ownerId) {
  if (locationValue) {
    return locationValue
      .split(';')
      .map(s => s.trim())
      .filter(Boolean)
      .map(val => config.depotRegionMap[val] ?? val);
  }
  // Fallback: map owner ID to region
  const ownerRegion = ownerId ? OWNER_REGION_MAP[String(ownerId)] : null;
  return ownerRegion ? [ownerRegion] : ['General'];
}

/**
 * Return true if this deal's regions include the target region.
 * Pass null/undefined targetRegion to match everything.
 */
function matchesRegion(locationValue, targetRegion, ownerId) {
  if (!targetRegion) return true;
  const regions = normaliseRegions(locationValue, ownerId);
  return regions.includes(targetRegion);
}

/**
 * Classify a deal's original source into a channel bucket using HubSpot's
 * native analytics source tracking (hs_analytics_source).
 * PAID_SOCIAL covers Facebook/Instagram (Meta) ads; PAID_SEARCH covers Google/Bing.
 */
function classifySource(sourceValue) {
  if (sourceValue === 'PAID_SOCIAL') return 'meta';
  if (sourceValue === 'PAID_SEARCH') return 'gads';
  return 'other';
}

/**
 * Convert a YYYY-MM-DD date string to milliseconds for HubSpot API filters.
 * HubSpot reports use NZ time (Pacific/Auckland = UTC+12/+13).
 * Treating the date as midnight NZT means going 12-13 hours earlier in UTC,
 * which ensures we capture deals created on that calendar day in NZ.
 * We use UTC+12 (NZST) as a conservative offset — close enough for day boundaries.
 */
const NZ_OFFSET_MS = 12 * 60 * 60 * 1000; // UTC+12

function toMs(dateStr) {
  if (!dateStr) return null;
  // If it's a bare date (YYYY-MM-DD), treat it as NZ midnight → subtract 12 h to get UTC
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(dateStr + 'T00:00:00Z').getTime() - NZ_OFFSET_MS;
  }
  return new Date(dateStr).getTime();
}

// ── Concurrency limiter ───────────────────────────────────────────────────────
//
// HubSpot CRM Search API allows ~4 requests/second per token.
// With many parallel dashboard queries we can exceed that easily.
// This limiter caps concurrent search calls at 3 with a 250 ms gap between
// releases, keeping us safely under the rate limit.

class ConcurrencyLimiter {
  constructor(maxConcurrent = 3, releaseDelayMs = 250) {
    this._max = maxConcurrent;
    this._running = 0;
    this._delay = releaseDelayMs;
    this._queue = [];
  }
  async run(fn) {
    if (this._running >= this._max) {
      await new Promise(resolve => this._queue.push(resolve));
    }
    this._running++;
    try {
      return await fn();
    } finally {
      await new Promise(r => setTimeout(r, this._delay));
      this._running--;
      const next = this._queue.shift();
      if (next) next();
    }
  }
}

const _hs = new ConcurrencyLimiter(2, 350);

/**
 * POST to HubSpot's deal search endpoint with 429 retry + backoff.
 * The Marketing dashboard fires many search calls per load; even with the
 * concurrency limiter, HubSpot's "secondly" cap can still be hit occasionally.
 */
async function _postWithRetry(body, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await axios.post(`${BASE}/crm/v3/objects/deals/search`, body, { headers: HEADERS() });
    } catch (err) {
      if (err.response?.status === 429 && attempt < retries) {
        const delay = (2 ** attempt) * 500;
        console.warn(`[hubspot] 429 rate limit — retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Fetch a single deal's dealstage change history (most-recent-first) with
 * 429 retry. Used to find the exact timestamp a deal entered a given stage,
 * rather than approximating with closedate/hs_lastmodifieddate.
 */
async function _getDealStageHistory(dealId, retries = 3) {
  const url = `${BASE}/crm/v3/objects/deals/${dealId}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await axios.get(url, { headers: HEADERS(), params: { propertiesWithHistory: 'dealstage' } });
      return resp.data.propertiesWithHistory?.dealstage || [];
    } catch (err) {
      if (err.response?.status === 429 && attempt < retries) {
        await new Promise(r => setTimeout(r, (2 ** attempt) * 500));
      } else {
        throw err;
      }
    }
  }
}

/**
 * From a dealstage history array, find the earliest timestamp the deal
 * entered the given stage (handles the rare case of a deal re-entering a
 * stage after later edits, by taking the first transition into it).
 */
function _findStageEntryTimestamp(history, stageId) {
  const matches = history.filter(h => h.value === stageId);
  if (matches.length === 0) return null;
  return matches.reduce((min, h) => (!min || h.timestamp < min ? h.timestamp : min), null);
}

/**
 * Resolve the actual "entered this stage" timestamp for a won deal, fetched
 * via property history and routed through the shared concurrency limiter.
 * Falls back to closedate/hs_lastmodifieddate if history is unavailable.
 */
async function _resolveWonTimestamp(dealId, wonStageId, fallbackCloseTs) {
  try {
    const history = await _hs.run(() => _getDealStageHistory(dealId));
    const entered = _findStageEntryTimestamp(history, wonStageId);
    if (entered) return new Date(entered).getTime();
  } catch (err) {
    console.warn(`[hubspot] Could not fetch stage history for deal ${dealId}:`, err.message);
  }
  return fallbackCloseTs;
}

// ── Core paged fetch ──────────────────────────────────────────────────────────

async function searchDeals(filters, properties = [], limit = 100) {
  const results = [];
  let after = undefined;

  const defaultProperties = [
    'dealname', 'amount', 'dealstage', 'pipeline',
    'createdate', 'closedate', 'hs_lastmodifieddate',
    'location', 'deal_currency_code', 'hs_date_entered_closedwon',
    'start_date', 'hubspot_owner_id',
    'hs_analytics_source', 'hs_analytics_source_data_1', 'hs_analytics_source_data_2',
  ];
  const allProperties = [...new Set([...defaultProperties, ...properties])];

  do {
    const body = {
      filterGroups: [{ filters }],
      properties: allProperties,
      limit,
      ...(after ? { after } : {}),
    };

    const resp = await _hs.run(() => _postWithRetry(body));

    results.push(...resp.data.results);
    after = resp.data.paging?.next?.after;
  } while (after);

  return results;
}

// ── Multi Day Tours ───────────────────────────────────────────────────────────

/**
 * Multi Day leads = new deals created in pipeline 998655438 within the date range.
 * Uses createdate, NOT current stage.
 */
async function getMultiDayLeads({ startDate, endDate, region } = {}) {
  const cacheKey = buildKey(NAMESPACES.HUBSPOT, 'mdLeads', startDate, endDate, region || 'all');
  return getOrFetch(cacheKey, async () => {
    const filters = [
      { propertyName: 'pipeline', operator: 'EQ', value: config.hubspot.multiDaySalesPipelineId },
      ...(startDate ? [{ propertyName: 'createdate', operator: 'GTE', value: toMs(startDate).toString() }] : []),
      ...(endDate   ? [{ propertyName: 'createdate', operator: 'LTE', value: toMs(endDate).toString() }]   : []),
    ];

    const deals = await searchDeals(filters);
    recordSync('hubspot');

    const regionFiltered = region
      ? deals.filter(d => matchesRegion(d.properties.location, region, d.properties.hubspot_owner_id))
      : deals;

    const noRegionCount = deals.filter(d => !d.properties.location && !OWNER_REGION_MAP[String(d.properties.hubspot_owner_id || '')]).length;

    return {
      deals: regionFiltered.map(d => ({
        id: d.id,
        name: d.properties.dealname,
        createdate: d.properties.createdate,
        stage: d.properties.dealstage,
        location: d.properties.location,
        ownerId: d.properties.hubspot_owner_id,
        regions: normaliseRegions(d.properties.location, d.properties.hubspot_owner_id),
      })),
      total: regionFiltered.length,
      noRegionCount,
    };
  });
}

/**
 * Multi Day closed won = deals in pipeline 998655439 at stage 1547076045.
 * Amount pulled from ops pipeline.
 */
async function getMultiDayClosedWon({ startDate, endDate, region } = {}) {
  const cacheKey = buildKey(NAMESPACES.HUBSPOT, 'mdClosed', startDate, endDate, region || 'all');
  return getOrFetch(cacheKey, async () => {
    const filters = [
      { propertyName: 'pipeline', operator: 'EQ', value: config.hubspot.multiDayOpsPipelineId },
      { propertyName: 'dealstage', operator: 'EQ', value: config.hubspot.multiDayStages.bookingAdminComplete },
      // Filter by closedate — when the booking was confirmed in this marketing period.
      ...(startDate ? [{ propertyName: 'closedate', operator: 'GTE', value: toMs(startDate).toString() }] : []),
      ...(endDate   ? [{ propertyName: 'closedate', operator: 'LTE', value: toMs(endDate).toString() }]   : []),
    ];

    const deals = await searchDeals(filters);
    recordSync('hubspot');

    const regionFiltered = region
      ? deals.filter(d => matchesRegion(d.properties.location, region, d.properties.hubspot_owner_id))
      : deals;

    const noAmountCount = regionFiltered.filter(d => !d.properties.amount || parseFloat(d.properties.amount) === 0).length;

    const validDeals = regionFiltered.filter(d => d.properties.amount && parseFloat(d.properties.amount) > 0);
    const totalRevenue = validDeals.reduce((sum, d) => sum + parseFloat(d.properties.amount), 0);

    return {
      deals: regionFiltered.map(d => ({
        id: d.id,
        name: d.properties.dealname,
        amount: d.properties.amount ? parseFloat(d.properties.amount) : null,
        currency: d.properties.deal_currency_code,
        closedate: d.properties.closedate,
        startdate: d.properties.start_date,   // tour start date — primary anchor
        location: d.properties.location,
        ownerId: d.properties.hubspot_owner_id,
        regions: normaliseRegions(d.properties.location, d.properties.hubspot_owner_id),
      })),
      total: regionFiltered.length,
      totalRevenue,
      noAmountCount,
    };
  });
}

// ── Multi-Day Revenue by Booked Date ─────────────────────────────────────────
// Anchors revenue to when the booking was MADE (createdate of ops deal = deposit received date),
// not when the tour runs (closedate / start_date). Includes all ops pipeline deals booked in period.

async function getMultiDayRevenueByBookedDate({ startDate, endDate, region } = {}) {
  const cacheKey = buildKey(NAMESPACES.HUBSPOT, 'mdBookedRevenue', startDate, endDate, region || 'all');
  return getOrFetch(cacheKey, async () => {
    const filters = [
      { propertyName: 'pipeline', operator: 'EQ', value: config.hubspot.multiDayOpsPipelineId },
      // Exclude Closed Lost and Cancelled from ops pipeline
      { propertyName: 'dealstage', operator: 'NEQ', value: '1547076049' }, // Ops Closed Lost
      { propertyName: 'dealstage', operator: 'NEQ', value: '2518923720' }, // Cancelled
      // Filter by createdate — when the ops deal was created = when the deposit was received
      ...(startDate ? [{ propertyName: 'createdate', operator: 'GTE', value: toMs(startDate).toString() }] : []),
      ...(endDate   ? [{ propertyName: 'createdate', operator: 'LTE', value: (toMs(endDate) + 86_399_999).toString() }] : []),
    ];

    const deals = await searchDeals(filters);

    const regionFiltered = region
      ? deals.filter(d => matchesRegion(d.properties.location, region, d.properties.hubspot_owner_id))
      : deals;

    const validDeals = regionFiltered.filter(d => d.properties.amount && parseFloat(d.properties.amount) > 0);

    return {
      deals: validDeals.map(d => ({
        id: d.id,
        name: d.properties.dealname,
        amount: parseFloat(d.properties.amount),
        currency: d.properties.deal_currency_code,
        bookedDate: d.properties.createdate,   // when deposit received = booked date
        startdate:  d.properties.start_date,   // tour start date (for reference)
        location: d.properties.location,
        regions: normaliseRegions(d.properties.location, d.properties.hubspot_owner_id),
      })),
      total: validDeals.length,
      totalRevenue: validDeals.reduce((s, d) => s + parseFloat(d.properties.amount), 0),
    };
  });
}

// ── Single Day Tours ──────────────────────────────────────────────────────────

async function getSingleDayLeads({ startDate, endDate, region } = {}) {
  const cacheKey = buildKey(NAMESPACES.HUBSPOT, 'sdLeads', startDate, endDate, region || 'all');
  return getOrFetch(cacheKey, async () => {
    const filters = [
      { propertyName: 'pipeline', operator: 'EQ', value: config.hubspot.singleDayPipelineId },
      ...(startDate ? [{ propertyName: 'createdate', operator: 'GTE', value: toMs(startDate).toString() }] : []),
      ...(endDate   ? [{ propertyName: 'createdate', operator: 'LTE', value: toMs(endDate).toString() }]   : []),
    ];

    const deals = await searchDeals(filters);
    recordSync('hubspot');

    const regionFiltered = region
      ? deals.filter(d => matchesRegion(d.properties.location, region))
      : deals;

    const noRegionCount = deals.filter(d => !d.properties.location && !OWNER_REGION_MAP[String(d.properties.hubspot_owner_id || '')]).length;

    return {
      deals: regionFiltered.map(d => ({
        id: d.id,
        name: d.properties.dealname,
        createdate: d.properties.createdate,
        stage: d.properties.dealstage,
        location: d.properties.location,
        ownerId: d.properties.hubspot_owner_id,
        regions: normaliseRegions(d.properties.location, d.properties.hubspot_owner_id),
      })),
      total: regionFiltered.length,
      noRegionCount,
    };
  });
}

async function getSingleDayClosedWon({ startDate, endDate, region } = {}) {
  const cacheKey = buildKey(NAMESPACES.HUBSPOT, 'sdClosed', startDate, endDate, region || 'all');
  return getOrFetch(cacheKey, async () => {
    const { complete, bookingAdminComplete } = config.hubspot.singleDayStages;

    const baseFilters = [
      { propertyName: 'pipeline', operator: 'EQ', value: config.hubspot.singleDayPipelineId },
    ];
    const dateByClose = [
      ...(startDate ? [{ propertyName: 'closedate', operator: 'GTE', value: toMs(startDate).toString() }] : []),
      ...(endDate   ? [{ propertyName: 'closedate', operator: 'LTE', value: toMs(endDate).toString() }]   : []),
    ];
    // decisionmakerboughtin deals have no closedate — filter by hs_lastmodifieddate instead
    const dateByModified = [
      ...(startDate ? [{ propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: toMs(startDate).toString() }] : []),
      ...(endDate   ? [{ propertyName: 'hs_lastmodifieddate', operator: 'LTE', value: toMs(endDate).toString() }]   : []),
    ];

    // Fetch both stages with their appropriate date fields
    const [wonDeals, adminDeals] = await Promise.all([
      searchDeals([...baseFilters, ...dateByClose,    { propertyName: 'dealstage', operator: 'EQ', value: complete }]),
      searchDeals([...baseFilters, ...dateByModified, { propertyName: 'dealstage', operator: 'EQ', value: bookingAdminComplete }]),
    ]);

    const seen = new Set();
    const allDeals = [];
    for (const d of [...wonDeals, ...adminDeals]) {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        allDeals.push(d);
      }
    }

    recordSync('hubspot');

    const regionFiltered = region
      ? allDeals.filter(d => matchesRegion(d.properties.location, region, d.properties.hubspot_owner_id))
      : allDeals;

    const noAmountCount = regionFiltered.filter(d => !d.properties.amount || parseFloat(d.properties.amount) === 0).length;
    const validDeals = regionFiltered.filter(d => d.properties.amount && parseFloat(d.properties.amount) > 0);
    const totalRevenue = validDeals.reduce((sum, d) => sum + parseFloat(d.properties.amount), 0);

    return {
      deals: regionFiltered.map(d => ({
        id: d.id,
        name: d.properties.dealname,
        amount: d.properties.amount ? parseFloat(d.properties.amount) : null,
        currency: d.properties.deal_currency_code,
        closedate: d.properties.closedate,
        location: d.properties.location,
        ownerId: d.properties.hubspot_owner_id,
        regions: normaliseRegions(d.properties.location, d.properties.hubspot_owner_id),
      })),
      total: regionFiltered.length,
      totalRevenue,
      noAmountCount,
    };
  });
}

// ── Pipeline Funnel (Multi Day — spans Sales + Operations pipelines) ──────────
//
// Deals flow: Sales pipeline (998655438) → Operations pipeline (998655439)
// Sales stages run from Initial Enquiry through Deposit Received / Won.
// Booking Confirmed and Booking Admin Complete live in the Operations pipeline.
// We query both and stitch them into a single funnel.

// Sequential funnel stages — only the positive progression path.
// No Contact is a dead-end (not a through-stage) so it's excluded here.
const MD_STAGE_ORDER = [
  { id: config.hubspot.multiDayStages.initialEnquiry,        label: 'Initial Enquiry',         pipeline: 'sales' },
  { id: config.hubspot.multiDayStages.allocated,             label: 'Allocated',               pipeline: 'sales' },
  { id: config.hubspot.multiDayStages.tourDiscoveryHad,      label: 'Tour Discovery Had',      pipeline: 'sales' },
  { id: config.hubspot.multiDayStages.draftItinerarySent,    label: 'Draft Itinerary Sent',    pipeline: 'sales' },
  { id: config.hubspot.multiDayStages.finalItinerarySent,    label: 'Final Itinerary Sent',    pipeline: 'sales' },
  { id: config.hubspot.multiDayStages.depositReceived,       label: 'Deposit Received / Won',  pipeline: 'sales' },
  { id: config.hubspot.multiDayStages.bookingConfirmed,      label: 'Booking Confirmed',       pipeline: 'ops'   },
  { id: config.hubspot.multiDayStages.bookingFormSent,       label: 'Booking Form Sent',       pipeline: 'ops'   },
  { id: config.hubspot.multiDayStages.completedFormReceived, label: 'Completed Form Received', pipeline: 'ops'   },
  { id: config.hubspot.multiDayStages.bookingAdminComplete,  label: 'Booking Admin Complete',  pipeline: 'ops',  closedWon: true },
];

const MD_BOOKING_ADMIN_IDX = MD_STAGE_ORDER.length - 1;
const MD_TOUR_DISCOVERY_IDX = 2; // "Opportunity" threshold for lead-to-opportunity rate
const MD_DEPOSIT_RECEIVED_IDX = 5; // "Won" threshold — same milestone CVR uses, see getOpportunityRates

const MD_STAGE_INDEX_MAP = {};
MD_STAGE_ORDER.forEach((s, i) => { MD_STAGE_INDEX_MAP[s.id] = i; });

// Dead-end stages with a known depth credit:
//   closedLost (sales)  → credit only Initial Enquiry (we don't know where they dropped)
//   noContact           → credit Initial Enquiry + Allocated (NC implies allocation happened)
//   ops closedLost / cancelled → credit all sales stages + Booking Confirmed (they were in ops)
const MD_SALES_CL   = config.hubspot.multiDayStages.closedLost;  // '1547076042'
const MD_NO_CONTACT = config.hubspot.multiDayStages.noContact;   // '1547076038'
const MD_OPS_CL      = '1547076049';  // ops pipeline Closed Lost
const MD_CANCELLED   = '2518923720';  // Cancelled Bookings with Credit Held

// Post-terminal ops stages: tour happened, past Booking Admin Complete — count at max depth
const MD_POST_TERMINAL_OPS = new Set([
  '1683048924', // Invoice to be sent - 7 days
  '1547076046', // 60 Day Reminder
  '1547076047', // 30 Day Reminder
  '1547080152', // 2 Week Reminder
  '1547076048', // Complete
  '1593890237', // Post Tour Email Sent
]);

/**
 * Resolve how deep into the MD funnel a given dealstage represents.
 * Shared by getMultiDayFunnel and getOpportunityRates so both use identical logic.
 */
function mdStageDepth(stageId) {
  if (MD_POST_TERMINAL_OPS.has(stageId)) return MD_BOOKING_ADMIN_IDX;
  if (stageId === MD_NO_CONTACT) return 1;
  if (stageId === MD_SALES_CL) return 0;
  if (stageId === MD_OPS_CL || stageId === MD_CANCELLED) return 6;
  const depth = MD_STAGE_INDEX_MAP[stageId];
  return depth === undefined ? 0 : depth;
}

async function getMultiDayFunnel({ startDate, endDate, region } = {}) {
  const cacheKey = buildKey(NAMESPACES.HUBSPOT, 'mdFunnel', startDate || 'all', endDate || 'all', region || 'all');
  return getOrFetch(cacheKey, async () => {
    // Date filters on createdate — deal eligibility is determined by when the enquiry was created
    const dateFilters = [
      ...(startDate ? [{ propertyName: 'createdate', operator: 'GTE', value: toMs(startDate).toString() }] : []),
      ...(endDate   ? [{ propertyName: 'createdate', operator: 'LTE', value: (toMs(endDate) + 86_399_999).toString() }] : []),
    ];

    // Fetch ALL deals (incl. CL) so Initial Enquiry = true total of enquiries that entered.
    const [salesDeals, opsDeals] = await Promise.all([
      searchDeals([
        { propertyName: 'pipeline', operator: 'EQ', value: config.hubspot.multiDaySalesPipelineId },
        ...dateFilters,
      ]),
      searchDeals([
        { propertyName: 'pipeline', operator: 'EQ', value: config.hubspot.multiDayOpsPipelineId },
        ...dateFilters,
      ]),
    ]);

    recordSync('hubspot');

    const filterRegion = (deals) => region
      ? deals.filter(d => matchesRegion(d.properties.location, region, d.properties.hubspot_owner_id))
      : deals;

    const salesFiltered = filterRegion(salesDeals);
    const opsFiltered   = filterRegion(opsDeals);

    // Cumulative counts: cumulativeCounts[N] = deals that have reached stage N or beyond.
    const cumulativeCounts = new Array(MD_STAGE_ORDER.length).fill(0);
    let closedLostCount = 0;
    let noContactCount  = 0;

    const addDeal = (stageId) => {
      if (stageId === MD_SALES_CL) closedLostCount++;
      if (stageId === MD_NO_CONTACT) noContactCount++;
      const depth = mdStageDepth(stageId);
      for (let i = 0; i <= depth; i++) cumulativeCounts[i]++;
    };

    for (const deal of salesFiltered) addDeal(deal.properties.dealstage);
    for (const deal of opsFiltered)   addDeal(deal.properties.dealstage);

    const topCount = cumulativeCounts[0] || 1;

    return {
      stages: MD_STAGE_ORDER.map((s, i) => ({
        id:        s.id,
        label:     s.label,
        count:     cumulativeCounts[i],
        pct:       (cumulativeCounts[i] / topCount) * 100,
        pipeline:  s.pipeline,
        closedWon: s.closedWon || false,
      })),
      totalEnquiries: cumulativeCounts[0],
      closedLost:     closedLostCount,
      noContact:      noContactCount,
      note: 'Initial Enquiry = all deals created in period. CL and No Contact shown separately.',
    };
  });
}

// ── Accrual revenue — anchored to tour start_date ────────────────────────────
//
// Section 2 "Actual Results": we want revenue that ACCRUES in the period,
// i.e. whose tour start_date falls within the window, regardless of when
// the booking was confirmed (closedate).

/**
 * Fetch and cache ALL ops pipeline deals (no date filter).
 * HubSpot's CRM Search API does not reliably filter DATE-type properties
 * (like start_date) via millisecond timestamps, so we fetch the full set
 * and filter by date string in JavaScript.
 */
async function getAllOpsPipelineDeals() {
  const cacheKey = buildKey(NAMESPACES.HUBSPOT, 'opsAll');
  return getOrFetch(cacheKey, async () => {
    const filters = [
      { propertyName: 'pipeline', operator: 'EQ', value: config.hubspot.multiDayOpsPipelineId },
    ];
    const deals = await searchDeals(filters);
    recordSync('hubspot');
    return deals;
  });
}

/**
 * Multi Day actual revenue — ALL ops-pipeline deals whose tour start_date
 * falls within the date range (JS-side date filtering; HubSpot DATE property
 * filtering via timestamps is unreliable).
 */
async function getMultiDayActual({ startDate, endDate, region } = {}) {
  const cacheKey = buildKey(NAMESPACES.HUBSPOT, 'mdActual', startDate, endDate, region || 'all');
  return getOrFetch(cacheKey, async () => {
    // Fetch all ops pipeline deals (shared cache entry)
    const allDeals = await getAllOpsPipelineDeals();

    // Filter by start_date string comparison (YYYY-MM-DD lexicographic sort is correct)
    const dateFiltered = allDeals.filter(d => {
      const sd = d.properties.start_date;
      if (!sd) return false;
      if (startDate && sd < startDate) return false;
      if (endDate   && sd > endDate)   return false;
      return true;
    });

    const regionFiltered = region
      ? dateFiltered.filter(d => matchesRegion(d.properties.location, region, d.properties.hubspot_owner_id))
      : dateFiltered;

    const validDeals = regionFiltered.filter(d => d.properties.amount && parseFloat(d.properties.amount) > 0);
    const totalRevenue = validDeals.reduce((sum, d) => sum + parseFloat(d.properties.amount), 0);
    const noAmountCount = regionFiltered.filter(d => !d.properties.amount || parseFloat(d.properties.amount) === 0).length;

    return {
      deals: regionFiltered.map(d => ({
        id: d.id,
        name: d.properties.dealname,
        amount: d.properties.amount ? parseFloat(d.properties.amount) : null,
        currency: d.properties.deal_currency_code,
        closedate: d.properties.closedate,
        startdate: d.properties.start_date,
        location: d.properties.location,
        ownerId: d.properties.hubspot_owner_id,
        regions: normaliseRegions(d.properties.location, d.properties.hubspot_owner_id),
      })),
      total: regionFiltered.length,
      totalRevenue,
      noAmountCount,
    };
  });
}

/**
 * Fetch and cache ALL single-day pipeline deals (closed won stages, no date filter).
 * Same rationale as getAllOpsPipelineDeals: HubSpot DATE property filtering via
 * millisecond timestamps is unreliable, so we fetch everything and filter in JS.
 */
async function getAllSingleDayActualDeals() {
  const cacheKey = buildKey(NAMESPACES.HUBSPOT, 'sdAll');
  return getOrFetch(cacheKey, async () => {
    const { complete, bookingAdminComplete } = config.hubspot.singleDayStages;
    const baseFilters = [
      { propertyName: 'pipeline', operator: 'EQ', value: config.hubspot.singleDayPipelineId },
    ];
    const [wonDeals, adminDeals] = await Promise.all([
      searchDeals([...baseFilters, { propertyName: 'dealstage', operator: 'EQ', value: complete }]),
      searchDeals([...baseFilters, { propertyName: 'dealstage', operator: 'EQ', value: bookingAdminComplete }]),
    ]);
    // Deduplicate
    const seen = new Set();
    const allDeals = [];
    for (const d of [...wonDeals, ...adminDeals]) {
      if (!seen.has(d.id)) { seen.add(d.id); allDeals.push(d); }
    }
    recordSync('hubspot');
    return allDeals;
  });
}

/**
 * Single Day actual revenue — closed won deals from the single-day pipeline
 * whose tour start_date falls within the date range (JS-side date filtering).
 */
async function getSingleDayActual({ startDate, endDate, region } = {}) {
  const cacheKey = buildKey(NAMESPACES.HUBSPOT, 'sdActual', startDate, endDate, region || 'all');
  return getOrFetch(cacheKey, async () => {
    // Fetch all SD closed-won deals (shared cache entry)
    const allDeals = await getAllSingleDayActualDeals();

    // Filter by start_date string comparison in JS
    const dateFiltered = allDeals.filter(d => {
      const sd = d.properties.start_date;
      if (!sd) return false;
      if (startDate && sd < startDate) return false;
      if (endDate   && sd > endDate)   return false;
      return true;
    });

    const regionFiltered = region
      ? dateFiltered.filter(d => matchesRegion(d.properties.location, region, d.properties.hubspot_owner_id))
      : dateFiltered;

    const validDeals = regionFiltered.filter(d => d.properties.amount && parseFloat(d.properties.amount) > 0);
    const totalRevenue = validDeals.reduce((sum, d) => sum + parseFloat(d.properties.amount), 0);
    const noAmountCount = regionFiltered.filter(d => !d.properties.amount || parseFloat(d.properties.amount) === 0).length;

    return {
      deals: regionFiltered.map(d => ({
        id: d.id,
        name: d.properties.dealname,
        amount: d.properties.amount ? parseFloat(d.properties.amount) : null,
        currency: d.properties.deal_currency_code,
        closedate: d.properties.closedate,
        startdate: d.properties.start_date,
        location: d.properties.location,
        ownerId: d.properties.hubspot_owner_id,
        regions: normaliseRegions(d.properties.location, d.properties.hubspot_owner_id),
      })),
      total: regionFiltered.length,
      totalRevenue,
      noAmountCount,
    };
  });
}

// ── Deals with no region set ──────────────────────────────────────────────────

async function getDealsWithNoRegion() {
  const cacheKey = buildKey(NAMESPACES.HUBSPOT, 'noRegion');
  return getOrFetch(cacheKey, async () => {
    // Fetch across relevant pipelines and flag those without a location
    const [mdDeals, sdDeals] = await Promise.all([
      searchDeals([{ propertyName: 'pipeline', operator: 'EQ', value: config.hubspot.multiDaySalesPipelineId }]),
      searchDeals([{ propertyName: 'pipeline', operator: 'EQ', value: config.hubspot.singleDayPipelineId }]),
    ]);

    const allDeals = [...mdDeals, ...sdDeals];
    // Only flag deals that can't be resolved via location OR owner mapping
    // (deals with blank location but a known owner are now tagged 'General' — not a data quality issue)
    const noRegion = allDeals.filter(d =>
      !d.properties.location &&
      !OWNER_REGION_MAP[String(d.properties.hubspot_owner_id || '')]
    );

    return {
      count: noRegion.length,
      deals: noRegion.map(d => ({
        id: d.id,
        name: d.properties.dealname,
        pipeline: d.properties.pipeline,
        stage: d.properties.dealstage,
        createdate: d.properties.createdate,
      })),
      hubspotFilterUrl: `https://app.hubspot.com/contacts/${process.env.HUBSPOT_PORTAL_ID || ''}/deals`,
    };
  });
}

// ── Marketing performance dashboard helpers ───────────────────────────────────

/**
 * Attributed lead counts by channel (Meta vs Google Ads vs Other), using
 * HubSpot's native original-source tracking (hs_analytics_source).
 * Fetches deals once and buckets by depot in a single pass.
 */
async function getAttributedLeadCounts({ pipeline, startDate, endDate } = {}) {
  const cacheKey = buildKey(NAMESPACES.HUBSPOT, 'attributedLeads', pipeline, startDate || 'all', endDate || 'all');
  return getOrFetch(cacheKey, async () => {
    const dateFilters = [
      ...(startDate ? [{ propertyName: 'createdate', operator: 'GTE', value: toMs(startDate).toString() }] : []),
      ...(endDate   ? [{ propertyName: 'createdate', operator: 'LTE', value: (toMs(endDate) + 86_399_999).toString() }] : []),
    ];
    const pipelineId = pipeline === 'md' ? config.hubspot.multiDaySalesPipelineId : config.hubspot.singleDayPipelineId;
    const deals = await searchDeals([{ propertyName: 'pipeline', operator: 'EQ', value: pipelineId }, ...dateFilters]);
    recordSync('hubspot');

    const emptyBucket = () => ({ total: 0, meta: 0, gads: 0, other: 0 });
    const totals = emptyBucket();
    const byDepot = {};
    for (const d of ALL_DEPOTS) byDepot[d] = emptyBucket();

    for (const deal of deals) {
      const p = deal.properties;
      const source = classifySource(p.hs_analytics_source);
      const regions = normaliseRegions(p.location, p.hubspot_owner_id).filter(r => ALL_DEPOTS.includes(r));
      totals.total++; totals[source]++;
      for (const r of regions) { byDepot[r].total++; byDepot[r][source]++; }
    }

    return { total: totals, byDepot };
  });
}

const MD_WON_STAGE = '1547076045';   // Booking Admin Complete (ops)
const MD_LOST_STAGES = new Set(['1547076042', '1547076049', '2518923720']); // sales CL, ops CL, cancelled

/**
 * Open opportunity counts/value and average deal-cycle length, fetched once
 * per pipeline and bucketed by depot. "Open" = not yet won or lost.
 */
async function getPipelineHealth({ pipeline, startDate, endDate } = {}) {
  const cacheKey = buildKey(NAMESPACES.HUBSPOT, 'pipelineHealth', pipeline, startDate || 'all', endDate || 'all');
  return getOrFetch(cacheKey, async () => {
    const dateFilters = [
      ...(startDate ? [{ propertyName: 'createdate', operator: 'GTE', value: toMs(startDate).toString() }] : []),
      ...(endDate   ? [{ propertyName: 'createdate', operator: 'LTE', value: (toMs(endDate) + 86_399_999).toString() }] : []),
    ];

    let deals;
    if (pipeline === 'md') {
      const [salesDeals, opsDeals] = await Promise.all([
        searchDeals([{ propertyName: 'pipeline', operator: 'EQ', value: config.hubspot.multiDaySalesPipelineId }, ...dateFilters]),
        searchDeals([{ propertyName: 'pipeline', operator: 'EQ', value: config.hubspot.multiDayOpsPipelineId }, ...dateFilters]),
      ]);
      deals = [...salesDeals, ...opsDeals];
    } else {
      deals = await searchDeals([{ propertyName: 'pipeline', operator: 'EQ', value: config.hubspot.singleDayPipelineId }, ...dateFilters]);
    }
    recordSync('hubspot');

    const { complete, bookingAdminComplete, closedLost } = config.hubspot.singleDayStages;
    const isWon = (stage) => pipeline === 'md' ? stage === MD_WON_STAGE : (stage === complete || stage === bookingAdminComplete);
    const isLost = (stage) => pipeline === 'md' ? MD_LOST_STAGES.has(stage) : stage === closedLost;
    const isOpen = (stage) => !isWon(stage) && !isLost(stage);

    const emptyBucket = () => ({ openCount: 0, openValue: 0, closedCount: 0, totalCycleDays: 0 });
    const totals = emptyBucket();
    const byDepot = {};
    for (const d of ALL_DEPOTS) byDepot[d] = emptyBucket();

    const wonDeals = [];

    for (const deal of deals) {
      const p = deal.properties;
      const stage = p.dealstage;
      const regions = normaliseRegions(p.location, p.hubspot_owner_id).filter(r => ALL_DEPOTS.includes(r));
      const amount = p.amount ? parseFloat(p.amount) : 0;

      if (isOpen(stage)) {
        totals.openCount++; totals.openValue += amount;
        for (const r of regions) { byDepot[r].openCount++; byDepot[r].openValue += amount; }
      } else if (isWon(stage)) {
        wonDeals.push({ id: deal.id, stage, regions, createdate: p.createdate, closedate: p.closedate, hs_lastmodifieddate: p.hs_lastmodifieddate });
      }
    }

    // Resolve the exact "entered won stage" timestamp via property history,
    // falling back to closedate/hs_lastmodifieddate if history is unavailable.
    // Avg Deal Cycle Length = createdate -> the moment dealstage became the
    // won stage (Booking Admin Complete for MD; complete/bookingAdminComplete for SD).
    await Promise.all(wonDeals.map(async (w) => {
      const fallback = w.closedate ? new Date(w.closedate).getTime() : (w.hs_lastmodifieddate ? new Date(w.hs_lastmodifieddate).getTime() : null);
      const createTs = w.createdate ? new Date(w.createdate).getTime() : null;
      const wonStageId = pipeline === 'md' ? MD_WON_STAGE : w.stage; // SD has two won stages; use whichever this deal is in
      const closeTs = await _resolveWonTimestamp(w.id, wonStageId, fallback);

      if (closeTs && createTs && closeTs > createTs) {
        const days = (closeTs - createTs) / 86_400_000;
        totals.closedCount++; totals.totalCycleDays += days;
        for (const r of w.regions) { byDepot[r].closedCount++; byDepot[r].totalCycleDays += days; }
      }
    }));

    const finalize = (b) => ({
      openCount: b.openCount,
      openValueNzd: b.openValue,
      avgDealCycleDays: b.closedCount > 0 ? b.totalCycleDays / b.closedCount : null,
    });

    return {
      total: finalize(totals),
      byDepot: Object.fromEntries(ALL_DEPOTS.map(d => [d, finalize(byDepot[d])])),
    };
  });
}

/**
 * Lead-to-Opportunity and Opportunity-to-Close rates — MD only. Single Day
 * is mostly instant on-site (Rezdy) conversions rather than a sales-assisted
 * funnel, so these rates aren't meaningful for SD and aren't computed for it.
 * MD reuses the existing funnel depth logic (Opportunity = Tour Discovery Had).
 */
async function getOpportunityRates({ startDate, endDate } = {}) {
  const cacheKey = buildKey(NAMESPACES.HUBSPOT, 'oppRates', 'md', startDate || 'all', endDate || 'all');
  return getOrFetch(cacheKey, async () => {
    // Single fetch (2 calls: sales + ops), bucketed by depot in one pass —
    // avoids calling getMultiDayFunnel 5x (which would be 10 HubSpot searches).
    const dateFilters = [
      ...(startDate ? [{ propertyName: 'createdate', operator: 'GTE', value: toMs(startDate).toString() }] : []),
      ...(endDate   ? [{ propertyName: 'createdate', operator: 'LTE', value: (toMs(endDate) + 86_399_999).toString() }] : []),
    ];
    const [salesDeals, opsDeals] = await Promise.all([
      searchDeals([{ propertyName: 'pipeline', operator: 'EQ', value: config.hubspot.multiDaySalesPipelineId }, ...dateFilters]),
      searchDeals([{ propertyName: 'pipeline', operator: 'EQ', value: config.hubspot.multiDayOpsPipelineId }, ...dateFilters]),
    ]);
    recordSync('hubspot');

    const emptyBucket = () => ({ totalEnquiries: 0, opportunities: 0, closedWon: 0 });
    const totals = emptyBucket();
    const byDepot = {};
    for (const d of ALL_DEPOTS) byDepot[d] = emptyBucket();

    const addDeal = (deal) => {
      const p = deal.properties;
      const depth = mdStageDepth(p.dealstage);
      const isOpp = depth >= MD_TOUR_DISCOVERY_IDX;
      // "Won" = Deposit Received or beyond — the same milestone CVR uses (cumulativeCounts[5]
      // in getMultiDayFunnel). Previously this checked depth === MD_BOOKING_ADMIN_IDX (Booking
      // Admin Complete), which only happens after the tour has run — for any recent period that
      // made Opportunity-to-Close Rate read far lower than CVR despite measuring the same funnel.
      const isWon = depth >= MD_DEPOSIT_RECEIVED_IDX;
      const regions = normaliseRegions(p.location, p.hubspot_owner_id).filter(r => ALL_DEPOTS.includes(r));

      totals.totalEnquiries++;
      if (isOpp) totals.opportunities++;
      if (isWon) totals.closedWon++;
      for (const r of regions) {
        byDepot[r].totalEnquiries++;
        if (isOpp) byDepot[r].opportunities++;
        if (isWon) byDepot[r].closedWon++;
      }
    };

    for (const deal of salesDeals) addDeal(deal);
    for (const deal of opsDeals)   addDeal(deal);

    const finalize = (b) => ({
      ...b,
      leadToOpportunityRate:  b.totalEnquiries > 0 ? (b.opportunities / b.totalEnquiries) * 100 : null,
      opportunityToCloseRate: b.opportunities  > 0 ? (b.closedWon / b.opportunities) * 100      : null,
    });

    return {
      total: finalize(totals),
      byDepot: Object.fromEntries(ALL_DEPOTS.map(d => [d, finalize(byDepot[d])])),
    };
  });
}

module.exports = {
  getMultiDayLeads,
  getMultiDayClosedWon,
  getMultiDayRevenueByBookedDate,
  getSingleDayLeads,
  getSingleDayClosedWon,
  getMultiDayActual,
  getSingleDayActual,
  getMultiDayFunnel,
  getDealsWithNoRegion,
  getAttributedLeadCounts,
  getPipelineHealth,
  getOpportunityRates,
  normaliseRegions,
  matchesRegion,
  ALL_DEPOTS,
};
