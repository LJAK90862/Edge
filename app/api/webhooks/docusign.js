// api/webhooks/docusign.js
// POST /api/webhooks/docusign — DocuSign Connect webhook
// Handles both LOA signed and Contract signed events

import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../lib/email.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BROKER_EMAIL = process.env.BROKER_EMAIL;
const APP_URL = process.env.APP_URL || 'https://app.edge-energy.uk';
const LOA_TEMPLATE_ID = process.env.DOCUSIGN_LOA_TEMPLATE_ID;
const CONTRACT_TEMPLATE_ID = process.env.DOCUSIGN_CONTRACT_TEMPLATE_ID;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const event = req.body;
    const envelopeId = event?.data?.envelopeId || event?.envelopeId;
    const status = event?.data?.envelopeSummary?.status || event?.status;
    const templateId = event?.data?.envelopeSummary?.templateId;

    if (!envelopeId || status !== 'completed') {
      return res.status(200).json({ received: true, action: 'ignored' });
    }

    // Find the deal by envelope ID (stored in hellosign_signature_id for LOA or contract_docusign_envelope_id)
    // Check LOA first
    const { data: loaDeal } = await supabase
      .from('deals')
      .select('*')
      .eq('hellosign_signature_id', envelopeId)
      .single();

    if (loaDeal && ['pending', 'loa_sent'].includes(loaDeal.status)) {
      // LOA has been signed
      await supabase.from('deals').update({
        status: 'loa_signed',
        loa_signed_at: new Date().toISOString()
      }).eq('id', loaDeal.id);

      // Email client
      await sendEmail({
        to: loaDeal.email,
        subject: `LOA signed — we're going to market for ${loaDeal.company}`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
          <p style="font-size:1.1rem;font-weight:600;color:#0D1B2A;">hi ${loaDeal.name.split(' ')[0]},</p>
          <p style="color:#4A5568;line-height:1.7;">your letter of authority has been signed. we're now contacting suppliers across the market to get you the best energy deal.</p>
          <p style="color:#4A5568;line-height:1.7;">we'll email you as soon as your quotes are ready — usually within 5–10 business days.</p>
          <a href="${APP_URL}/${loaDeal.id}?token=${loaDeal.magic_token}" style="display:inline-block;background:#2D6A4F;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:500;margin:16px 0;">view my deal room →</a>
          <p style="color:#8896A6;font-size:0.82rem;">edge energy · hello@edgeenergy.co.uk</p>
        </div>`
      });

      // Email current supplier if we have their email
      if (loaDeal.current_supplier_email) {
        try {
          await sendEmail({
            to: loaDeal.current_supplier_email,
            subject: `Letter of Authority — ${loaDeal.company} — Edge Energy`,
            html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
              <p>Dear Sir/Madam,</p>
              <p style="color:#4A5568;line-height:1.7;">We are writing to inform you that <strong>${loaDeal.company}</strong> has signed a Letter of Authority authorising Edge Energy to act on their behalf in relation to their energy supply.</p>
              <p style="color:#4A5568;line-height:1.7;">As their appointed energy broker, we are authorised to approach suppliers, obtain pricing, and manage the procurement process for their energy contracts.</p>
              <p style="color:#4A5568;line-height:1.7;">We may be in touch shortly to request contract and consumption data for the above customer. Please do not hesitate to contact us if you require any further information.</p>
              <p style="color:#4A5568;line-height:1.7;">Kind regards,<br>Edge Energy</p>
              <p style="color:#8896A6;font-size:0.82rem;">edge energy · hello@edgeenergy.co.uk</p>
            </div>`
          });
        } catch(e) { console.error('Supplier email failed:', e); }
      }

      // Email broker
      await sendEmail({
        to: BROKER_EMAIL,
        subject: `✅ LOA signed: ${loaDeal.company} — ready for RFQs`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
          <p><strong>${loaDeal.company}</strong> has signed their LOA.</p>
          <p>Name: ${loaDeal.name}<br>Email: ${loaDeal.email}<br>kWh: ${loaDeal.annual_kwh || '—'}<br>Current supplier: ${loaDeal.current_supplier || '—'}<br>MPAN: ${loaDeal.mpan || '—'}</p>
          <p><strong>Next step:</strong> send RFQ emails to suppliers and add quotes to the deal room.</p>
          <a href="${APP_URL}/broker" style="display:inline-block;background:#1A3A5C;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">open broker portal →</a>
        </div>`
      });

      return res.status(200).json({ received: true, action: 'loa_signed', dealId: loaDeal.id });
    }

    // Check contract
    const { data: contractDeal } = await supabase
      .from('deals')
      .select('*')
      .eq('contract_docusign_envelope_id', envelopeId)
      .single();

    if (contractDeal && ['contract_sent'].includes(contractDeal.status)) {
      // Contract has been signed — deal is WON
      await supabase.from('deals').update({
        status: 'won',
        contract_signed_at: new Date().toISOString()
      }).eq('id', contractDeal.id);

      // Email client — congratulations
      await sendEmail({
        to: contractDeal.email,
        subject: `congratulations — your energy switch is confirmed!`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
          <p style="font-size:1.1rem;font-weight:600;color:#0D1B2A;">hi ${contractDeal.name.split(' ')[0]},</p>
          <p style="color:#4A5568;line-height:1.7;">your contract with <strong>${contractDeal.selected_supplier}</strong> has been signed. congratulations!</p>
          <p style="color:#4A5568;line-height:1.7;">we'll handle everything from here — supplier notification, meter transfer, and switch coordination. you'll see the improvement on your first bill.</p>
          <p style="color:#4A5568;line-height:1.7;">we'll be in touch to confirm the switch date and will track your contract renewal to make sure you never overpay again.</p>
          <a href="${APP_URL}/${contractDeal.id}?token=${contractDeal.magic_token}" style="display:inline-block;background:#2D6A4F;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:500;margin:16px 0;">view my deal room →</a>
          <p style="color:#8896A6;font-size:0.82rem;">edge energy · hello@edgeenergy.co.uk</p>
        </div>`
      });

      // Email broker
      await sendEmail({
        to: BROKER_EMAIL,
        subject: `🎉 Contract signed: ${contractDeal.company} — ${contractDeal.selected_supplier}`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
          <p><strong>${contractDeal.company}</strong> has signed their contract!</p>
          <p>Supplier: ${contractDeal.selected_supplier}<br>Rate: ${contractDeal.selected_unit_rate}p/kWh<br>Name: ${contractDeal.name}<br>Email: ${contractDeal.email}</p>
          <p><strong>Next steps:</strong> notify supplier, coordinate meter transfer, confirm switch date.</p>
          <a href="${APP_URL}/broker" style="display:inline-block;background:#1A3A5C;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">open broker portal →</a>
        </div>`
      });

      return res.status(200).json({ received: true, action: 'contract_signed', dealId: contractDeal.id });
    }

    return res.status(200).json({ received: true, action: 'no_matching_deal' });

  } catch (error) {
    console.error('DocuSign webhook error:', error);
    return res.status(200).json({ received: true, error: error.message });
  }
}
