#!/usr/bin/env node
/**
 * One-time Gmail OAuth2 setup.
 * Opens browser for consent, exchanges code for refresh token,
 * saves credentials to data/secrets/gmail-oauth.json.
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import { URL } from 'url';
import { exec } from 'child_process';

const CLIENT_ID = process.argv[2];
const CLIENT_SECRET = process.argv[3];
const EMAIL = process.argv[4] || 'your-email@gmail.com';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Usage: node setup/gmail-oauth.js <client_id> <client_secret> [email]');
  process.exit(1);
}

const REDIRECT_PORT = 8765;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +
  `&prompt=consent` +
  `&login_hint=${encodeURIComponent(EMAIL)}`;

function exchangeCode(code) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString();

    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': body.length },
    }, (res) => {
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Token exchange failed (${res.statusCode}): ${data}`));
        resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
  if (url.pathname !== '/callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h1>Error: ${error}</h1><p>Please try again.</p>`);
    console.error(`OAuth error: ${error}`);
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400);
    res.end('No code received');
    return;
  }

  try {
    const tokens = await exchangeCode(code);
    const credentials = {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      email: EMAIL,
    };

    fs.mkdirSync('data/secrets', { recursive: true });
    fs.writeFileSync('data/secrets/gmail-oauth.json', JSON.stringify(credentials, null, 2) + '\n');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Gmail authenticated!</h1><p>You can close this window. Credentials saved.</p>');
    console.log('\n✓ Gmail OAuth credentials saved to data/secrets/gmail-oauth.json');
    console.log(`  Email: ${EMAIL}`);
    console.log(`  Refresh token: ${tokens.refresh_token.slice(0, 20)}...`);

    setTimeout(() => process.exit(0), 500);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h1>Error</h1><p>${err.message}</p>`);
    console.error(err.message);
    process.exit(1);
  }
});

server.listen(REDIRECT_PORT, () => {
  console.log(`\nOpening browser for Gmail authorization...`);
  console.log(`If the browser doesn't open, visit:\n${authUrl}\n`);

  exec(`open "${authUrl}"`);
});
