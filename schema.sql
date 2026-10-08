-- VA P3 inbox triage: one row per email, invoices pulled out of it, reply drafts for enquiries.
-- Clinic info sheet the prompt reads (same table as the clinic chat assistant). Load it: see README.
create table if not exists kb (id int primary key default 1, body text);
create table if not exists p3_emails (
  id serial primary key,
  mail_id text unique not null,
  from_addr text,
  subject text,
  received_at timestamptz,
  category text check (category in ('invoice','enquiry','supplier','spam','other')),
  summary text,
  urgency text check (urgency in ('low','normal','high')),
  processed_at timestamptz default now()
);
create table if not exists p3_invoices (
  id serial primary key,
  mail_id text references p3_emails(mail_id),
  vendor text,
  invoice_no text,
  amount numeric(12,2),
  currency text,
  due_date date,
  unique (vendor, invoice_no)
);
create table if not exists p3_drafts (
  id serial primary key,
  mail_id text references p3_emails(mail_id),
  to_addr text,
  subject text,
  body text
);
