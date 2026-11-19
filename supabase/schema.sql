-- DEPRECATED PART 1 DRAFT. Do not execute this file.
-- Use the reviewed, repeatable migration in migrations/ instead.
-- This file is retained only as a historical schema draft.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE job_status AS ENUM (
  'new_request',
  'intake',
  'diagnosis',
  'quotation',
  'awaiting_customer_approval',
  'assigned',
  'in_progress',
  'waiting_for_parts',
  'qc_review',
  'completed',
  'handover',
  'closed'
);

CREATE TYPE approval_status AS ENUM (
  'pending',
  'approved',
  'declined',
  'expired'
);

CREATE TYPE repair_outcome AS ENUM (
  'working_as_expected',
  'same_symptom',
  'partly_improved',
  'different_issue',
  'no_response'
);

CREATE TYPE quote_status AS ENUM (
  'draft',
  'sent',
  'approved',
  'declined'
);

CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER_ADMIN','DISPATCHER','TECHNICIAN','QC_REVIEWER','CUSTOMER')),
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, email),
  UNIQUE (business_id, id)
);

CREATE INDEX idx_profiles_business_id ON profiles (business_id);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  preferred_contact TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, id)
);

CREATE INDEX idx_customers_business_id ON customers (business_id);

CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  serial_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, id)
);

CREATE INDEX idx_assets_business_id ON assets (business_id);
CREATE INDEX idx_assets_customer_id ON assets (customer_id);

CREATE TABLE service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  equipment_category TEXT NOT NULL,
  brand_model TEXT NOT NULL,
  reported_problem TEXT NOT NULL,
  urgency TEXT NOT NULL CHECK (urgency IN ('low','medium','high','urgent')),
  preferred_appointment TIMESTAMPTZ,
  request_reference TEXT NOT NULL UNIQUE,
  privacy_consent BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_by_customer BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, id)
);

CREATE INDEX idx_service_requests_business_id ON service_requests (business_id);

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_request_id UUID REFERENCES service_requests(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  status job_status NOT NULL DEFAULT 'new_request',
  issue_summary TEXT NOT NULL,
  diagnosis_notes TEXT,
  handed_over_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, id)
);

CREATE INDEX idx_jobs_business_id ON jobs (business_id);
CREATE INDEX idx_jobs_customer_id ON jobs (customer_id);
CREATE INDEX idx_jobs_asset_id ON jobs (asset_id);

CREATE TABLE diagnoses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  technician_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notes TEXT NOT NULL,
  root_cause TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_diagnoses_job_id ON diagnoses (job_id);

CREATE TABLE evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_type TEXT,
  caption TEXT,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('before','after','test','invoice','warranty','other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_evidence_job_id ON evidence (job_id);

CREATE TABLE quote_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  labour_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
  parts_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  status quote_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, version_number),
  UNIQUE (business_id, id)
);

CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  quote_version_id UUID NOT NULL REFERENCES quote_versions(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  quote_version_id UUID NOT NULL REFERENCES quote_versions(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status approval_status NOT NULL DEFAULT 'pending',
  approved_at TIMESTAMPTZ,
  comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'assigned'
);

CREATE TABLE repair_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  technician_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE parts_used (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  part_name TEXT NOT NULL,
  part_number TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE qc_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  passed BOOLEAN NOT NULL,
  checklist JSONB,
  comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  quote_version_id UUID REFERENCES quote_versions(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL UNIQUE,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE warranty_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  warranty_period_days INTEGER NOT NULL CHECK (warranty_period_days > 0),
  terms TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL,
  response_deadline TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('scheduled','sent','completed','overdue','unknown')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, id)
);

CREATE TABLE outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  follow_up_id UUID NOT NULL REFERENCES follow_ups(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  outcome repair_outcome NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE comeback_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  original_job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  issue_summary TEXT NOT NULL,
  linked_follow_up_id UUID REFERENCES follow_ups(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_logs_business_id ON activity_logs (business_id);

ALTER TABLE assets
  ADD CONSTRAINT assets_customer_same_business
  FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id);

ALTER TABLE jobs
  ADD CONSTRAINT jobs_request_same_business
    FOREIGN KEY (business_id, service_request_id) REFERENCES service_requests (business_id, id),
  ADD CONSTRAINT jobs_customer_same_business
    FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id),
  ADD CONSTRAINT jobs_asset_same_business
    FOREIGN KEY (business_id, asset_id) REFERENCES assets (business_id, id);

ALTER TABLE diagnoses
  ADD CONSTRAINT diagnoses_job_same_business
    FOREIGN KEY (business_id, job_id) REFERENCES jobs (business_id, id),
  ADD CONSTRAINT diagnoses_technician_same_business
    FOREIGN KEY (business_id, technician_id) REFERENCES profiles (business_id, id);

ALTER TABLE evidence
  ADD CONSTRAINT evidence_job_same_business
    FOREIGN KEY (business_id, job_id) REFERENCES jobs (business_id, id);

ALTER TABLE quote_versions
  ADD CONSTRAINT quote_versions_job_same_business
    FOREIGN KEY (business_id, job_id) REFERENCES jobs (business_id, id);

ALTER TABLE quotes
  ADD CONSTRAINT quotes_job_same_business
    FOREIGN KEY (business_id, job_id) REFERENCES jobs (business_id, id),
  ADD CONSTRAINT quotes_version_same_business
    FOREIGN KEY (business_id, quote_version_id) REFERENCES quote_versions (business_id, id),
  ADD CONSTRAINT quotes_customer_same_business
    FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id);

ALTER TABLE approvals
  ADD CONSTRAINT approvals_version_same_business
    FOREIGN KEY (business_id, quote_version_id) REFERENCES quote_versions (business_id, id),
  ADD CONSTRAINT approvals_customer_same_business
    FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id);

ALTER TABLE assignments
  ADD CONSTRAINT assignments_job_same_business
    FOREIGN KEY (business_id, job_id) REFERENCES jobs (business_id, id),
  ADD CONSTRAINT assignments_technician_same_business
    FOREIGN KEY (business_id, technician_id) REFERENCES profiles (business_id, id),
  ADD CONSTRAINT assignments_assigner_same_business
    FOREIGN KEY (business_id, assigned_by) REFERENCES profiles (business_id, id);

ALTER TABLE repair_logs
  ADD CONSTRAINT repair_logs_job_same_business
    FOREIGN KEY (business_id, job_id) REFERENCES jobs (business_id, id),
  ADD CONSTRAINT repair_logs_technician_same_business
    FOREIGN KEY (business_id, technician_id) REFERENCES profiles (business_id, id);

ALTER TABLE parts_used
  ADD CONSTRAINT parts_used_job_same_business
    FOREIGN KEY (business_id, job_id) REFERENCES jobs (business_id, id);

ALTER TABLE qc_records
  ADD CONSTRAINT qc_records_job_same_business
    FOREIGN KEY (business_id, job_id) REFERENCES jobs (business_id, id),
  ADD CONSTRAINT qc_records_reviewer_same_business
    FOREIGN KEY (business_id, reviewer_id) REFERENCES profiles (business_id, id);

ALTER TABLE invoices
  ADD CONSTRAINT invoices_job_same_business
    FOREIGN KEY (business_id, job_id) REFERENCES jobs (business_id, id),
  ADD CONSTRAINT invoices_quote_version_same_business
    FOREIGN KEY (business_id, quote_version_id) REFERENCES quote_versions (business_id, id);

ALTER TABLE warranty_terms
  ADD CONSTRAINT warranty_terms_job_same_business
    FOREIGN KEY (business_id, job_id) REFERENCES jobs (business_id, id);

ALTER TABLE follow_ups
  ADD CONSTRAINT follow_ups_job_same_business
    FOREIGN KEY (business_id, job_id) REFERENCES jobs (business_id, id);

ALTER TABLE outcomes
  ADD CONSTRAINT outcomes_follow_up_same_business
    FOREIGN KEY (business_id, follow_up_id) REFERENCES follow_ups (business_id, id),
  ADD CONSTRAINT outcomes_customer_same_business
    FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id);

ALTER TABLE comeback_cases
  ADD CONSTRAINT comeback_jobs_same_business
    FOREIGN KEY (business_id, original_job_id) REFERENCES jobs (business_id, id),
  ADD CONSTRAINT comeback_customer_same_business
    FOREIGN KEY (business_id, customer_id) REFERENCES customers (business_id, id),
  ADD CONSTRAINT comeback_follow_up_same_business
    FOREIGN KEY (business_id, linked_follow_up_id) REFERENCES follow_ups (business_id, id);

ALTER TABLE activity_logs
  ADD CONSTRAINT activity_actor_same_business
    FOREIGN KEY (business_id, actor_id) REFERENCES profiles (business_id, id);

CREATE INDEX idx_jobs_business_status_created
  ON jobs (business_id, status, created_at DESC);
CREATE INDEX idx_service_requests_business_created
  ON service_requests (business_id, created_at DESC);
CREATE INDEX idx_quote_versions_business_job
  ON quote_versions (business_id, job_id, version_number DESC);
CREATE INDEX idx_approvals_business_status
  ON approvals (business_id, status, created_at DESC);
CREATE INDEX idx_assignments_business_technician
  ON assignments (business_id, technician_id, status);
CREATE INDEX idx_follow_ups_business_status_due
  ON follow_ups (business_id, status, due_at);
CREATE INDEX idx_outcomes_business_outcome
  ON outcomes (business_id, outcome, created_at DESC);
CREATE INDEX idx_comeback_cases_business_status
  ON comeback_cases (business_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'businesses', 'profiles', 'customers', 'assets', 'service_requests', 'jobs',
    'diagnoses', 'quote_versions', 'quotes', 'approvals', 'qc_records', 'invoices',
    'warranty_terms', 'follow_ups', 'outcomes', 'comeback_cases'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      table_name
    );
  END LOOP;
END;
$$;

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagnoses ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts_used ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE comeback_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.current_business_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT business_id
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION private.current_business_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.current_business_id() TO authenticated;

CREATE OR REPLACE FUNCTION private.current_user_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION private.current_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.current_user_role() TO authenticated;

CREATE POLICY business_read_own ON businesses
  FOR SELECT TO authenticated
  USING (
    private.current_user_role() <> 'CUSTOMER'
    AND id = private.current_business_id()
  );

CREATE POLICY profile_read_business ON profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (
      private.current_user_role() <> 'CUSTOMER'
      AND business_id = private.current_business_id()
    )
  );

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'customers', 'assets', 'service_requests', 'jobs', 'diagnoses', 'evidence',
    'quote_versions', 'quotes', 'approvals', 'assignments', 'repair_logs',
    'parts_used', 'qc_records', 'invoices', 'warranty_terms', 'follow_ups',
    'outcomes', 'comeback_cases', 'activity_logs'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY tenant_read_only ON public.%I FOR SELECT TO authenticated USING (business_id = private.current_business_id() AND private.current_user_role() IN (''OWNER_ADMIN'', ''DISPATCHER'', ''TECHNICIAN'', ''QC_REVIEWER''))',
      table_name
    );
  END LOOP;
END;
$$;
