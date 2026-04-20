// api/debug/docusign.js — temporary debug endpoint
import crypto from 'crypto';

const DOCUSIGN_BASE = process.env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi';
const ACCOUNT_ID = process.env.DOCUSIGN_ACCOUNT_ID;
const INTEGRATION_KEY = process.env.DOCUSIGN_INTEGRATION_KEY;
const AUTH_BASE = DOCUSIGN_BASE.includes('demo') ? 'https://account-d.docusign.com' : 'https://account.docusign.com';

function base64url(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default async function handler(req, res) {
  const results = { steps: [] };

  try {
    // Step 1: Check env vars
    results.steps.push({
      step: 'env_check',
      has_private_key: !!process.env.DOCUSIGN_PRIVATE_KEY,
      has_user_id: !!process.env.DOCUSIGN_USER_ID,
      has_integration_key: !!INTEGRATION_KEY,
      has_account_id: !!ACCOUNT_ID,
      base_url: DOCUSIGN_BASE,
      template_id: process.env.DOCUSIGN_LOA_TEMPLATE_ID
    });

    // Step 2: Try JWT auth
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
    const jwt = `${header}.${payload}.${signature}`;

    const authRes = await fetch(`${AUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    const authBody = await authRes.text();
    results.steps.push({ step: 'jwt_auth', status: authRes.status, body: authBody });

    if (!authRes.ok) {
      return res.status(200).json(results);
    }

    const token = JSON.parse(authBody).access_token;

    // Step 3: List templates
    const templatesRes = await fetch(`${DOCUSIGN_BASE}/v2.1/accounts/${ACCOUNT_ID}/templates`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const templatesBody = await templatesRes.text();
    results.steps.push({ step: 'list_templates', status: templatesRes.status, body: templatesBody.substring(0, 2000) });

    // Step 4: Try to get the specific template
    const templateRes = await fetch(`${DOCUSIGN_BASE}/v2.1/accounts/${ACCOUNT_ID}/templates/${process.env.DOCUSIGN_LOA_TEMPLATE_ID}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const templateBody = await templateRes.text();
    results.steps.push({ step: 'get_template', status: templateRes.status, body: templateBody.substring(0, 2000) });

  } catch (e) {
    results.error = e.message;
    results.stack = e.stack;
  }

  return res.status(200).json(results);
}
