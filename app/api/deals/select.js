// api/deals/select.js
// POST /api/deals/select — handles both supplier selection AND contract signing
// action=select: client selects a supplier, contract ready for in-app signing
// action=sign: client signs the contract in-app

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

  const { dealId, token, action, quoteId, supplier, unitRate, contractLength, signedName } = req.body;
  if (!dealId || !token) return res.status(400).json({ error: 'Missing required fields' });

  try {
    const { data: deal, error } = await supabase
      .from('deals')
      .select('*')
      .eq('id', dealId)
      .eq('magic_token', token)
      .single();

    if (error || !deal) return res.status(404).json({ error: 'Deal not found' });

    // ── SIGN CONTRACT ──
    if (action === 'sign') {
      if (!signedName) return res.status(400).json({ error: 'Missing signed name' });
      if (deal.status !== 'contract_sent') return res.status(400).json({ error: 'Contract is not ready for signing' });

      const signedAt = new Date().toISOString();
      const signerIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';

      await supabase.from('deals').update({
        status: 'won',
        contract_signed_at: signedAt,
        loa_document_url: (deal.loa_document_url || '') + ` | Contract signed by ${signedName} | IP: ${signerIp} | ${signedAt} | Supplier: ${deal.selected_supplier} | Rate: ${deal.selected_unit_rate}p/kWh`
      }).eq('id', dealId);

      await updateDealStage(deal.hubspot_deal_id, 'won', { closedate: signedAt });

      await sendEmail({
        to: deal.email,
        subject: `congratulations — your energy switch is confirmed with ${deal.selected_supplier}`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
          <p style="font-size:1.1rem;font-weight:600;color:#0D1B2A;">hi ${deal.name.split(' ')[0]},</p>
          <p style="color:#4A5568;line-height:1.7;">your energy contract with <strong>${deal.selected_supplier}</strong> at <strong>${deal.selected_unit_rate}p/kWh</strong> for <strong>${deal.selected_contract_length} months</strong> has been signed and confirmed.</p>
          <p style="color:#4A5568;line-height:1.7;">we're now handling everything — supplier notification, meter transfer, and switch coordination. we'll be in touch to confirm your switch date.</p>
          <div style="background:#F0F4F8;border-radius:8px;padding:16px;margin:16px 0;font-size:0.84rem;color:#4A5568;">
            <strong style="color:#0D1B2A;">contract record</strong><br>
            Signed by: ${signedName}<br>
            Company: ${deal.company}<br>
            Supplier: ${deal.selected_supplier}<br>
            Rate: ${deal.selected_unit_rate}p/kWh · ${deal.selected_contract_length} months<br>
            Date: ${new Date(signedAt).toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'})}<br>
            IP: ${signerIp}
          </div>
          <a href="${APP_URL}/${dealId}?token=${deal.magic_token}" style="display:inline-block;background:#2D6A4F;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:500;margin:16px 0;">view my deal room →</a>
          <p style="color:#8896A6;font-size:0.82rem;">edge energy · hello@edgeenergy.co.uk</p>
        </div>`
      });

      await sendEmail({
        to: BROKER_EMAIL,
        subject: `🎉 Contract signed: ${deal.company} → ${deal.selected_supplier} at ${deal.selected_unit_rate}p`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
          <p><strong>${deal.company}</strong> has signed their energy contract.</p>
          <p>Signed by: ${signedName}<br>IP: ${signerIp}<br>Time: ${signedAt}</p>
          <p>Supplier: ${deal.selected_supplier}<br>Rate: ${deal.selected_unit_rate}p/kWh · ${deal.selected_contract_length} months</p>
          <a href="${APP_URL}/broker" style="display:inline-block;background:#1A3A5C;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">open broker portal →</a>
        </div>`
      });

      return res.status(200).json({ success: true, signedAt, signedBy: signedName });
    }

    // ── SELECT SUPPLIER ──
    if (quoteId) {
      await supabase.from('quotes').update({ is_selected: false }).eq('deal_id', dealId);
      await supabase.from('quotes').update({ is_selected: true }).eq('id', quoteId);
    }

    await supabase.from('deals').update({
      selected_supplier: supplier,
      selected_unit_rate: unitRate,
      selected_contract_length: contractLength,
      status: 'contract_sent'
    }).eq('id', dealId);

    await updateDealStage(deal.hubspot_deal_id, 'contract_sent', {
      selected_supplier: supplier,
      selected_unit_rate: String(unitRate)
    });

    await sendEmail({
      to: deal.email,
      subject: `your energy contract is ready to review and sign — ${supplier}`,
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
        <p style="font-size:1.1rem;font-weight:600;color:#0D1B2A;">hi ${deal.name.split(' ')[0]},</p>
        <p style="color:#4A5568;line-height:1.7;">great choice! your energy contract with <strong>${supplier}</strong> at <strong>${unitRate}p/kWh</strong> for <strong>${contractLength} months</strong> is ready to review and sign.</p>
        <p style="color:#4A5568;line-height:1.7;">head to your deal room to review the contract terms and sign digitally.</p>
        <a href="${APP_URL}/${dealId}?token=${deal.magic_token}" style="display:inline-block;background:#2D6A4F;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:500;margin:16px 0;">review & sign contract →</a>
        <p style="color:#8896A6;font-size:0.82rem;">edge energy · hello@edgeenergy.co.uk</p>
      </div>`
    });

    await sendEmail({
      to: BROKER_EMAIL,
      subject: `📄 Supplier selected: ${deal.company} → ${supplier} at ${unitRate}p`,
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
        <p><strong>${deal.company}</strong> selected <strong>${supplier}</strong> at ${unitRate}p/kWh (${contractLength} months).</p>
        <p>Contract is ready for in-app signing in the deal room.</p>
        <a href="${APP_URL}/broker" style="display:inline-block;background:#1A3A5C;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">open broker portal →</a>
      </div>`
    });

    return res.status(200).json({ success: true, status: 'contract_sent' });

  } catch (error) {
    console.error('Select/sign error:', error);
    return res.status(500).json({ error: 'Failed to process request' });
  }
}
