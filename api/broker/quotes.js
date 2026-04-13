// api/broker/quotes.js
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../lib/email.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const APP_URL = process.env.APP_URL || 'https://app.edge-energy.uk';
const BROKER_KEY = process.env.BROKER_KEY || 'edge-broker-2026';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-broker-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.headers['x-broker-key'] !== BROKER_KEY) return res.status(401).json({ error: 'Unauthorised' });

  if (req.method === 'GET') {
    const { data: quotes } = await supabase.from('quotes').select('*').eq('deal_id', req.query.dealId).order('unit_rate', { ascending: true });
    return res.status(200).json({ quotes: quotes || [] });
  }

  if (req.method === 'POST') {
    const { dealId, supplierName, unitRate, standingCharge, contractLength, quoteRef } = req.body;

    const { data: quote, error } = await supabase.from('quotes').insert({
      deal_id: dealId, supplier_name: supplierName, unit_rate: unitRate,
      standing_charge: standingCharge, contract_length: contractLength, quote_ref: quoteRef
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });

    await supabase.from('deals').update({ status: 'quotes_presented' }).eq('id', dealId);

    const { data: deal } = await supabase.from('deals').select('*').eq('id', dealId).single();

    if (deal) {
      try {
        await sendEmail({
          to: deal.email, subject: `your energy quotes are ready — ${deal.company}`,
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
            <p>hi ${deal.name.split(' ')[0]}, we've added a quote from <strong>${supplierName}</strong> at <strong>${unitRate}p/kWh</strong> to your deal room.</p>
            <a href="${APP_URL}/${dealId}?token=${deal.magic_token}" style="display:inline-block;background:#2D6A4F;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:500;">view my quotes →</a>
            <p style="color:#8896A6;font-size:0.82rem;margin-top:16px;">edge energy · hello@edgeenergy.co.uk</p>
          </div>`
        });
      } catch(e) { console.error('Email failed:', e); }
    }

    return res.status(200).json({ quote });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
