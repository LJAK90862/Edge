// api/broker/emails.js — Fetch and parse supplier quote emails from Gmail
import { ImapFlow } from 'imapflow';

const BROKER_KEY = process.env.BROKER_KEY || 'edge-broker-2026';
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

function parseQuoteFromEmail(subject, from, text) {
  const result = {
    supplier: '',
    unitRate: null,
    standingCharge: null,
    contractLength: null,
    quoteRef: null,
    raw: text ? text.substring(0, 500) : ''
  };

  // Extract supplier from sender name or subject
  const fromMatch = from.match(/^"?([^"<]+)/);
  result.supplier = fromMatch ? fromMatch[1].trim() : from.split('@')[0];

  // Clean common suffixes
  result.supplier = result.supplier
    .replace(/\s*(sales|quotes|commercial|energy|team|pricing|no-?reply)$/i, '')
    .trim();

  if (!text) return result;
  const t = text.toLowerCase();

  // Unit rate patterns: "21.3p/kWh", "21.3 p/kwh", "unit rate: 21.3", "21.3 pence per kwh"
  const ratePatterns = [
    /(?:unit\s*rate|energy\s*rate|rate)\s*[:=]?\s*(\d+\.?\d*)\s*(?:p(?:ence)?(?:\s*(?:per|\/)\s*kwh)?)/i,
    /(\d+\.?\d*)\s*p\s*(?:per\s*)?(?:\/\s*)?kwh/i,
    /(\d+\.?\d*)\s*pence\s*per\s*kwh/i,
    /(\d+\.?\d*)\s*p\/kwh/i,
  ];
  for (const pat of ratePatterns) {
    const m = text.match(pat);
    if (m) { result.unitRate = parseFloat(m[1]); break; }
  }

  // Standing charge patterns: "standing charge: 42p/day", "42p per day", "42 pence/day"
  const scPatterns = [
    /(?:standing\s*charge|daily\s*charge|sc)\s*[:=]?\s*(\d+\.?\d*)\s*(?:p(?:ence)?(?:\s*(?:per|\/)\s*day)?)/i,
    /(\d+\.?\d*)\s*p\s*(?:per\s*)?(?:\/\s*)?day/i,
  ];
  for (const pat of scPatterns) {
    const m = text.match(pat);
    if (m) { result.standingCharge = parseFloat(m[1]); break; }
  }

  // Contract length: "24 months", "2 year", "12-month"
  const clPatterns = [
    /(\d+)\s*[-]?\s*months?\b/i,
    /(\d+)\s*[-]?\s*years?\b/i,
  ];
  for (const pat of clPatterns) {
    const m = text.match(pat);
    if (m) {
      const val = parseInt(m[1]);
      result.contractLength = pat.source.includes('year') ? val * 12 : val;
      break;
    }
  }

  // Quote reference: "ref: QR-12345", "reference: ABC123", "quote ref QR123"
  const refPatterns = [
    /(?:quote\s*)?ref(?:erence)?\s*[:=#]?\s*([A-Z0-9][\w-]{2,20})/i,
    /(?:quotation|proposal)\s*(?:no|number|#)?\s*[:=#]?\s*([A-Z0-9][\w-]{2,20})/i,
  ];
  for (const pat of refPatterns) {
    const m = text.match(pat);
    if (m) { result.quoteRef = m[1]; break; }
  }

  return result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-broker-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.headers['x-broker-key'] !== BROKER_KEY) return res.status(401).json({ error: 'Unauthorised' });

  const days = parseInt(req.query.days) || 14;
  const since = new Date(Date.now() - days * 86400000);

  let client;
  try {
    client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
      logger: false
    });

    await client.connect();

    const lock = await client.getMailboxLock('INBOX');
    const emails = [];

    try {
      // Search for recent emails (skip sent by us)
      const messages = client.fetch(
        { since, from: { not: GMAIL_USER } },
        { envelope: true, source: true, bodyStructure: true }
      );

      let count = 0;
      for await (const msg of messages) {
        if (count >= 50) break; // cap at 50 emails

        const from = msg.envelope?.from?.[0];
        const fromStr = from ? `${from.name || ''} <${from.address}>` : 'unknown';
        const subject = msg.envelope?.subject || '';
        const date = msg.envelope?.date;

        // Get plain text body
        let text = '';
        if (msg.source) {
          const raw = msg.source.toString();
          // Simple text extraction - get content after headers
          const parts = raw.split(/\r?\n\r?\n/);
          if (parts.length > 1) {
            text = parts.slice(1).join('\n\n')
              .replace(/<[^>]+>/g, ' ')         // strip HTML tags
              .replace(/=\r?\n/g, '')            // decode quoted-printable line breaks
              .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
              .replace(/\s+/g, ' ')
              .trim()
              .substring(0, 2000);
          }
        }

        // Skip emails that don't look like quotes
        const lowerSubject = subject.toLowerCase();
        const lowerText = text.toLowerCase();
        const isQuoteLikely = /quote|quotation|proposal|pricing|rate|tariff|offer|kwh|unit\s*rate|standing/i.test(subject + ' ' + text);

        const parsed = parseQuoteFromEmail(subject, fromStr, text);

        emails.push({
          id: msg.uid,
          date: date ? new Date(date).toISOString() : null,
          from: fromStr,
          subject,
          isQuoteLikely,
          parsed,
        });

        count++;
      }
    } finally {
      lock.release();
    }

    await client.logout();

    // Sort: likely quotes first, then by date desc
    emails.sort((a, b) => {
      if (a.isQuoteLikely && !b.isQuoteLikely) return -1;
      if (!a.isQuoteLikely && b.isQuoteLikely) return 1;
      return new Date(b.date) - new Date(a.date);
    });

    return res.status(200).json({ emails, count: emails.length });

  } catch (err) {
    console.error('IMAP error:', err);
    return res.status(500).json({ error: 'Failed to fetch emails', detail: err.message });
  } finally {
    if (client) try { await client.logout(); } catch(e) {}
  }
}
