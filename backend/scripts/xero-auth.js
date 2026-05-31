/**
 * One-time Xero OAuth 2.0 setup script.
 *
 * Usage:
 *   XERO_CLIENT_ID=xxx XERO_CLIENT_SECRET=yyy node scripts/xero-auth.js
 *
 * Steps:
 *   1. Create a Xero app at https://developer.xero.com/myapps/
 *      - Integration type: Web app
 *      - Redirect URI: http://localhost:3001/callback
 *      - Scopes: openid profile email accounting.reports.read offline_access
 *   2. Set XERO_CLIENT_ID and XERO_CLIENT_SECRET in .env (or pass as env vars above)
 *   3. Run this script — it opens the auth URL and listens for the callback
 *   4. Authorise in browser
 *   5. Copy the printed env vars into .env
 */

require('dotenv').config();
const fs     = require('fs');
const path   = require('path');
const http   = require('http');
const https  = require('https');
const url    = require('url');
const crypto = require('crypto');

const ENV_FILE = path.resolve(__dirname, '../.env');

function writeToEnv(key, value) {
  let content = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const regex = new RegExp(`^${key}=.*`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}\n`;
  }
  fs.writeFileSync(ENV_FILE, content, 'utf8');
}

const CLIENT_ID     = process.env.XERO_CLIENT_ID;
const CLIENT_SECRET = process.env.XERO_CLIENT_SECRET;
const REDIRECT_URI  = 'http://localhost:3001/callback';
const SCOPES        = 'openid profile email accounting.reports.profitandloss.read accounting.settings.read offline_access';
const PORT          = 3001;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌  Set XERO_CLIENT_ID and XERO_CLIENT_SECRET first.');
  console.error('   Either add them to .env or run as:');
  console.error('   XERO_CLIENT_ID=xxx XERO_CLIENT_SECRET=yyy node scripts/xero-auth.js');
  process.exit(1);
}

const state = crypto.randomBytes(16).toString('hex');

const authUrl =
  `https://login.xero.com/identity/connect/authorize` +
  `?response_type=code` +
  `&client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&state=${state}`;

console.log('\n🔑  Xero OAuth Setup\n');
console.log('Open this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for redirect on http://localhost:3001/callback ...\n');

// Try to open the browser automatically
try {
  const { execSync } = require('child_process');
  execSync(`open "${authUrl}"`);
} catch (_) { /* ignore — user will open manually */ }

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (!parsed.pathname.startsWith('/callback')) {
    res.end('Not found');
    return;
  }

  const { code, state: returnedState, error } = parsed.query;

  if (error) {
    res.end(`<h2>Error: ${error}</h2>`);
    console.error('❌  Auth error:', error);
    server.close();
    return;
  }

  if (returnedState !== state) {
    res.end('<h2>State mismatch — possible CSRF</h2>');
    console.error('❌  State mismatch');
    server.close();
    return;
  }

  // Exchange code for tokens
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const body = new URLSearchParams({
    grant_type:   'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  }).toString();

  const tokenResp = await postJson(
    'https://identity.xero.com/connect/token',
    body,
    { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' }
  );

  const { access_token, refresh_token } = tokenResp;

  // Get tenant ID
  const tenantsResp = await getJson('https://api.xero.com/connections', {
    Authorization: `Bearer ${access_token}`,
  });

  const tenant = tenantsResp[0];
  if (!tenant) {
    res.end('<h2>No Xero organisations found</h2>');
    server.close();
    return;
  }

  const tenantId = tenant.tenantId;
  const orgName  = tenant.tenantName;

  writeToEnv('XERO_TENANT_ID', tenantId);
  writeToEnv('XERO_REFRESH_TOKEN', refresh_token);

  console.log(`\n✅  Authorised for: ${orgName}`);
  console.log('   XERO_TENANT_ID and XERO_REFRESH_TOKEN written to .env automatically.\n');
  console.log('   Make sure these are also in .env (if not already):');
  console.log(`   XERO_CLIENT_ID=${CLIENT_ID}`);
  console.log(`   XERO_CLIENT_SECRET=${CLIENT_SECRET}\n`);

  res.end(`
    <h2>✅ Authorised: ${orgName}</h2>
    <p>Copy these into your .env file:</p>
    <p>✅ Credentials written to .env automatically. You can close this tab.</p>
  `);

  server.close();
});

server.listen(PORT, () => {});

// ── Simple HTTP helpers ───────────────────────────────────────────────────────

function request(method, urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method,
      headers:  { ...headers, 'Content-Length': body ? Buffer.byteLength(body) : 0 },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function postJson(url, body, headers) { return request('POST', url, body, headers); }
function getJson(url, headers)        { return request('GET',  url, null, headers); }
