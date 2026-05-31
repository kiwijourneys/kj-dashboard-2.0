/**
 * One-time script to generate a GA4 OAuth2 refresh token.
 * Run: node scripts/ga4-auth.js
 *
 * Uses the same OAuth2 client as Google Ads (same Google Cloud project).
 * The refresh token is saved — add it to Railway as GA4_OAUTH_REFRESH_TOKEN.
 */

require('dotenv').config();
const { google } = require('googleapis');
const http = require('http');
const url = require('url');

const CLIENT_ID     = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;
const REDIRECT_URI  = 'http://localhost:4242/callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing GOOGLE_ADS_CLIENT_ID or GOOGLE_ADS_CLIENT_SECRET in .env');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/analytics.readonly'],
});

console.log('\n── GA4 OAuth2 Token Generator ──────────────────────────────');
console.log('\n1. Open this URL in your browser:\n');
console.log('   ' + authUrl);
console.log('\n2. Log in with the Google account that has access to your GA4 property.');
console.log('3. After approving, the refresh token will be printed here.\n');

// Temporary local server to catch the callback
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname !== '/callback') return;

  const code = parsed.query.code;
  if (!code) {
    res.end('No code received.');
    server.close();
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.end('<h2>✓ Success! You can close this tab.</h2>');
    server.close();

    console.log('────────────────────────────────────────────────────────────');
    console.log('✓ Refresh token generated:\n');
    console.log('   GA4_OAUTH_REFRESH_TOKEN=' + tokens.refresh_token);
    console.log('\nAdd this to Railway → Variables, then redeploy.');
    console.log('────────────────────────────────────────────────────────────\n');
  } catch (err) {
    res.end('Error: ' + err.message);
    server.close();
    console.error('Error getting token:', err.message);
  }
});

server.listen(4242, () => {
  console.log('Waiting for browser callback on http://localhost:4242 ...\n');
});
