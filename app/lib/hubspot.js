// lib/hubspot.js
// HubSpot CRM sync helper

const HUBSPOT_TOKEN = process.env.HUBSPOT_API_KEY;
const HS_API = 'https://api.hubapi.com';

// Map internal status to HubSpot deal stage IDs
const STAGE_MAP = {
  pending:            'appointmentscheduled',  // LOA Sent
  loa_sent:           'appointmentscheduled',
  loa_signed:         'qualifiedtobuy',        // Quotes Requested
  quotes_requested:   'qualifiedtobuy',
  quotes_presented:   'presentationscheduled',  // Quotes Presented
  contract_sent:      'decisionmakerboughtin',  // Contract Sent
  won:                'contractsent',           // Closed Won
  lost:               'closedlost',             // Closed Lost
};

async function hsRequest(method, path, body) {
  if (!HUBSPOT_TOKEN) return null;
  const res = await fetch(`${HS_API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${HUBSPOT_TOKEN}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`HubSpot ${method} ${path} failed:`, err);
    return null;
  }
  return res.json();
}

export async function updateDealStage(hubspotDealId, status, extraProperties = {}) {
  if (!hubspotDealId || !HUBSPOT_TOKEN) return;
  const dealstage = STAGE_MAP[status];
  if (!dealstage) return;

  const properties = { dealstage, ...extraProperties };
  try {
    await hsRequest('PATCH', `/crm/v3/objects/deals/${hubspotDealId}`, { properties });
  } catch (e) {
    console.error('HubSpot stage update failed:', e);
  }
}

export async function createContact(data) {
  return hsRequest('POST', '/crm/v3/objects/contacts', {
    properties: {
      firstname: data.name.split(' ')[0],
      lastname: data.name.split(' ').slice(1).join(' ') || 'Unknown',
      email: data.email,
      company: data.company,
      phone: data.phone,
      lead_source_detail: 'get_started_form'
    }
  });
}

export async function createDeal(data, contactId, dealId, portalUrl) {
  const deal = await hsRequest('POST', '/crm/v3/objects/deals', {
    properties: {
      dealname: `${data.company} — Energy Contract`,
      pipeline: 'default',
      dealstage: 'appointmentscheduled',
      annual_kwh: data.annualKwh,
      current_supplier: data.currentSupplier,
      contract_end_date: data.contractEndDate,
      contact_email: data.email,
      quote_page_url: portalUrl
    }
  });

  // Associate contact with deal
  if (deal && contactId) {
    try {
      await hsRequest('PUT', `/crm/v3/objects/deals/${deal.id}/associations/contacts/${contactId}/deal_to_contact`, {});
    } catch (e) { /* association may fail silently */ }
  }

  return deal;
}
