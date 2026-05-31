/**
 * One-time script to generate a GA4 OAuth2 refresh token.
 * Uses google-auth-library (already a backend dependency).
 * Run: node scripts/ga4-auth.js
 */

require('dotenv').config();
const { OAuth2Client } = require('google-auth-library');
const http = require('http');
const url = require('url');

const CLIENT_ID     = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;
const REDIRECT_URI  = 'http://localhost:4242/callback';

console.log('── GA4 OAuth2 Token Generator ──────────────────────────────');
console.log('CLIENT_ID present:', !!CLIENT_ID);
console.log('CLIENT_SECRET present:', !!CLIENT_SECRET);

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\nERROR: Missing GOOGLE_ADS_CLIENT_ID or GOOGLE_ADS_CLIENT_SECRET in .env');
  process.exit(1);
}

const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: 'https://www.googleapis.com/auth/analytics.readonly',
});

console.log('\n1. Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n2. Log in with your Google account that has GA4 access.');
console.log('3. The refresh token will print here automatically.\n');

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname !== '/callback') { res.end('waiting...'); return; }

  const code = parsed.query.code;
  if (!code) { res.end('No code.'); server.close(); return; }

  try {
    const { tokens } = await client.getToken(code);
    res.end('<h2>Success! Close this tab.</h2>');
    server.close();
    console.log('\n────────────────────────────────────────────────────────────');
    console.log('Add this to Railway Variables:\n');
    console.log('GA4_OAUTH_REFRESH_TOKEN=' + tokens.refresh_token);
    console.log('\n────────────────────────────────────────────────────────────');
    process.exit(0);
  } catch (err) {
    res.end('Error: ' + err.message);
    console.error('\nERROR:', err.message);
    server.close();
    process.exit(1);
  }
});

server.on('error', err => {
  console.error('Server error:', err.message);
  process.exit(1);
});

server.listen(4242, () => {
  console.log('Waiting for browser callback on http://localhost:4242 ...');
});
