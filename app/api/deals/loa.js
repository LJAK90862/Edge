// api/deals/loa.js
// GET /api/deals/loa?dealId=xxx&token=xxx — sends LOA via DocuSign

import { createClient } from '@supabase/supabase-js';
import { sendEnvelope } from '../../lib/docusign.js';
import { sendEmail } from '../../lib/email.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BROKER_EMAIL = process.env.BROKER_EMAIL;
const APP_URL = process.env.APP_URL || 'https://app.edge-energy.uk';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { dealId, token } = req.query;
  if (!dealId || !token) return res.status(400).json({ error: 'Missing dealId or token' });

  try {
    // Verify deal
    const { data: deal, error } = await supabase
      .from('deals')
      .select('*')
      .eq('id', dealId)
      .eq('magic_token', token)
      .single();

    if (error || !deal) return res.status(404).json({ error: 'Deal not found' });

    // Send LOA via DocuSign
    const envelope = await sendEnvelope({
      templateId: process.env.DOCUSIGN_LOA_TEMPLATE_ID,
      signerEmail: deal.email,
      signerName: deal.name,
      emailSubject: `Letter of Authority — ${deal.company} — Edge Energy`
    });

    // Update deal status
    await supabase.from('deals').update({
      status: 'loa_sent',
      hellosign_signature_id: envelope.envelopeId
    }).eq('id', dealId);

    // Notify broker
    await sendEmail({
      to: BROKER_EMAIL,
      subject: `📝 LOA sent: ${deal.company}`,
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
        <p><strong>LOA sent via DocuSign</strong></p>
        <p>Company: ${deal.company}<br>Name: ${deal.name}<br>Email: ${deal.email}<br>Envelope ID: ${envelope.envelopeId}</p>
        <a href="${APP_URL}/broker" style="display:inline-block;background:#1A3A5C;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">open broker portal →</a>
      </div>`
    });

    // Redirect back to deal room
    return res.redirect(302, `${APP_URL}/${dealId}?token=${token}&loa=sent`);

  } catch (error) {
    console.error('LOA error:', error);
    // Return error details for debugging (change to redirect in production)
    return res.status(500).json({ error: error.message, stack: error.stack });
  }
}
