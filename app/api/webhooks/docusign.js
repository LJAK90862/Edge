// api/webhooks/docusign.js
// POST /api/webhooks/docusign — DocuSign Connect webhook
// Handles contract signed events only (LOA is now signed in-app)

import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../lib/email.js';
import { updateDealStage } from '../../lib/hubspot.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BROKER_EMAIL = process.env.BROKER_EMAIL;
const APP_URL = process.env.APP_URL || 'https://app.edge-energy.uk';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const event = req.body;
    const envelopeId = event?.data?.envelopeId || event?.envelopeId;
    const status = event?.data?.envelopeSummary?.status || event?.status;

    if (!envelopeId || status !== 'completed') {
      return res.status(200).json({ received: true, action: 'ignored' });
    }

    // Find deal by contract envelope ID
    const { data: deal } = await supabase
      .from('deals')
      .select('*')
      .eq('contract_docusign_envelope_id', envelopeId)
      .single();

    if (deal && deal.status === 'contract_sent') {
      // Contract signed — deal is WON
      await supabase.from('deals').update({
        status: 'won',
        contract_signed_at: new Date().toISOString()
      }).eq('id', deal.id);

      // Sync HubSpot
      await updateDealStage(deal.hubspot_deal_id, 'won', {
        closedate: new Date().toISOString()
      });

      // Email client
      await sendEmail({
        to: deal.email,
        subject: `congratulations — your energy switch is confirmed!`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
          <p style="font-size:1.1rem;font-weight:600;color:#0D1B2A;">hi ${deal.name.split(' ')[0]},</p>
          <p style="color:#4A5568;line-height:1.7;">your contract with <strong>${deal.selected_supplier}</strong> has been signed. congratulations!</p>
          <p style="color:#4A5568;line-height:1.7;">we'll handle everything from here — supplier notification, meter transfer, and switch coordination. you'll see the improvement on your first bill.</p>
          <p style="color:#4A5568;line-height:1.7;">we'll be in touch to confirm the switch date and will track your contract renewal to make sure you never overpay again.</p>
          <a href="${APP_URL}/${deal.id}?token=${deal.magic_token}" style="display:inline-block;background:#2D6A4F;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:500;margin:16px 0;">view my deal room →</a>
          <p style="color:#8896A6;font-size:0.82rem;">edge energy · hello@edgeenergy.co.uk</p>
        </div>`
      });

      // Email broker
      await sendEmail({
        to: BROKER_EMAIL,
        subject: `🎉 Contract signed: ${deal.company} — ${deal.selected_supplier}`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
          <p><strong>${deal.company}</strong> has signed their contract!</p>
          <p>Supplier: ${deal.selected_supplier}<br>Rate: ${deal.selected_unit_rate}p/kWh<br>Name: ${deal.name}<br>Email: ${deal.email}</p>
          <p><strong>Next steps:</strong> notify supplier, coordinate meter transfer, confirm switch date.</p>
          <a href="${APP_URL}/broker" style="display:inline-block;background:#1A3A5C;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">open broker portal →</a>
        </div>`
      });

      return res.status(200).json({ received: true, action: 'contract_signed', dealId: deal.id });
    }

    return res.status(200).json({ received: true, action: 'no_matching_deal' });

  } catch (error) {
    console.error('DocuSign webhook error:', error);
    return res.status(200).json({ received: true, error: error.message });
  }
}
