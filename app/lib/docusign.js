// lib/docusign.js
// DocuSign eSignature helper

const DOCUSIGN_BASE = process.env.DOCUSIGN_BASE_URL || 'https://na4.docusign.net/restapi';
const ACCOUNT_ID = process.env.DOCUSIGN_ACCOUNT_ID;
const INTEGRATION_KEY = process.env.DOCUSIGN_INTEGRATION_KEY;
const SECRET_KEY = process.env.DOCUSIGN_SECRET_KEY;

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  // Use refresh token grant or JWT — for simplicity using JWT assertion
  // In production, use OAuth JWT flow with RSA key
  // For now, use the access token directly from env if set
  if (process.env.DOCUSIGN_ACCESS_TOKEN) {
    cachedToken = process.env.DOCUSIGN_ACCESS_TOKEN;
    tokenExpiry = Date.now() + 3600000; // assume 1hr
    return cachedToken;
  }

  throw new Error('DOCUSIGN_ACCESS_TOKEN not configured');
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
