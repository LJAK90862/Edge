// api/deals/loa.js
// POST /api/deals/loa — in-app LOA signing (no DocuSign)

import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../lib/email.js';
import { updateDealStage } from '../../lib/hubspot.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BROKER_EMAIL = process.env.BROKER_EMAIL;
const APP_URL = process.env.APP_URL || 'https://app.edge-energy.uk';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { dealId, token, signedName } = req.body;
  if (!dealId || !token || !signedName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Verify deal
    const { data: deal, error } = await supabase
      .from('deals')
      .select('*')
      .eq('id', dealId)
      .eq('magic_token', token)
      .single();

    if (error || !deal) return res.status(404).json({ error: 'Deal not found' });

    // Record the LOA signature
    const signedAt = new Date().toISOString();
    const signerIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';

    await supabase.from('deals').update({
      status: 'supplier_info_requested',
      loa_signed_at: signedAt,
      loa_document_url: `Signed in-app by ${signedName} | IP: ${signerIp} | ${signedAt}`
    }).eq('id', dealId);

    // Sync HubSpot
    await updateDealStage(deal.hubspot_deal_id, 'supplier_info_requested', {
      loa_signed_date: signedAt
    });

    // Email client confirmation
    await sendEmail({
      to: deal.email,
      subject: `LOA signed — we're going to market for ${deal.company}`,
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
        <p style="font-size:1.1rem;font-weight:600;color:#0D1B2A;">hi ${deal.name.split(' ')[0]},</p>
        <p style="color:#4A5568;line-height:1.7;">your letter of authority has been signed. we're now contacting suppliers across the market to get you the best energy deal.</p>
        <p style="color:#4A5568;line-height:1.7;">we'll email you as soon as your quotes are ready — usually within 5–10 business days.</p>
        <div style="background:#F0F4F8;border-radius:8px;padding:16px;margin:16px 0;font-size:0.84rem;color:#4A5568;">
          <strong style="color:#0D1B2A;">signature record</strong><br>
          Signed by: ${signedName}<br>
          Company: ${deal.company}<br>
          Date: ${new Date(signedAt).toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'})} at ${new Date(signedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}<br>
          IP: ${signerIp}
        </div>
        <a href="${APP_URL}/${dealId}?token=${deal.magic_token}" style="display:inline-block;background:#2D6A4F;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:500;margin:16px 0;">view my deal room →</a>
        <p style="color:#8896A6;font-size:0.82rem;">edge energy · hello@edgeenergy.co.uk</p>
      </div>`
    });

    // Email current supplier requesting info (if we have their email)
    if (deal.current_supplier_email) {
      try {
        await sendEmail({
          to: deal.current_supplier_email,
          subject: `Letter of Authority — ${deal.company} — Edge Energy`,
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
            <p>Dear Sir/Madam,</p>
            <p style="color:#4A5568;line-height:1.7;">We are writing to inform you that <strong>${deal.company}</strong> has signed a Letter of Authority authorising Edge Energy to act on their behalf in relation to their energy supply.</p>
            <p style="color:#4A5568;line-height:1.7;">We kindly request the following information for the above customer at your earliest convenience:</p>
            <ul style="color:#4A5568;line-height:1.7;margin:8px 0 8px 20px;">
              <li>Current consumption data (historical usage)</li>
              <li>Meter details (MPAN / meter serial number)</li>
              <li>Current contract terms and end date</li>
            </ul>
            <p style="color:#4A5568;line-height:1.7;">Please do not hesitate to contact us if you require any further information.</p>
            <p style="color:#4A5568;line-height:1.7;">Kind regards,<br>Edge Energy</p>
            <p style="color:#8896A6;font-size:0.82rem;">edge energy · hello@edgeenergy.co.uk</p>
          </div>`
        });
      } catch(e) { console.error('Supplier email failed:', e); }
    }

    // Email broker
    await sendEmail({
      to: BROKER_EMAIL,
      subject: `✅ LOA signed: ${deal.company} — supplier info requested`,
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
        <p><strong>${deal.company}</strong> has signed their LOA in the deal room.</p>
        <p>Signed by: ${signedName}<br>Email: ${deal.email}<br>IP: ${signerIp}<br>Time: ${signedAt}</p>
        <p>kWh: ${deal.annual_kwh || '—'}<br>Current supplier: ${deal.current_supplier || '—'}<br>MPAN: ${deal.mpan || '—'}</p>
        <p><strong>Status:</strong> supplier info requested${deal.current_supplier_email ? ' — email sent to current supplier.' : ' — no supplier email on file, add one in the broker portal.'}</p>
        <a href="${APP_URL}/broker" style="display:inline-block;background:#1A3A5C;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">open broker portal →</a>
      </div>`
    });

    return res.status(200).json({ success: true, signedAt, signedBy: signedName });

  } catch (error) {
    console.error('LOA error:', error);
    return res.status(500).json({ error: 'Failed to process LOA signature' });
  }
}
