// api/broker/quotes.js
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../lib/email.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const APP_URL = process.env.APP_URL || 'https://app.edge-energy.uk';
const BROKER_KEY = process.env.BROKER_KEY || 'edge-broker-2026';
const BROKER_EMAIL = process.env.BROKER_EMAIL;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-broker-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.headers['x-broker-key'] !== BROKER_KEY) return res.status(401).json({ error: 'Unauthorised' });

  if (req.method === 'GET') {
    let query = supabase.from('quotes').select('*').eq('deal_id', req.query.dealId);
    if (req.query.status) query = query.eq('review_status', req.query.status);
    query = query.order('unit_rate', { ascending: true });
    const { data: quotes } = await query;
    return res.status(200).json({ quotes: quotes || [] });
  }

  if (req.method === 'POST') {
    const { dealId, supplierName, unitRate, standingCharge, contractLength, quoteRef } = req.body;

    const { data: quote, error } = await supabase.from('quotes').insert({
      deal_id: dealId, supplier_name: supplierName, unit_rate: unitRate,
      standing_charge: standingCharge, contract_length: contractLength, quote_ref: quoteRef,
      review_status: 'staged'
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });

    const { data: deal } = await supabase.from('deals').select('*').eq('id', dealId).single();

    if (deal && BROKER_EMAIL) {
      try {
        await sendEmail({
          to: BROKER_EMAIL,
          subject: `new quote staged for ${deal.company} — review needed`,
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
            <p>a new quote from <strong>${supplierName}</strong> at <strong>${unitRate}p/kWh</strong> has been staged for <strong>${deal.company}</strong>.</p>
            <p>please review and approve before pushing to the customer.</p>
            <a href="${APP_URL}/broker" style="display:inline-block;background:#1A3A5C;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:500;">open broker portal →</a>
            <p style="color:#8896A6;font-size:0.82rem;margin-top:16px;">edge energy · hello@edgeenergy.co.uk</p>
          </div>`
        });
      } catch(e) { console.error('Email failed:', e); }
    }

    return res.status(200).json({ quote });
  }

  if (req.method === 'PATCH') {
    const { id, supplier_name, unit_rate, standing_charge, contract_length, quote_ref, broker_notes, review_status } = req.body;

    if (!id) return res.status(400).json({ error: 'Missing quote id' });

    const updates = {};
    if (supplier_name !== undefined) updates.supplier_name = supplier_name;
    if (unit_rate !== undefined) updates.unit_rate = unit_rate;
    if (standing_charge !== undefined) updates.standing_charge = standing_charge;
    if (contract_length !== undefined) updates.contract_length = contract_length;
    if (quote_ref !== undefined) updates.quote_ref = quote_ref;
    if (broker_notes !== undefined) updates.broker_notes = broker_notes;
    if (review_status !== undefined) updates.review_status = review_status;

    const { data: quote, error } = await supabase.from('quotes').update(updates).eq('id', id).select().single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ quote });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;

    if (!id) return res.status(400).json({ error: 'Missing quote id' });

    // Only allow deleting staged quotes
    const { data: existing } = await supabase.from('quotes').select('review_status').eq('id', id).single();
    if (!existing) return res.status(404).json({ error: 'Quote not found' });
    if (existing.review_status !== 'staged') return res.status(400).json({ error: 'Only staged quotes can be deleted' });

    const { error } = await supabase.from('quotes').delete().eq('id', id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ deleted: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
