import axios from 'axios';

// In production (Vercel), VITE_API_URL points to the Railway backend.
// Locally, requests go through Vite's dev-server proxy at /api.
const baseURL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

const api = axios.create({ baseURL });

function toQs(params) {
  const p = {};
  if (params?.startDate) p.startDate = params.startDate;
  if (params?.endDate)   p.endDate   = params.endDate;
  if (params?.region)    p.region    = params.region;
  return p;
}

// ── Summary (all KPIs) ────────────────────────────────────────────────────────
export const fetchSummary = (params) =>
  api.get('/summary', { params: toQs(params) }).then(r => r.data);

// ── HubSpot ───────────────────────────────────────────────────────────────────
export const fetchMdLeads      = (params) => api.get('/hubspot/leads/multiday',   { params: toQs(params) }).then(r => r.data);
export const fetchSdLeads      = (params) => api.get('/hubspot/leads/singleday',  { params: toQs(params) }).then(r => r.data);
export const fetchMdClosed     = (params) => api.get('/hubspot/closedwon/multiday', { params: toQs(params) }).then(r => r.data);
export const fetchSdClosed     = (params) => api.get('/hubspot/closedwon/singleday', { params: toQs(params) }).then(r => r.data);
export const fetchMdActual     = (params) => api.get('/hubspot/actual/multiday',  { params: toQs(params) }).then(r => r.data);
export const fetchSdActual     = (params) => api.get('/hubspot/actual/singleday', { params: toQs(params) }).then(r => r.data);
export const fetchMdFunnel          = (params) => api.get('/hubspot/funnel/multiday',         { params: toQs(params) }).then(r => r.data);
export const fetchMdBookedRevenue   = (params) => api.get('/hubspot/booked-revenue/multiday', { params: toQs(params) }).then(r => r.data);
export const fetchNoRegion     = ()       => api.get('/hubspot/no-region').then(r => r.data);

// ── Google Ads ────────────────────────────────────────────────────────────────
export const fetchGoogleSummary  = (params) => api.get('/google-ads/summary',    { params: toQs(params) }).then(r => r.data);
export const fetchGoogleCampaigns = (params) => api.get('/google-ads/campaigns', { params: toQs(params) }).then(r => r.data);
export const fetchGoogleDaily      = (params) => api.get('/google-ads/daily-spend',       { params: toQs(params) }).then(r => r.data);
export const fetchGoogleDepotDaily = (params) => api.get('/google-ads/depot-daily-spend', { params: toQs(params) }).then(r => r.data);

// ── Meta ──────────────────────────────────────────────────────────────────────
export const fetchMetaSummary    = (params) => api.get('/meta/summary',           { params: toQs(params) }).then(r => r.data);
export const fetchMetaCampaigns  = (params) => api.get('/meta/campaigns',         { params: toQs(params) }).then(r => r.data);
export const fetchMetaDaily      = (params) => api.get('/meta/daily-spend',       { params: toQs(params) }).then(r => r.data);
export const fetchMetaDepotDaily = (params) => api.get('/meta/depot-daily-spend', { params: toQs(params) }).then(r => r.data);

// ── GA4 ───────────────────────────────────────────────────────────────────────
export const fetchGa4Channels    = (params) => api.get('/ga4/channels',            { params: toQs(params) }).then(r => r.data);
export const fetchGa4Organic     = (params) => api.get('/ga4/organic',             { params: toQs(params) }).then(r => r.data);
export const fetchGa4TopPages    = (params) => api.get('/ga4/top-pages',           { params: toQs(params) }).then(r => r.data);
export const fetchGa4BikeRental  = (params) => api.get('/ga4/bike-rental',         { params: toQs(params) }).then(r => r.data);
export const fetchGa4Daily       = (params) => api.get('/ga4/daily-sessions',      { params: toQs(params) }).then(r => r.data);
export const fetchGa4RezdyRev      = (params) => api.get('/ga4/rezdy-revenue',    { params: toQs(params) }).then(r => r.data);
export const fetchGa4RezdyProducts = (params) => api.get('/ga4/rezdy-products', { params: toQs(params) }).then(r => r.data);

// ── Xero ─────────────────────────────────────────────────────────────────────
export const fetchXeroPnl          = (params) => api.get('/xero/pnl',                   { params: toQs(params) }).then(r => r.data);
export const fetchXeroMonthly      = (params) => api.get('/xero/monthly',               { params: toQs(params) }).then(r => r.data);
export const fetchXeroCostCentres  = (params) => api.get('/xero/cost-centre-breakdown', { params: toQs(params) }).then(r => r.data);
export const fetchXeroIncomeByPeriod = (params) => api.get('/xero/income-by-period',    { params: toQs(params) }).then(r => r.data);

// ── Marketing performance dashboard ──────────────────────────────────────────
export const fetchMarketingPerformance = (params) =>
  api.get('/marketing/performance', { params: toQs(params) }).then(r => r.data);
export const fetchAdAttribution = (params) =>
  api.get('/marketing/attribution', { params: toQs(params) }).then(r => r.data);

// ── Alerts / config ───────────────────────────────────────────────────────────
export const fetchAlertConfig    = ()       => api.get('/alerts/config').then(r => r.data);
export const testSlack           = ()       => api.post('/alerts/test-slack').then(r => r.data);
export const triggerWeeklySummary = ()      => api.post('/alerts/weekly-summary').then(r => r.data);
export const fetchHealth         = ()       => api.get('/health').then(r => r.data);
