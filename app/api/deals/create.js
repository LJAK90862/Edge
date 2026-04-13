// api/deals/create.js
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../lib/email.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const APP_URL = process.env.APP_URL || 'https://app.edge-energy.uk';
const BROKER_EMAIL = process.env.BROKER_EMAIL;
const HUBSPOT_TOKEN = process.env.HUBSPOT_API_KEY;

async function createHubSpotContact(data) {
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${HUBSPOT_TOKEN}` },
    body: JSON.stringify({ properties: {
      firstname: data.name.split(' ')[0],
      lastname: data.name.split(' ').slice(1).join(' ') || 'Unknown',
      email: data.email, company: data.company, phone: data.phone,
      lead_source_detail: 'get_started_form'
    }})
  });
  return (await res.json()).id;
}

async function createHubSpotDeal(data, contactId, dealId) {
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/deals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${HUBSPOT_TOKEN}` },
    body: JSON.stringify({ properties: {
      dealname: `${data.company} — Energy Contract`,
      pipeline: 'default', dealstage: 'appointmentscheduled',
      annual_kwh: data.annualKwh, current_supplier: data.currentSupplier,
      contract_end_date: data.contractEndDate, contact_email: data.email,
      quote_page_url: `${APP_URL}/${dealId}`
    }})
  });
  return (await res.json()).id;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, company, phone, annualKwh, currentSupplier, contractEndDate } = req.body;
  if (!name || !email || !company) return res.status(400).json({ error: 'Missing required fields' });

  try {
    const { data: deal, error } = await supabase.from('deals').insert({
      name, email, company, phone,
      annual_kwh: annualKwh ? parseFloat(annualKwh) : null,
      current_supplier: currentSupplier,
      contract_end_date: contractEndDate || null,
      status: 'pending'
    }).select().single();

    if (error) throw error;

    const portalUrl = `${APP_URL}/${deal.id}?token=${deal.magic_token}`;

    try {
      const contactId = await createHubSpotContact({ name, email, company, phone });
      const hubspotDealId = await createHubSpotDeal({ name, email, company, annualKwh, currentSupplier, contractEndDate }, contactId, deal.id);
      await supabase.from('deals').update({ hubspot_contact_id: contactId, hubspot_deal_id: hubspotDealId }).eq('id', deal.id);
    } catch(e) { console.error('HubSpot error:', e); }

    await sendEmail({
      to: email, subject: 'your edge energy deal room is ready',
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
        <p style="font-size:1.1rem;font-weight:600;color:#0D1B2A;">hi ${name.split(' ')[0]},</p>
        <p style="color:#4A5568;line-height:1.7;">your personal energy deal room is ready. sign your letter of authority, review quotes, and confirm your contract — all in one place.</p>
        <a href="${portalUrl}" style="display:inline-block;background:#2D6A4F;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:500;margin:24px 0;">open my deal room →</a>
        <p style="color:#8896A6;font-size:0.82rem;">reply to this email with any questions.<br><br>edge energy · hello@edgeenergy.co.uk</p>
      </div>`
    });

    await sendEmail({
      to: BROKER_EMAIL, subject: `🆕 new deal room: ${company}`,
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
        <p><strong>new get started submission</strong></p>
        <p>Name: ${name}<br>Email: ${email}<br>Company: ${company}<br>Phone: ${phone||'—'}<br>kWh: ${annualKwh||'—'}<br>Supplier: ${currentSupplier||'—'}<br>Contract end: ${contractEndDate||'—'}</p>
        <a href="${portalUrl}" style="display:inline-block;background:#1A3A5C;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">view deal room →</a>
      </div>`
    });

    return res.status(200).json({ success: true, dealId: deal.id });
  } catch(error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Failed to create deal room' });
  }
}
