// api/messages/index.js
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../lib/email.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BROKER_EMAIL = process.env.BROKER_EMAIL;
const APP_URL = process.env.APP_URL || 'https://app.edge-energy.uk';

async function verifyToken(dealId, token) {
  const { data } = await supabase.from('deals').select('*').eq('id', dealId).eq('magic_token', token).single();
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { dealId, token } = req.query;
    const deal = await verifyToken(dealId, token);
    if (!deal) return res.status(404).json({ error: 'Not found' });

    const { data: messages } = await supabase.from('messages').select('*').eq('deal_id', dealId).order('created_at', { ascending: true });
    await supabase.from('messages').update({ read: true }).eq('deal_id', dealId).eq('sender', 'client').eq('read', false);

    return res.status(200).json({ messages: messages || [] });
  }

  if (req.method === 'POST') {
    const { dealId, token, body, sender, brokerKey } = req.body;
    if (!body) return res.status(400).json({ error: 'Missing body' });

    // Verify access
    let deal;
    if (sender === 'broker') {
      if (brokerKey !== process.env.BROKER_KEY) return res.status(401).json({ error: 'Unauthorised' });
      const { data } = await supabase.from('deals').select('*').eq('id', dealId).single();
      deal = data;
    } else {
      deal = await verifyToken(dealId, token);
    }
    if (!deal) return res.status(404).json({ error: 'Not found' });

    const { data: message, error } = await supabase.from('messages').insert({ deal_id: dealId, sender: sender || 'client', body }).select().single();
    if (error) return res.status(500).json({ error: 'Failed to save' });

    // Notify
    try {
      if (sender === 'broker') {
        await sendEmail({
          to: deal.email, subject: `new message from edge energy`,
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
            <p>hi ${deal.name.split(' ')[0]}, you have a new message in your deal room:</p>
            <div style="background:#F0F4F8;border-left:4px solid #2D6A4F;padding:16px;border-radius:4px;margin:16px 0;">
              <p style="margin:0;color:#0D1B2A;line-height:1.7;">${body}</p>
            </div>
            <a href="${APP_URL}/${deal.id}?token=${deal.magic_token}" style="display:inline-block;background:#2D6A4F;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">view my deal room →</a>
          </div>`
        });
      } else {
        await sendEmail({
          to: BROKER_EMAIL, replyTo: deal.email,
          subject: `💬 new message: ${deal.company}`,
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
            <p><strong>${deal.name}</strong> from <strong>${deal.company}</strong> sent a message:</p>
            <div style="background:#F0F4F8;border-left:4px solid #2D6A4F;padding:16px;border-radius:4px;margin:16px 0;">
              <p style="margin:0;color:#0D1B2A;line-height:1.7;">${body}</p>
            </div>
            <a href="${APP_URL}/broker" style="display:inline-block;background:#1A3A5C;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">reply in broker portal →</a>
          </div>`
        });
      }
    } catch(e) { console.error('Email failed:', e); }

    return res.status(200).json({ message });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
