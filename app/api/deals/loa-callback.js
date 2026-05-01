// api/deals/loa-callback.js — Handle return from DocuSign signing
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../lib/email.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const APP_URL = process.env.APP_URL || 'https://app.edge-energy.uk';
const BROKER_EMAIL = process.env.BROKER_EMAIL;

export default async function handler(req, res) {
  const { dealId, token, event } = req.query;

  if (!dealId || !token) return res.redirect(APP_URL);

  const { data: deal } = await supabase
    .from('deals')
    .select('*')
    .eq('id', dealId)
    .eq('magic_token', token)
    .single();

  if (!deal) return res.redirect(APP_URL);

  // DocuSign returns event=signing_complete on success
  if (event === 'signing_complete') {
    await supabase.from('deals').update({
      status: 'loa_signed',
      loa_signed_at: new Date().toISOString()
    }).eq('id', dealId);

    // Notify broker
    try {
      await sendEmail({
        to: BROKER_EMAIL,
        subject: `✅ LOA signed: ${deal.company}`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
          <p><strong>${deal.name}</strong> from <strong>${deal.company}</strong> has signed their Letter of Authority.</p>
          <p>You can now go to market and request quotes on their behalf.</p>
          <a href="${APP_URL}/broker" style="display:inline-block;background:#1A3A5C;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">open broker portal →</a>
        </div>`
      });
    } catch (e) { console.error('Email failed:', e); }
  }

  // Redirect back to consulting room
  return res.redirect(`${APP_URL}/${dealId}?token=${token}`);
}
