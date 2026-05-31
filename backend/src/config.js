require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  cacheTtl: parseInt(process.env.CACHE_TTL || '3600', 10),

  hubspot: {
    accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
    // Pipeline IDs
    multiDaySalesPipelineId: '998655438',
    multiDayOpsPipelineId: '998655439',
    singleDayPipelineId: 'default',
    ignoredPipelineId: '998228462', // Bookings/Wherewolf — waiver submissions

    // Multi Day Sales stage IDs
    multiDayStages: {
      initialEnquiry: '1547076036',
      allocated: '1547076037',
      noContact: '1547076038',
      tourDiscoveryHad: '1547076039',
      draftItinerarySent: '1547080150',
      finalItinerarySent: '1547080151',
      depositReceived: '1547076041',
      bookingConfirmed: '1547076043',
      bookingFormSent: '1593995717',
      completedFormReceived: '1547076044',
      bookingAdminComplete: '1547076045', // CLOSED WON (Operations pipeline)
      closedLost: '1547076042',
      // Operations pipeline stages (for funnel)
      bookingFormSent: '1593995717',
      completedFormReceived: '1547076044',
    },

    // Single Day stage IDs
    singleDayStages: {
      initialEnquiry: 'appointmentscheduled',
      allocated: 'qualifiedtobuy',
      inProgress: '1675949560',
      bookingAdminComplete: 'decisionmakerboughtin', // CLOSED WON
      complete: 'closedwon',                          // CLOSED WON
      closedLost: 'closedlost',
    },
  },

  ga4: {
    propertyId: process.env.GA4_PROPERTY_ID,
    serviceAccountJson: process.env.GA4_SERVICE_ACCOUNT_JSON,
    // Confirmed GA4 purchase/conversion event names
    eventBikeRental: process.env.GA4_EVENT_BIKE_RENTAL || 'BRM',
    eventSingleDay:  process.env.GA4_EVENT_SINGLE_DAY  || 'redezy',
  },

  googleAds: {
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    clientId: process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    customerId: process.env.GOOGLE_ADS_CUSTOMER_ID,
    loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID, // MCC manager account
  },

  meta: {
    appId: process.env.META_APP_ID,
    appSecret: process.env.META_APP_SECRET,
    accessToken: process.env.META_ACCESS_TOKEN,
    adAccountId: process.env.META_AD_ACCOUNT_ID,
    apiVersion: 'v19.0',
  },

  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL,
  },

  xero: {
    clientId:     process.env.XERO_CLIENT_ID,
    clientSecret: process.env.XERO_CLIENT_SECRET,
    tenantId:     process.env.XERO_TENANT_ID,
    refreshToken: process.env.XERO_REFRESH_TOKEN,
  },

  fxRateUsdToNzd: parseFloat(process.env.FX_RATE_USD_TO_NZD || '0.57'),

  // Region config
  regions: {
    NELSON: 'Nelson',
    CENTRAL_OTAGO: 'Central Otago',
    WEST_COAST: 'West Coast',
  },
  // Depot names map to parent regions
  depotRegionMap: {
    'Nelson Depot': 'Nelson',
    'Mapua Depot': 'Nelson',
    'Hokitika Depot': 'West Coast',
    'Cromwell Depot': 'Central Otago',
  },
};

module.exports = config;
