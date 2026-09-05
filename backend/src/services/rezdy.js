/**
 * Rezdy API service — fetches real booking data directly from Rezdy.
 * Replaces the GA4 purchase-event heuristic which was significantly under-counting.
 */
const axios = require('axios');
const { getOrFetch, buildKey, NAMESPACES, recordSync } = require('../cache');
const config = require('../config');

const BASE = 'https://api.rezdy.com/v1';
const API_KEY = config.rezdy?.apiKey || process.env.REZDY_API_KEY;
const PAGE_SIZE = 100;

// Fetch one page of bookings from Rezdy
async function fetchOrdersPage(startDate, endDate, offset = 0) {
  const r = await axios.get(`${BASE}/bookings`, {
    params: {
      apiKey: API_KEY,
      startDate,
      endDate,
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

// Fetch ALL confirmed orders in the date range (handles pagination)
async function fetchAllOrders(startDate, endDate) {
  const all = [];
  let offset = 0;
  while (true) {
    const page = await fetchOrdersPage(startDate, endDate, offset);
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all.filter(o => o.status === 'CONFIRMED');
}

// Convert NZD string to number (Rezdy returns strings like "250.00")
function toNzd(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// Return YYYY-MM-DD for a Rezdy dateCreated string like "2026-09-05 11:02:00"
function orderDate(order) {
  const s = order.dateCreated || order.orderDate || '';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
}

/**
 * Main function — returns the same shape the frontend expects:
 * {
 *   total: number,
 *   revenueNzd: number,
 *   daily: [{ date, conversions, revenueNzd }],    // sorted ascending
 *   products: [{ name, productCode, quantity, revenueNzd }]  // sorted by revenue desc
 * }
 */
async function getBookings({ startDate, endDate } = {}) {
  const s = startDate || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const e = endDate   || new Date().toISOString().slice(0, 10);

  const cacheKey = buildKey(NAMESPACES.REZDY, 'bookings', s, e);
  return getOrFetch(cacheKey, async () => {
    const orders = await fetchAllOrders(s, e);

    const dailyMap = {};
    const productMap = {};

    for (const order of orders) {
      const date = orderDate(order);
      if (!date) continue;
      const amt = toNzd(order.totalAmount);

      // Daily aggregation
      if (!dailyMap[date]) dailyMap[date] = { date, conversions: 0, revenueNzd: 0 };
      dailyMap[date].conversions++;
      dailyMap[date].revenueNzd += amt;

      // Per-product aggregation (from line items)
      for (const item of order.items || []) {
        const code = item.productCode || '';
        const name = item.productName || code;
        const qty  = item.totalQuantity
          ?? (item.quantities || []).reduce((s, q) => s + (q.value || 0), 0)
          ?? 1;
        // Revenue is at order level; split equally across items when multi-item
        const itemAmt = (order.items.length > 1) ? amt / order.items.length : amt;

        if (!productMap[code]) productMap[code] = { name, productCode: code, quantity: 0, revenueNzd: 0 };
        productMap[code].quantity  += qty;
        productMap[code].revenueNzd += itemAmt;
      }
    }

    const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
    const products = Object.values(productMap).sort((a, b) => b.revenueNzd - a.revenueNzd);
    const total     = orders.length;
    const revenueNzd = daily.reduce((s, d) => s + d.revenueNzd, 0);

    recordSync('rezdy');
    return { total, revenueNzd, daily, products };
  });
}

module.exports = { getBookings };
