// api/broker/rfq.js
// POST /api/broker/rfq — send RFQ emails to TPIs for a deal

import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../lib/email.js';
import { updateDealStage } from '../../lib/hubspot.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BROKER_KEY = process.env.BROKER_KEY || 'edge-broker-2026';
const BROKER_EMAIL = process.env.BROKER_EMAIL;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-broker-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.headers['x-broker-key'] !== BROKER_KEY) return res.status(401).json({ error: 'Unauthorised' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { dealId } = req.body;
  if (!dealId) return res.status(400).json({ error: 'Missing dealId' });

  try {
    // Fetch deal
    const { data: deal, error } = await supabase
      .from('deals')
      .select('*')
      .eq('id', dealId)
      .single();

    if (error || !deal) return res.status(404).json({ error: 'Deal not found' });

    // Parse TPI emails
    const tpiEmails = (deal.tpi_emails || '')
      .split(',')
      .map(e => e.trim())
      .filter(e => e.length > 0);

    if (tpiEmails.length === 0) {
      return res.status(400).json({ error: 'No TPI emails configured for this deal. Add them in the info tab.' });
    }

    // Send RFQ email to each TPI
    for (const tpiEmail of tpiEmails) {
      try {
        await sendEmail({
          to: tpiEmail,
          subject: `Request for Quotation — ${deal.company} — Edge Energy`,
          html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;">
            <p>Dear Sir/Madam,</p>
            <p style="color:#4A5568;line-height:1.7;">We are requesting energy supply quotations for the following customer on behalf of Edge Energy.</p>
            <table style="width:100%;border-collapse:collapse;margin:20px 0;">
              <tr><td style="padding:8px 12px;border:1px solid #E2E8F0;font-weight:600;color:#0D1B2A;width:40%;">Company</td><td style="padding:8px 12px;border:1px solid #E2E8F0;color:#4A5568;">${deal.company}</td></tr>
              <tr><td style="padding:8px 12px;border:1px solid #E2E8F0;font-weight:600;color:#0D1B2A;">Annual kWh</td><td style="padding:8px 12px;border:1px solid #E2E8F0;color:#4A5568;">${deal.annual_kwh ? Number(deal.annual_kwh).toLocaleString() : '—'}</td></tr>
              <tr><td style="padding:8px 12px;border:1px solid #E2E8F0;font-weight:600;color:#0D1B2A;">MPAN</td><td style="padding:8px 12px;border:1px solid #E2E8F0;color:#4A5568;">${deal.mpan || '—'}</td></tr>
              <tr><td style="padding:8px 12px;border:1px solid #E2E8F0;font-weight:600;color:#0D1B2A;">Current Supplier</td><td style="padding:8px 12px;border:1px solid #E2E8F0;color:#4A5568;">${deal.current_supplier || '—'}</td></tr>
              <tr><td style="padding:8px 12px;border:1px solid #E2E8F0;font-weight:600;color:#0D1B2A;">Contract End Date</td><td style="padding:8px 12px;border:1px solid #E2E8F0;color:#4A5568;">${deal.contract_end_date || '—'}</td></tr>
              <tr><td style="padding:8px 12px;border:1px solid #E2E8F0;font-weight:600;color:#0D1B2A;">Profile Class</td><td style="padding:8px 12px;border:1px solid #E2E8F0;color:#4A5568;">${deal.profile_class || '—'}</td></tr>
            </table>
            <p style="color:#4A5568;line-height:1.7;">Please reply to this email with your best rates at your earliest convenience.</p>
            <p style="color:#4A5568;line-height:1.7;">Kind regards,<br>Edge Energy</p>
            <p style="color:#8896A6;font-size:0.82rem;">edge energy · hello@edgeenergy.co.uk</p>
          </div>`
        });
      } catch (e) {
        console.error(`RFQ email to ${tpiEmail} failed:`, e);
      }
    }

    // Update deal status to quoting
    await supabase.from('deals').update({ status: 'quoting' }).eq('id', dealId);

    // Sync HubSpot
    if (deal.hubspot_deal_id) {
      await updateDealStage(deal.hubspot_deal_id, 'quoting');
    }

    // Email broker confirmation
    if (BROKER_EMAIL) {
      try {
        await sendEmail({
          to: BROKER_EMAIL,
          subject: `RFQ sent: ${deal.company} — ${tpiEmails.length} TPI(s)`,
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
            <p><strong>RFQ emails sent</strong> for <strong>${deal.company}</strong>.</p>
            <p>Sent to: ${tpiEmails.join(', ')}</p>
            <p>Deal status updated to <strong>quoting</strong>.</p>
            <p style="color:#8896A6;font-size:0.82rem;margin-top:16px;">edge energy · hello@edgeenergy.co.uk</p>
          </div>`
        });
      } catch (e) { console.error('Broker RFQ confirmation email failed:', e); }
    }

    return res.status(200).json({ success: true, sent: tpiEmails.length });

  } catch (error) {
    console.error('RFQ error:', error);
    return res.status(500).json({ error: 'Failed to send RFQ emails' });
  }
}
