/**
 * Exchange a short-lived Meta user token for a 60-day long-lived token,
 * then write it to .env automatically.
 *
 * Usage:
 *   1. Go to https://developers.facebook.com/tools/explorer/
 *   2. Select your app from the top-right dropdown
 *   3. Click "Generate Access Token" — add permissions: ads_read, ads_management
 *   4. Copy the token shown
 *   5. Run: node scripts/meta-auth.js <paste-token-here>
 */

require('dotenv').config();
const https  = require('https');
const fs     = require('fs');
const path   = require('path');

const shortToken   = process.argv[2];
const APP_ID       = process.env.META_APP_ID;
const APP_SECRET   = process.env.META_APP_SECRET;
const ENV_PATH     = path.resolve(__dirname, '../.env');

if (!shortToken) {
  console.error('\nUsage: node scripts/meta-auth.js <short-lived-token>');
  console.error('\nSteps to get a short-lived token:');
  console.error('  1. Go to https://developers.facebook.com/tools/explorer/');
  console.error('  2. Select your app from the top-right dropdown');
  console.error('  3. Add permissions: ads_read, ads_management');
  console.error('  4. Click "Generate Access Token" and copy it');
  process.exit(1);
}

if (!APP_ID || !APP_SECRET) {
  console.error('\nERROR: META_APP_ID and META_APP_SECRET must be set in backend/.env');
  process.exit(1);
}

console.log('\n── Meta Long-Lived Token Exchange ──────────────────────────────');
console.log('APP_ID present:', !!APP_ID);
console.log('APP_SECRET present:', !!APP_SECRET);
console.log('Short token (first 20 chars):', shortToken.slice(0, 20) + '...');

const url = `https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${encodeURIComponent(shortToken)}`;

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(data); } catch (e) {
      console.error('\nERROR: Could not parse response:', data);
      process.exit(1);
    }

    if (parsed.error) {
      console.error('\nMeta API error:', parsed.error.message);
      console.error('Type:', parsed.error.type);
      process.exit(1);
    }

    const longToken = parsed.access_token;
    const expiresIn = parsed.expires_in;
    const expiryDays = Math.round(expiresIn / 86400);

    console.log(`\n✅ Long-lived token obtained (expires in ~${expiryDays} days)`);

    // Write to .env
    try {
      let env = fs.readFileSync(ENV_PATH, 'utf8');
      if (env.match(/^META_ACCESS_TOKEN=.*/m)) {
        env = env.replace(/^META_ACCESS_TOKEN=.*/m, `META_ACCESS_TOKEN=${longToken}`);
      } else {
        env += `\nMETA_ACCESS_TOKEN=${longToken}\n`;
      }
      fs.writeFileSync(ENV_PATH, env, 'utf8');
      console.log('✅ Written to backend/.env automatically\n');
    } catch (err) {
      console.error('\nWARNING: Could not write to .env:', err.message);
    }

    console.log('────────────────────────────────────────────────────────────');
    console.log('Add this to Railway Variables:\n');
    console.log('META_ACCESS_TOKEN=' + longToken);
    console.log('\n────────────────────────────────────────────────────────────');
    console.log(`\nRemember: this token expires in ~${expiryDays} days. Re-run this script when it expires.\n`);
  });
}).on('error', (err) => {
  console.error('\nRequest failed:', err.message);
  process.exit(1);
});
