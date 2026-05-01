// api/auth/login.js
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const password_hash = createHash('sha256').update(password + process.env.SUPABASE_SERVICE_KEY).digest('hex');

  const { data: deal, error } = await supabase
    .from('deals')
    .select('id, magic_token, name, company')
    .eq('email', email)
    .eq('password_hash', password_hash)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !deal) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  return res.status(200).json({
    success: true,
    dealId: deal.id,
    token: deal.magic_token,
    name: deal.name,
    company: deal.company
  });
}
