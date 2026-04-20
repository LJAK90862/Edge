// api/deals/[id].js
// GET /api/deals/[id]?token=MAGIC_TOKEN

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id, token } = req.query;

  if (!id || !token) {
    return res.status(400).json({ error: 'Missing id or token' });
  }

  try {
    // Get deal
    const { data: deal, error } = await supabase
      .from('deals')
      .select('*')
      .eq('id', id)
      .eq('magic_token', token)
      .single();

    if (error || !deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    // Get quotes
    const { data: quotes } = await supabase
      .from('quotes')
      .select('*')
      .eq('deal_id', id)
      .eq('review_status', 'approved')
      .order('unit_rate', { ascending: true });

    // Don't expose the magic token in the response
    const { magic_token, ...safeDeal } = deal;

    return res.status(200).json({ deal: safeDeal, quotes: quotes || [] });

  } catch (error) {
    console.error('Error fetching deal:', error);
    return res.status(500).json({ error: 'Failed to fetch deal' });
  }
}
