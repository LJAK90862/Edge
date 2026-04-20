// api/broker/deals.js
// GET  /api/broker/deals        — list all deals
// PATCH /api/broker/deals/[id]  — update deal status

import { createClient } from '@supabase/supabase-js';
import { updateDealStage } from '../../lib/hubspot.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BROKER_KEY = process.env.BROKER_KEY || 'edge-broker-2026';

function authCheck(req, res) {
  const key = req.headers['x-broker-key'];
  if (key !== BROKER_KEY) {
    res.status(401).json({ error: 'Unauthorised' });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-broker-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!authCheck(req, res)) return;

  if (req.method === 'GET') {
    // Get all deals with unread message count
    const { data: deals } = await supabase
      .from('deals')
      .select('*, messages(count)')
      .order('created_at', { ascending: false });

    // Get unread counts separately
    const { data: unread } = await supabase
      .from('messages')
      .select('deal_id, count(*)')
      .eq('sender', 'client')
      .eq('read', false);

    const unreadMap = {};
    (unread || []).forEach(r => { unreadMap[r.deal_id] = r.count; });

    const dealsWithUnread = (deals || []).map(d => ({
      ...d,
      unread_count: unreadMap[d.id] || 0
    }));

    return res.status(200).json({ deals: dealsWithUnread });
  }

  if (req.method === 'PATCH') {
    const id = req.query.id;
    const { status, mpan, annual_kwh, current_unit_rate, profile_class, contract_end_date, current_supplier_email, tpi_emails } = req.body;

    const updates = {};
    if (status) updates.status = status;
    if (mpan) updates.mpan = mpan;
    if (annual_kwh) updates.annual_kwh = annual_kwh;
    if (current_unit_rate) updates.current_unit_rate = current_unit_rate;
    if (profile_class) updates.profile_class = profile_class;
    if (contract_end_date) updates.contract_end_date = contract_end_date;
    if (current_supplier_email) updates.current_supplier_email = current_supplier_email;
    if (tpi_emails !== undefined) updates.tpi_emails = tpi_emails;

    const { data, error } = await supabase
      .from('deals')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Sync HubSpot when status changes
    if (status && data.hubspot_deal_id) {
      await updateDealStage(data.hubspot_deal_id, status);
    }

    return res.status(200).json({ deal: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
