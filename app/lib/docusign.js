// lib/docusign.js
// DocuSign eSignature helper — supports JWT grant, client credentials, or static token

import crypto from 'crypto';

const DOCUSIGN_BASE = process.env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi';
const ACCOUNT_ID = process.env.DOCUSIGN_ACCOUNT_ID;
const INTEGRATION_KEY = process.env.DOCUSIGN_INTEGRATION_KEY;

const AUTH_BASE = DOCUSIGN_BASE.includes('demo')
  ? 'https://account-d.docusign.com'
  : 'https://account.docusign.com';

let cachedToken = null;
let tokenExpiry = 0;

function base64url(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createJWT() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: INTEGRATION_KEY,
    sub: process.env.DOCUSIGN_USER_ID,
    aud: AUTH_BASE.replace('https://', ''),
    iat: now,
    exp: now + 3600,
    scope: 'signature'
  }));

  const privateKey = process.env.DOCUSIGN_PRIVATE_KEY.replace(/\\n/g, '\n');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(privateKey, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return `${header}.${payload}.${signature}`;
}

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry - 300000) return cachedToken;

  // Static token override
  if (process.env.DOCUSIGN_ACCESS_TOKEN) {
    cachedToken = process.env.DOCUSIGN_ACCESS_TOKEN;
    tokenExpiry = Date.now() + 3600000;
    return cachedToken;
  }

  // JWT grant (preferred — uses private key + user ID)
  if (process.env.DOCUSIGN_PRIVATE_KEY && process.env.DOCUSIGN_USER_ID) {
    const jwt = createJWT();
    const res = await fetch(`${AUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('DocuSign JWT auth error:', err);
      throw new Error(`DocuSign JWT auth failed: ${res.status} - ${err}`);
    }

    const data = await res.json();
    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000);
    return cachedToken;
  }

  // Client credentials fallback (integration key + secret key)
  if (process.env.DOCUSIGN_SECRET_KEY) {
    const res = await fetch(`${AUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${INTEGRATION_KEY}&client_secret=${process.env.DOCUSIGN_SECRET_KEY}&scope=signature`
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('DocuSign client credentials error:', err);
      throw new Error(`DocuSign auth failed: ${res.status}`);
    }

    const data = await res.json();
    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000);
    return cachedToken;
  }

  throw new Error('No DocuSign authentication method configured');
}

export async function sendEnvelope({ templateId, signerEmail, signerName, emailSubject, templateRoles }) {
  const token = await getAccessToken();

  const body = {
    templateId,
    emailSubject: emailSubject || 'Please sign this document — Edge Energy',
    templateRoles: templateRoles || [{
      email: signerEmail,
      name: signerName,
      roleName: 'Client'
    }],
    status: 'sent'
  };

  const res = await fetch(`${DOCUSIGN_BASE}/v2.1/accounts/${ACCOUNT_ID}/envelopes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DocuSign error: ${res.status} ${err}`);
  }

  return res.json();
}
