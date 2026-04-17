// lib/docusign.js
// DocuSign eSignature helper — uses JWT grant for auth

const DOCUSIGN_BASE = process.env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi';
const ACCOUNT_ID = process.env.DOCUSIGN_ACCOUNT_ID;
const INTEGRATION_KEY = process.env.DOCUSIGN_INTEGRATION_KEY;
const SECRET_KEY = process.env.DOCUSIGN_SECRET_KEY;

// For demo/sandbox, auth endpoint is account-d.docusign.com
const AUTH_BASE = DOCUSIGN_BASE.includes('demo')
  ? 'https://account-d.docusign.com'
  : 'https://account.docusign.com';

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  // Return cached token if still valid (with 5min buffer)
  if (cachedToken && Date.now() < tokenExpiry - 300000) return cachedToken;

  // Use static token if provided
  if (process.env.DOCUSIGN_ACCESS_TOKEN) {
    cachedToken = process.env.DOCUSIGN_ACCESS_TOKEN;
    tokenExpiry = Date.now() + 3600000;
    return cachedToken;
  }

  // Otherwise use client credentials (integration key + secret key)
  const credentials = Buffer.from(`${INTEGRATION_KEY}:${SECRET_KEY}`).toString('base64');

  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`
    },
    body: 'grant_type=client_credentials&scope=signature'
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('DocuSign auth error:', err);
    throw new Error(`DocuSign auth failed: ${res.status}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);
  return cachedToken;
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
