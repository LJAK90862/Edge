// api/enquiries/create.js
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../lib/email.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BROKER_EMAIL = process.env.BROKER_EMAIL;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, company, phone, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: 'Missing required fields' });

  try {
    await supabase.from('enquiries').insert({ name, email, company, phone, message });

    await sendEmail({
      to: BROKER_EMAIL, replyTo: email,
      subject: `📩 contact enquiry: ${company || name}`,
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
        <p><strong>new contact enquiry</strong></p>
        <p>Name: ${name}<br>Email: ${email}<br>Company: ${company||'—'}<br>Phone: ${phone||'—'}</p>
        <p><strong>message:</strong><br>${message}</p>
        <p style="color:#8896A6;font-size:0.82rem;">reply to this email to respond directly to ${name}.</p>
      </div>`
    });

    await sendEmail({
      to: email, subject: 'thanks for getting in touch — edge energy',
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px;">
        <p style="font-size:1.1rem;font-weight:600;color:#0D1B2A;">hi ${name.split(' ')[0]},</p>
        <p style="color:#4A5568;line-height:1.7;">thanks for reaching out. one of our advisers will be in touch within one business day.</p>
        <p style="color:#8896A6;font-size:0.82rem;">edge energy · hello@edgeenergy.co.uk</p>
      </div>`
    });

    return res.status(200).json({ success: true });
  } catch(error) {
    console.error('Enquiry error:', error);
    return res.status(500).json({ error: 'Failed to send enquiry' });
  }
}
