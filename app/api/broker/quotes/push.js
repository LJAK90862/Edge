// api/broker/quotes/push.js
// POST /api/broker/quotes/push — batch push staged quotes to customer
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../../lib/email.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const APP_URL = process.env.APP_URL || 'https://app.edge-energy.uk';
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

  // Update all staged quotes to approved
  const { data: approvedQuotes, error: quotesError } = await supabase
    .from('quotes')
    .update({ review_status: 'approved' })
    .eq('deal_id', dealId)
    .eq('review_status', 'staged')
    .select();

  if (quotesError) return res.status(500).json({ error: quotesError.message });

  if (!approvedQuotes || approvedQuotes.length === 0) {
    return res.status(400).json({ error: 'No staged quotes to push for this deal' });
  }

  // Update deal status to quotes_presented
  const { error: dealError } = await supabase
    .from('deals')
    .update({ status: 'quotes_presented' })
    .eq('id', dealId);

  if (dealError) return res.status(500).json({ error: dealError.message });

  // Fetch deal for email details
  const { data: deal } = await supabase.from('deals').select('*').eq('id', dealId).single();

  if (deal) {
    // Email customer
    try {
      await sendEmail({
        to: deal.email,
        subject: `your energy quotes are ready — ${deal.company}`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
          <p style="font-size:1.1rem;font-weight:600;color:#0D1B2A;">hi ${deal.name.split(' ')[0]},</p>
          <p style="color:#4A5568;line-height:1.7;">your energy quotes are ready to view in your deal room. we've found ${approvedQuotes.length} option${approvedQuotes.length !== 1 ? 's' : ''} for you to compare.</p>
          <a href="${APP_URL}/${dealId}?token=${deal.magic_token}" style="display:inline-block;background:#2D6A4F;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:500;margin:16px 0;">view my quotes →</a>
          <p style="color:#8896A6;font-size:0.82rem;">edge energy · hello@edgeenergy.co.uk</p>
        </div>`
      });
    } catch(e) { console.error('Customer email failed:', e); }

    // Email broker
    if (BROKER_EMAIL) {
      try {
        await sendEmail({
          to: BROKER_EMAIL,
          subject: `quotes pushed to ${deal.company} — ${approvedQuotes.length} quote${approvedQuotes.length !== 1 ? 's' : ''}`,
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
            <p><strong>${approvedQuotes.length}</strong> quote${approvedQuotes.length !== 1 ? 's' : ''} pushed to <strong>${deal.company}</strong>.</p>
            <p>Customer: ${deal.name} (${deal.email})</p>
            <p>Deal status updated to <strong>quotes_presented</strong>.</p>
            <a href="${APP_URL}/broker" style="display:inline-block;background:#1A3A5C;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">open broker portal →</a>
            <p style="color:#8896A6;font-size:0.82rem;margin-top:16px;">edge energy · hello@edgeenergy.co.uk</p>
          </div>`
        });
      } catch(e) { console.error('Broker email failed:', e); }
    }
  }

  return res.status(200).json({ pushed: approvedQuotes.length, quotes: approvedQuotes });
}
