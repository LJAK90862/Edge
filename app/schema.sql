-- Edge Energy Deal Room Schema
-- Run this in Supabase SQL Editor

-- Deals table
create table deals (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  
  -- Access
  magic_token text unique not null default encode(gen_random_bytes(32), 'hex'),
  
  -- Contact info
  name text not null,
  email text not null,
  company text not null,
  phone text,
  
  -- Energy info
  annual_kwh numeric,
  current_supplier text,
  contract_end_date date,
  current_supplier_email text,
  mpan text,
  profile_class text,
  current_unit_rate numeric,
  
  -- Deal status
  status text default 'new_enquiry' check (status in ('new_enquiry', 'loa_requested', 'loa_signed', 'supplier_info_requested', 'quoting', 'contract_sent', 'won', 'lost')),
  
  -- TPI
  tpi_emails text,

  -- HubSpot sync
  hubspot_contact_id text,
  hubspot_deal_id text,
  
  -- LOA
  loa_signed_at timestamp with time zone,
  loa_document_url text,
  hellosign_signature_id text,
  
  -- Contract
  selected_supplier text,
  selected_unit_rate numeric,
  selected_contract_length integer,
  contract_signed_at timestamp with time zone,
  contract_start_date date,
  contract_end_date_new date,
  
  -- Contract DocuSign
  contract_docusign_envelope_id text,

  -- Renewal
  renewal_reminder_sent_at timestamp with time zone
);

-- Quotes table
create table quotes (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  deal_id uuid references deals(id) on delete cascade,
  
  supplier_name text not null,
  unit_rate numeric not null,
  standing_charge numeric,
  contract_length integer,
  quote_ref text,
  is_selected boolean default false,
  review_status text default 'staged' check (review_status in ('staged', 'approved', 'rejected')),
  broker_notes text
);

-- Contact enquiries table
create table enquiries (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  name text not null,
  email text not null,
  company text,
  phone text,
  message text not null,
  handled boolean default false
);

-- Enable RLS
alter table deals enable row level security;
alter table quotes enable row level security;
alter table enquiries enable row level security;

-- RLS policies — access by magic token (passed as header)
create policy "Access deal by magic token" on deals
  for all using (magic_token = current_setting('request.headers')::json->>'x-magic-token');

create policy "Access quotes for deal" on quotes
  for all using (
    deal_id in (
      select id from deals 
      where magic_token = current_setting('request.headers')::json->>'x-magic-token'
    )
  );

-- Service role can do everything (for API endpoints)
create policy "Service role full access deals" on deals
  for all using (auth.role() = 'service_role');

create policy "Service role full access quotes" on quotes
  for all using (auth.role() = 'service_role');

create policy "Service role full access enquiries" on enquiries
  for all using (auth.role() = 'service_role');

-- Updated at trigger
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger deals_updated_at
  before update on deals
  for each row execute function update_updated_at();

-- Chat messages table
create table messages (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  deal_id uuid references deals(id) on delete cascade,
  sender text not null check (sender in ('client', 'broker')),
  body text not null,
  read boolean default false
);

alter table messages enable row level security;

create policy "Service role full access messages" on messages
  for all using (auth.role() = 'service_role');
