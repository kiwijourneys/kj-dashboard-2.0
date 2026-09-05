/**
 * Rezdy API service — fetches real booking data directly from Rezdy.
 *
 * KEY INSIGHT: Rezdy's startDate/endDate filter by *tour date*, not booking creation date.
 * For a marketing dashboard we want bookings ordered by when they were CREATED (a sale).
 * Solution: fetch with orderBy=DATE_CREATED (no date range), paginate until we reach the
 * cutoff date, then filter server-side by dateCreated. This keeps page counts tiny
 * (~1 page per 90 days, ~12 pages per year) vs thousands of pages when filtering by tour date.
 */
const axios = require('axios');
const { getOrFetch, buildKey, NAMESPACES, recordSync } = require('../cache');
const config = require('../config');

const BASE = 'https://api.rezdy.com/v1';
const API_KEY = config.rezdy?.apiKey || process.env.REZDY_API_KEY;
const PAGE_SIZE = 100;

// How far back to look (days). Covers YTD + trend charts without blowing up page count.
const LOOKBACK_DAYS = 400;

// Fetch one page of bookings sorted by creation date (most recent first)
async function fetchPage(offset = 0) {
  const r = await axios.get(`${BASE}/bookings`, {
    params: {
      apiKey: API_KEY,
      limit: PAGE_SIZE,
      offset,
      orderBy: 'DATE_CREATED',
    },
    timeout: 15000,
  });
  const body = r.data;
  if (body?.requestStatus?.success === false) {
    throw new Error(`Rezdy bookings: ${body.requestStatus.error?.errorMessage}`);
  }
  return body.bookings || [];
}

/**
 * Fetch all bookings created since `cutoffDate` (YYYY-MM-DD).
 * Pages are returned most-recent-first, so we stop as soon as the oldest item
 * on a page is before the cutoff — no need to scan all-time history.
 */
async function fetchAllSince(cutoffDate) {
  const all = [];
  let offset = 0;
  while (true) {
    const page = await fetchPage(offset);
    if (!page.length) break;
    all.push(...page);
    const oldest = (page[page.length - 1].dateCreated || '').slice(0, 10);
    if (page.length < PAGE_SIZE || (oldest && oldest < cutoffDate)) break;
    offset += PAGE_SIZE;
  }
  // Filter: only CONFIRMED bookings created on or after the cutoff
  return all.filter(o =>
    o.status === 'CONFIRMED' &&
    (o.dateCreated || '').slice(0, 10) >= cutoffDate
  );
}

// Convert amount to number (Rezdy may return number or string)
function toNzd(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// Extract YYYY-MM-DD from a Rezdy dateCreated field ("2026-09-05T11:45:29Z" or "2026-09-05 11:45:29")
function orderDate(order) {
  const s = order.dateCreated || '';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
}

/**
 * Returns:
 * {
 *   cutoffDate: string,              // earliest date in this dataset (YYYY-MM-DD)
 *   daily:    [{ date, conversions, revenueNzd }],   // sorted ascending by dateCreated
 *   products: [{ name, productCode, quantity, revenueNzd }]  // sorted by revenue desc
 * }
 *
 * NOTE: total/revenueNzd are NOT returned at the top level any more — the frontend
 * must sum the daily array for whatever period it needs. This avoids the mismatch
 * between the selected period and the full dataset.
 */
async function getBookings() {
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);

  // Stable daily cache key — refreshes when the cutoff date rolls over
  const cacheKey = buildKey(NAMESPACES.REZDY, 'bookings-by-created', cutoff);

  return getOrFetch(cacheKey, async () => {
    const orders = await fetchAllSince(cutoff);

    const dailyMap = {};
    const productMap = {};

    for (const order of orders) {
      const date = orderDate(order);
      if (!date) continue;
      const amt = toNzd(order.totalAmount);

      if (!dailyMap[date]) dailyMap[date] = { date, conversions: 0, revenueNzd: 0 };
      dailyMap[date].conversions++;
      dailyMap[date].revenueNzd += amt;

      for (const item of order.items || []) {
        const code = item.productCode || '';
        const name = item.productName || code;
        const qty  = item.totalQuantity
          ?? (item.quantities || []).reduce((s, q) => s + (q.value || 0), 0)
          ?? 1;
        const itemAmt = (order.items.length > 1) ? amt / order.items.length : amt;

        if (!productMap[code]) productMap[code] = { name, productCode: code, quantity: 0, revenueNzd: 0 };
        productMap[code].quantity   += qty;
        productMap[code].revenueNzd += itemAmt;
      }
    }

    const daily    = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
    const products = Object.values(productMap).sort((a, b) => b.revenueNzd - a.revenueNzd);

    recordSync('rezdy');
    return { cutoffDate: cutoff, daily, products };
  });
}

module.exports = { getBookings };
