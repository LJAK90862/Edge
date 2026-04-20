// api/deals/select.js
// POST /api/deals/select — client selects a supplier, triggers contract via DocuSign

import { createClient } from '@supabase/supabase-js';
import { sendEnvelope } from '../../lib/docusign.js';
import { sendEmail } from '../../lib/email.js';
import { updateDealStage } from '../../lib/hubspot.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BROKER_EMAIL = process.env.BROKER_EMAIL;
const APP_URL = process.env.APP_URL || 'https://app.edge-energy.uk';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { dealId, token, quoteId, supplier, unitRate, contractLength } = req.body;
  if (!dealId || !token) return res.status(400).json({ error: 'Missing required fields' });

  try {
    // Verify deal
    const { data: deal, error } = await supabase
      .from('deals')
      .select('*')
      .eq('id', dealId)
      .eq('magic_token', token)
      .single();

    if (error || !deal) return res.status(404).json({ error: 'Deal not found' });

    // Mark the selected quote
    if (quoteId) {
      await supabase.from('quotes').update({ is_selected: false }).eq('deal_id', dealId);
      await supabase.from('quotes').update({ is_selected: true }).eq('id', quoteId);
    }

    // Update deal with selected supplier
    await supabase.from('deals').update({
      selected_supplier: supplier,
      selected_unit_rate: unitRate,
      selected_contract_length: contractLength
    }).eq('id', dealId);

    // Send contract via DocuSign
    const envelope = await sendEnvelope({
      templateId: process.env.DOCUSIGN_CONTRACT_TEMPLATE_ID,
      signerEmail: deal.email,
      signerName: deal.name,
      emailSubject: `Your Energy Contract — ${supplier} — Edge Energy`
    });

    // Update deal status and store envelope ID
    await supabase.from('deals').update({
      status: 'contract_sent',
      contract_docusign_envelope_id: envelope.envelopeId
    }).eq('id', dealId);

    // Sync HubSpot
    await updateDealStage(deal.hubspot_deal_id, 'contract_sent', {
      selected_supplier: supplier,
      selected_unit_rate: String(unitRate),
      contract_docusign_envelope_id: envelope.envelopeId
    });

    // Email client
    await sendEmail({
      to: deal.email,
      subject: `your energy contract is ready to sign — ${supplier}`,
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
        <p style="font-size:1.1rem;font-weight:600;color:#0D1B2A;">hi ${deal.name.split(' ')[0]},</p>
        <p style="color:#4A5568;line-height:1.7;">great choice! we've sent your energy contract with <strong>${supplier}</strong> at <strong>${unitRate}p/kWh</strong> via DocuSign.</p>
        <p style="color:#4A5568;line-height:1.7;">check your email for the DocuSign contract, review and sign digitally. once signed, we'll handle everything — supplier notification, meter transfer, and switch coordination.</p>
        <a href="${APP_URL}/${dealId}?token=${deal.magic_token}" style="display:inline-block;background:#2D6A4F;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:500;margin:16px 0;">view my deal room →</a>
        <p style="color:#8896A6;font-size:0.82rem;">edge energy · hello@edgeenergy.co.uk</p>
      </div>`
    });

    // Email broker
    await sendEmail({
      to: BROKER_EMAIL,
      subject: `📄 Contract sent: ${deal.company} → ${supplier} at ${unitRate}p`,
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
        <p><strong>${deal.company}</strong> selected <strong>${supplier}</strong> at ${unitRate}p/kWh (${contractLength} months).</p>
        <p>Contract sent via DocuSign. Envelope ID: ${envelope.envelopeId}</p>
        <a href="${APP_URL}/broker" style="display:inline-block;background:#1A3A5C;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">open broker portal →</a>
      </div>`
    });

    return res.status(200).json({ success: true, envelopeId: envelope.envelopeId });

  } catch (error) {
    console.error('Select supplier error:', error);
    return res.status(500).json({ error: 'Failed to send contract' });
  }
}
