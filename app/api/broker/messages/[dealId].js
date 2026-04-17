// api/broker/messages/[dealId].js
// GET /api/broker/messages/[dealId] — get messages for a deal (broker view)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BROKER_KEY = process.env.BROKER_KEY || 'edge-broker-2026';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-broker-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = req.headers['x-broker-key'];
  if (key !== BROKER_KEY) return res.status(401).json({ error: 'Unauthorised' });

  const dealId = req.query.dealId;

  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: true });

  // Mark client messages as read
  await supabase.from('messages')
    .update({ read: true })
    .eq('deal_id', dealId)
    .eq('sender', 'client')
    .eq('read', false);

  return res.status(200).json({ messages: messages || [] });
}
