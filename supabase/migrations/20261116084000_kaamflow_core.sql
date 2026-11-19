-- KAAMFLOW core schema and least-privilege access baseline.
-- Reviewed and patched: 2026-11-16 (FK deletion-action pass). See docs/database-architecture.md.
-- Safe to re-run: all creates are conditional; policies/triggers are replaced.
-- Do NOT run against a production database with real customer data until tested on staging.
--
-- Evidence upload sequence (IMPORTANT – skipping step 1 causes a silent 403 on upload):
--   1. INSERT a row into public.evidence with the intended storage_path value.
--   2. Upload the file to the kaamflow-private-evidence Storage bucket at that exact path.
--   3. The storage INSERT policy validates that the metadata row already exists.
--
-- Circular FK (safe – all three columns are nullable; no INSERT deadlock possible):
--   service_requests.source_follow_up_id -> follow_ups
--   follow_ups.job_id                    -> jobs
--   jobs.service_request_id              -> service_requests
--
-- Auth user cascade warning:
--   profiles.id -> auth.users(id) ON DELETE CASCADE removes the profile when an auth user is deleted.
--   Always archive/soft-delete auth users in production instead of hard-deleting them.
--
-- Activity logs:
--   public.activity_logs has SELECT-only access for OWNER_ADMIN.
--   No direct client INSERT policy exists. The later workflow-hardening migration
--   adds SECURITY DEFINER audit triggers and RPC writes.
--
-- quote_versions UPDATE grant:
--   authenticated role has no GRANT UPDATE on quote_versions intentionally.
--   The respond_to_quote() SECURITY DEFINER function (runs as owner) updates status directly.
--   No direct client update of quote_versions is intended.
--
-- Composite FK / ON DELETE SET NULL (column) compatibility:
--   In composite foreign keys (business_id, col), business_id is NOT NULL for tenant isolation.
--   Standard bare "ON DELETE SET NULL" attempts to set ALL foreign key columns to NULL,
--   which causes a runtime error ("violates not-null constraint on business_id").
--   PostgreSQL 15+ supports column-specific syntax: ON DELETE SET NULL (col).
--   This safely clears ONLY the nullable referencing column while preserving business_id.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE TYPE public.job_status AS ENUM (
    'new_request', 'intake', 'diagnosis', 'quotation',
    'awaiting_customer_approval', 'assigned', 'in_progress',
    'waiting_for_parts', 'qc_review', 'completed', 'handover', 'closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE public.approval_status AS ENUM ('pending', 'approved', 'declined', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE public.repair_outcome AS ENUM (
    'working_as_expected', 'same_symptom', 'partly_improved',
    'different_issue', 'no_response'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE public.quote_status AS ENUM ('draft', 'sent', 'approved', 'declined');
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

-- Safety guard: abort if existing profiles are not linked to auth.users.
DO $$
DECLARE
  has_unlinked_profiles BOOLEAN;
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    EXECUTE '
      SELECT EXISTS (
        SELECT 1
        FROM public.profiles p
        LEFT JOIN auth.users u ON u.id = p.id
        WHERE u.id IS NULL
      )'
      INTO has_unlinked_profiles;

    IF has_unlinked_profiles THEN
      RAISE EXCEPTION
        'Existing profiles are not linked to auth.users. Back up and review those rows before applying the KAAMFLOW migration.';
    END IF;
  END IF;
END;
$$;

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.businesses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- profiles.customer_id is nullable – set by a trusted process when the auth user maps to a customer.
-- ON DELETE behavior for the composite FK to customers is SET NULL (see composite FKs section below).
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id UUID,                    -- nullable; linked after customer row exists
  email       TEXT NOT NULL,
  full_name   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN (
    'OWNER_ADMIN', 'DISPATCHER', 'TECHNICIAN', 'QC_REVIEWER', 'CUSTOMER'
  )),
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, email),
  UNIQUE (business_id, id)
);

CREATE TABLE IF NOT EXISTS public.customers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  full_name        TEXT NOT NULL,
  phone            TEXT,
  email            TEXT,
  preferred_contact TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, id)
);

-- assets.customer_id: NOT NULL because an asset always belongs to a customer.
-- ON DELETE CASCADE: when a customer is deleted, their assets are deleted too.
CREATE TABLE IF NOT EXISTS public.assets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,
  brand       TEXT,
  model       TEXT,
  serial_number TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, id)
);

-- service_requests: customer_id/asset_id/source_follow_up_id are all nullable.
-- Deletion of referenced rows sets these columns to NULL (see composite FK section).
CREATE TABLE IF NOT EXISTS public.service_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id        UUID,
  asset_id           UUID,
  source_follow_up_id UUID,
  customer_name      TEXT NOT NULL,
  phone              TEXT NOT NULL,
  equipment_category TEXT NOT NULL,
  brand_model        TEXT NOT NULL,
  reported_problem   TEXT NOT NULL,
  urgency            TEXT NOT NULL CHECK (urgency IN ('low', 'medium', 'high', 'urgent')),
  preferred_appointment TIMESTAMPTZ,
  request_reference  TEXT NOT NULL UNIQUE,
  privacy_consent    BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_by_customer BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, id)
);

-- jobs: service_request_id, customer_id, asset_id are all nullable and use SET NULL.
-- Simple FKs carry ON DELETE SET NULL; composite FKs are added below WITH the same action.
CREATE TABLE IF NOT EXISTS public.jobs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  service_request_id UUID REFERENCES public.service_requests(id) ON DELETE SET NULL,
  customer_id        UUID REFERENCES public.customers(id)         ON DELETE SET NULL,
  asset_id           UUID REFERENCES public.assets(id)            ON DELETE SET NULL,
  status             public.job_status NOT NULL DEFAULT 'new_request',
  issue_summary      TEXT NOT NULL,
  diagnosis_notes    TEXT,
  handed_over_at     TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, id)
);

-- diagnoses.technician_id is nullable; SET NULL when technician profile is removed.
CREATE TABLE IF NOT EXISTS public.diagnoses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_id        UUID NOT NULL REFERENCES public.jobs(id)        ON DELETE CASCADE,
  technician_id UUID          REFERENCES public.profiles(id)    ON DELETE SET NULL,
  notes         TEXT NOT NULL,
  root_cause    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.evidence (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_id        UUID NOT NULL REFERENCES public.jobs(id)        ON DELETE CASCADE,
  storage_path  TEXT,
  file_type     TEXT,
  caption       TEXT,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN (
    'before', 'after', 'test', 'invoice', 'warranty', 'other'
  )),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.quote_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_id         UUID NOT NULL REFERENCES public.jobs(id)        ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  labour_charge  NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (labour_charge  >= 0),
  parts_cost     NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (parts_cost     >= 0),
  tax_amount     NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (tax_amount     >= 0),
  total_amount   NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_amount   >= 0),
  notes          TEXT,
  status         public.quote_status NOT NULL DEFAULT 'draft',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, version_number),
  UNIQUE (business_id, id)
);

-- quotes.customer_id nullable: SET NULL when customer is deleted.
CREATE TABLE IF NOT EXISTS public.quotes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID NOT NULL REFERENCES public.businesses(id)    ON DELETE CASCADE,
  job_id           UUID NOT NULL REFERENCES public.jobs(id)           ON DELETE CASCADE,
  quote_version_id UUID NOT NULL REFERENCES public.quote_versions(id) ON DELETE CASCADE,
  customer_id      UUID          REFERENCES public.customers(id)      ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.approvals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID NOT NULL REFERENCES public.businesses(id)    ON DELETE CASCADE,
  quote_version_id UUID NOT NULL REFERENCES public.quote_versions(id) ON DELETE CASCADE,
  customer_id      UUID NOT NULL REFERENCES public.customers(id)      ON DELETE CASCADE,
  status           public.approval_status NOT NULL DEFAULT 'pending',
  approved_at      TIMESTAMPTZ,
  comments         TEXT CHECK (comments IS NULL OR length(comments) <= 2000),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- assignments.assigned_by nullable: SET NULL when assigning profile is removed.
CREATE TABLE IF NOT EXISTS public.assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_id        UUID NOT NULL REFERENCES public.jobs(id)        ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES public.profiles(id)   ON DELETE CASCADE,
  assigned_by   UUID          REFERENCES public.profiles(id)   ON DELETE SET NULL,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        TEXT NOT NULL DEFAULT 'assigned'
                CHECK (status IN ('assigned', 'in_progress', 'completed', 'cancelled'))
);

-- repair_logs.technician_id nullable: SET NULL when technician profile is removed.
CREATE TABLE IF NOT EXISTS public.repair_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_id        UUID NOT NULL REFERENCES public.jobs(id)        ON DELETE CASCADE,
  technician_id UUID          REFERENCES public.profiles(id)   ON DELETE SET NULL,
  action        TEXT NOT NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.parts_used (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_id      UUID NOT NULL REFERENCES public.jobs(id)        ON DELETE CASCADE,
  part_name   TEXT NOT NULL,
  part_number TEXT,
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost   NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- qc_records.reviewer_id nullable: SET NULL when reviewer profile is removed.
CREATE TABLE IF NOT EXISTS public.qc_records (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_id      UUID NOT NULL REFERENCES public.jobs(id)        ON DELETE CASCADE,
  reviewer_id UUID          REFERENCES public.profiles(id)   ON DELETE SET NULL,
  passed      BOOLEAN NOT NULL,
  checklist   JSONB,
  comments    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- invoices.quote_version_id nullable: SET NULL when quote_version is deleted.
-- The composite FK below also carries ON DELETE SET NULL for consistency.
CREATE TABLE IF NOT EXISTS public.invoices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID NOT NULL REFERENCES public.businesses(id)    ON DELETE CASCADE,
  job_id           UUID NOT NULL REFERENCES public.jobs(id)           ON DELETE CASCADE,
  quote_version_id UUID          REFERENCES public.quote_versions(id) ON DELETE SET NULL,
  invoice_number   TEXT NOT NULL UNIQUE,
  total_amount     NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  payment_status   TEXT NOT NULL DEFAULT 'pending'
                   CHECK (payment_status IN ('pending', 'paid', 'partially_paid', 'waived')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, id)
);

CREATE TABLE IF NOT EXISTS public.warranty_terms (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_id               UUID NOT NULL REFERENCES public.jobs(id)        ON DELETE CASCADE,
  warranty_period_days INTEGER NOT NULL CHECK (warranty_period_days > 0),
  terms                TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.follow_ups (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_id            UUID NOT NULL REFERENCES public.jobs(id)        ON DELETE CASCADE,
  due_at            TIMESTAMPTZ NOT NULL,
  response_deadline TIMESTAMPTZ,
  status            TEXT NOT NULL CHECK (status IN ('scheduled', 'sent', 'completed', 'overdue', 'unknown')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, id)
);

CREATE TABLE IF NOT EXISTS public.outcomes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES public.businesses(id)  ON DELETE CASCADE,
  follow_up_id UUID NOT NULL REFERENCES public.follow_ups(id)  ON DELETE CASCADE,
  customer_id  UUID NOT NULL REFERENCES public.customers(id)   ON DELETE CASCADE,
  outcome      public.repair_outcome NOT NULL,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- comeback_cases.linked_follow_up_id nullable: SET NULL when follow_up is deleted.
CREATE TABLE IF NOT EXISTS public.comeback_cases (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  original_job_id   UUID NOT NULL REFERENCES public.jobs(id)        ON DELETE CASCADE,
  customer_id       UUID NOT NULL REFERENCES public.customers(id)   ON DELETE CASCADE,
  issue_summary     TEXT NOT NULL,
  linked_follow_up_id UUID        REFERENCES public.follow_ups(id)  ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'needs_review'
                    CHECK (status IN ('needs_review', 'open', 'in_progress', 'resolved', 'closed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- activity_logs.actor_id nullable: SET NULL when acting profile is removed.
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  actor_id    UUID          REFERENCES public.profiles(id)   ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  action      TEXT NOT NULL,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- COLUMN ADDITIONS (idempotent for existing installations)
-- ============================================================

ALTER TABLE public.profiles         ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.profiles         ADD COLUMN IF NOT EXISTS customer_id UUID;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS customer_id UUID;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS asset_id UUID;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS source_follow_up_id UUID;
ALTER TABLE public.evidence         ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE public.jobs             ADD COLUMN IF NOT EXISTS handed_over_at TIMESTAMPTZ;

-- ============================================================
-- COMPOSITE FOREIGN KEYS
-- ============================================================
-- Composite (business_id, col) FKs enforce tenant isolation: a child row cannot
-- reference a parent row that belongs to a different business even if the PK matches.
--
-- CRITICAL RULE: every composite FK whose non-business_id column is nullable and
-- uses ON DELETE SET NULL on the simple FK *must* also carry ON DELETE SET NULL
-- on its composite counterpart.  Without this, PostgreSQL's default RESTRICT action
-- on the composite key blocks the delete entirely, overriding the SET NULL on the
-- simple key.  business_id is NOT NULL on every table so only the nullable column
-- gets set to NULL; business_id is left untouched.
-- ============================================================

DO $$
BEGIN

  -- profiles -> auth.users (simple FK; added only if the table was pre-existing)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND confrelid = 'auth.users'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_auth_user_fkey
      FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- profiles -> customers
  -- ON DELETE SET NULL: deleting a customer nullifies the portal link in profiles
  -- but does not delete the profile itself.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_customer_same_business'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_customer_same_business
      FOREIGN KEY (business_id, customer_id)
      REFERENCES public.customers (business_id, id)
      ON DELETE SET NULL (customer_id);
  END IF;

  -- service_requests -> customers
  -- ON DELETE SET NULL: deleting a customer preserves the intake record.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.service_requests'::regclass
      AND conname = 'service_requests_customer_same_business'
  ) THEN
    ALTER TABLE public.service_requests
      ADD CONSTRAINT service_requests_customer_same_business
      FOREIGN KEY (business_id, customer_id)
      REFERENCES public.customers (business_id, id)
      ON DELETE SET NULL (customer_id);
  END IF;

  -- service_requests -> assets
  -- ON DELETE SET NULL: deleting an asset preserves the intake record.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.service_requests'::regclass
      AND conname = 'service_requests_asset_same_business'
  ) THEN
    ALTER TABLE public.service_requests
      ADD CONSTRAINT service_requests_asset_same_business
      FOREIGN KEY (business_id, asset_id)
      REFERENCES public.assets (business_id, id)
      ON DELETE SET NULL (asset_id);
  END IF;

  -- service_requests -> follow_ups (source of a different-issue follow-up request)
  -- ON DELETE SET NULL: deleting a follow_up does not remove the resulting request.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.service_requests'::regclass
      AND conname = 'service_requests_follow_up_same_business'
  ) THEN
    ALTER TABLE public.service_requests
      ADD CONSTRAINT service_requests_follow_up_same_business
      FOREIGN KEY (business_id, source_follow_up_id)
      REFERENCES public.follow_ups (business_id, id)
      ON DELETE SET NULL (source_follow_up_id);
  END IF;

  -- assets -> customers (non-composite; customer_id NOT NULL so CASCADE is correct)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.assets'::regclass
      AND conname = 'assets_customer_same_business'
  ) THEN
    ALTER TABLE public.assets
      ADD CONSTRAINT assets_customer_same_business
      FOREIGN KEY (business_id, customer_id)
      REFERENCES public.customers (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- jobs -> service_requests
  -- ON DELETE SET NULL: deleting a service_request preserves the job history.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.jobs'::regclass
      AND conname = 'jobs_request_same_business'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_request_same_business
      FOREIGN KEY (business_id, service_request_id)
      REFERENCES public.service_requests (business_id, id)
      ON DELETE SET NULL (service_request_id);
  END IF;

  -- jobs -> customers
  -- ON DELETE SET NULL: deleting a customer preserves the job history.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.jobs'::regclass
      AND conname = 'jobs_customer_same_business'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_customer_same_business
      FOREIGN KEY (business_id, customer_id)
      REFERENCES public.customers (business_id, id)
      ON DELETE SET NULL (customer_id);
  END IF;

  -- jobs -> assets
  -- ON DELETE SET NULL: deleting an asset preserves the job history.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.jobs'::regclass
      AND conname = 'jobs_asset_same_business'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_asset_same_business
      FOREIGN KEY (business_id, asset_id)
      REFERENCES public.assets (business_id, id)
      ON DELETE SET NULL (asset_id);
  END IF;

  -- diagnoses -> jobs (cascade: diagnosis is owned by job)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.diagnoses'::regclass
      AND conname = 'diagnoses_job_same_business'
  ) THEN
    ALTER TABLE public.diagnoses
      ADD CONSTRAINT diagnoses_job_same_business
      FOREIGN KEY (business_id, job_id)
      REFERENCES public.jobs (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- diagnoses -> profiles (technician)
  -- ON DELETE SET NULL: deleting a technician profile preserves the diagnosis record.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.diagnoses'::regclass
      AND conname = 'diagnoses_technician_same_business'
  ) THEN
    ALTER TABLE public.diagnoses
      ADD CONSTRAINT diagnoses_technician_same_business
      FOREIGN KEY (business_id, technician_id)
      REFERENCES public.profiles (business_id, id)
      ON DELETE SET NULL (technician_id);
  END IF;

  -- evidence -> jobs (cascade: evidence is owned by job)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.evidence'::regclass
      AND conname = 'evidence_job_same_business'
  ) THEN
    ALTER TABLE public.evidence
      ADD CONSTRAINT evidence_job_same_business
      FOREIGN KEY (business_id, job_id)
      REFERENCES public.jobs (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- quote_versions -> jobs (cascade: quote versions are owned by job)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.quote_versions'::regclass
      AND conname = 'quote_versions_job_same_business'
  ) THEN
    ALTER TABLE public.quote_versions
      ADD CONSTRAINT quote_versions_job_same_business
      FOREIGN KEY (business_id, job_id)
      REFERENCES public.jobs (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- quotes -> jobs (cascade: delivery record owned by job)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.quotes'::regclass
      AND conname = 'quotes_job_same_business'
  ) THEN
    ALTER TABLE public.quotes
      ADD CONSTRAINT quotes_job_same_business
      FOREIGN KEY (business_id, job_id)
      REFERENCES public.jobs (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- quotes -> quote_versions (cascade: delivery record is owned by version)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.quotes'::regclass
      AND conname = 'quotes_version_same_business'
  ) THEN
    ALTER TABLE public.quotes
      ADD CONSTRAINT quotes_version_same_business
      FOREIGN KEY (business_id, quote_version_id)
      REFERENCES public.quote_versions (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- quotes -> customers
  -- ON DELETE SET NULL: deleting a customer preserves the delivery record.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.quotes'::regclass
      AND conname = 'quotes_customer_same_business'
  ) THEN
    ALTER TABLE public.quotes
      ADD CONSTRAINT quotes_customer_same_business
      FOREIGN KEY (business_id, customer_id)
      REFERENCES public.customers (business_id, id)
      ON DELETE SET NULL (customer_id);
  END IF;

  -- approvals -> quote_versions (cascade: approval is owned by version)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.approvals'::regclass
      AND conname = 'approvals_version_same_business'
  ) THEN
    ALTER TABLE public.approvals
      ADD CONSTRAINT approvals_version_same_business
      FOREIGN KEY (business_id, quote_version_id)
      REFERENCES public.quote_versions (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- approvals -> customers (cascade: legal record tied to customer identity)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.approvals'::regclass
      AND conname = 'approvals_customer_same_business'
  ) THEN
    ALTER TABLE public.approvals
      ADD CONSTRAINT approvals_customer_same_business
      FOREIGN KEY (business_id, customer_id)
      REFERENCES public.customers (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- assignments -> jobs (cascade: assignment is owned by job)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.assignments'::regclass
      AND conname = 'assignments_job_same_business'
  ) THEN
    ALTER TABLE public.assignments
      ADD CONSTRAINT assignments_job_same_business
      FOREIGN KEY (business_id, job_id)
      REFERENCES public.jobs (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- assignments -> profiles (technician, NOT NULL, CASCADE)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.assignments'::regclass
      AND conname = 'assignments_technician_same_business'
  ) THEN
    ALTER TABLE public.assignments
      ADD CONSTRAINT assignments_technician_same_business
      FOREIGN KEY (business_id, technician_id)
      REFERENCES public.profiles (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- assignments -> profiles (assigned_by, nullable)
  -- ON DELETE SET NULL: deleting an assigning profile preserves the assignment record.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.assignments'::regclass
      AND conname = 'assignments_assigner_same_business'
  ) THEN
    ALTER TABLE public.assignments
      ADD CONSTRAINT assignments_assigner_same_business
      FOREIGN KEY (business_id, assigned_by)
      REFERENCES public.profiles (business_id, id)
      ON DELETE SET NULL (assigned_by);
  END IF;

  -- repair_logs -> jobs (cascade)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.repair_logs'::regclass
      AND conname = 'repair_logs_job_same_business'
  ) THEN
    ALTER TABLE public.repair_logs
      ADD CONSTRAINT repair_logs_job_same_business
      FOREIGN KEY (business_id, job_id)
      REFERENCES public.jobs (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- repair_logs -> profiles (technician, nullable)
  -- ON DELETE SET NULL: deleting a technician profile preserves the work log.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.repair_logs'::regclass
      AND conname = 'repair_logs_technician_same_business'
  ) THEN
    ALTER TABLE public.repair_logs
      ADD CONSTRAINT repair_logs_technician_same_business
      FOREIGN KEY (business_id, technician_id)
      REFERENCES public.profiles (business_id, id)
      ON DELETE SET NULL (technician_id);
  END IF;

  -- parts_used -> jobs (cascade)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.parts_used'::regclass
      AND conname = 'parts_used_job_same_business'
  ) THEN
    ALTER TABLE public.parts_used
      ADD CONSTRAINT parts_used_job_same_business
      FOREIGN KEY (business_id, job_id)
      REFERENCES public.jobs (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- qc_records -> jobs (cascade)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.qc_records'::regclass
      AND conname = 'qc_records_job_same_business'
  ) THEN
    ALTER TABLE public.qc_records
      ADD CONSTRAINT qc_records_job_same_business
      FOREIGN KEY (business_id, job_id)
      REFERENCES public.jobs (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- qc_records -> profiles (reviewer, nullable)
  -- ON DELETE SET NULL: deleting a reviewer profile preserves the QC record.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.qc_records'::regclass
      AND conname = 'qc_records_reviewer_same_business'
  ) THEN
    ALTER TABLE public.qc_records
      ADD CONSTRAINT qc_records_reviewer_same_business
      FOREIGN KEY (business_id, reviewer_id)
      REFERENCES public.profiles (business_id, id)
      ON DELETE SET NULL (reviewer_id);
  END IF;

  -- invoices -> jobs (cascade)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_job_same_business'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_job_same_business
      FOREIGN KEY (business_id, job_id)
      REFERENCES public.jobs (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- invoices -> quote_versions (nullable)
  -- ON DELETE SET NULL: deleting a quote_version preserves the invoice record.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_quote_version_same_business'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_quote_version_same_business
      FOREIGN KEY (business_id, quote_version_id)
      REFERENCES public.quote_versions (business_id, id)
      ON DELETE SET NULL (quote_version_id);
  END IF;

  -- warranty_terms -> jobs (cascade)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.warranty_terms'::regclass
      AND conname = 'warranty_terms_job_same_business'
  ) THEN
    ALTER TABLE public.warranty_terms
      ADD CONSTRAINT warranty_terms_job_same_business
      FOREIGN KEY (business_id, job_id)
      REFERENCES public.jobs (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- follow_ups -> jobs (cascade)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.follow_ups'::regclass
      AND conname = 'follow_ups_job_same_business'
  ) THEN
    ALTER TABLE public.follow_ups
      ADD CONSTRAINT follow_ups_job_same_business
      FOREIGN KEY (business_id, job_id)
      REFERENCES public.jobs (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- outcomes -> follow_ups (cascade: outcome is owned by follow_up)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.outcomes'::regclass
      AND conname = 'outcomes_follow_up_same_business'
  ) THEN
    ALTER TABLE public.outcomes
      ADD CONSTRAINT outcomes_follow_up_same_business
      FOREIGN KEY (business_id, follow_up_id)
      REFERENCES public.follow_ups (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- outcomes -> customers (cascade: outcome is a legal customer record)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.outcomes'::regclass
      AND conname = 'outcomes_customer_same_business'
  ) THEN
    ALTER TABLE public.outcomes
      ADD CONSTRAINT outcomes_customer_same_business
      FOREIGN KEY (business_id, customer_id)
      REFERENCES public.customers (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- comeback_cases -> jobs (cascade)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.comeback_cases'::regclass
      AND conname = 'comeback_jobs_same_business'
  ) THEN
    ALTER TABLE public.comeback_cases
      ADD CONSTRAINT comeback_jobs_same_business
      FOREIGN KEY (business_id, original_job_id)
      REFERENCES public.jobs (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- comeback_cases -> customers (cascade)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.comeback_cases'::regclass
      AND conname = 'comeback_customer_same_business'
  ) THEN
    ALTER TABLE public.comeback_cases
      ADD CONSTRAINT comeback_customer_same_business
      FOREIGN KEY (business_id, customer_id)
      REFERENCES public.customers (business_id, id)
      ON DELETE CASCADE;
  END IF;

  -- comeback_cases -> follow_ups (nullable)
  -- ON DELETE SET NULL: deleting a follow_up preserves the comeback record.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.comeback_cases'::regclass
      AND conname = 'comeback_follow_up_same_business'
  ) THEN
    ALTER TABLE public.comeback_cases
      ADD CONSTRAINT comeback_follow_up_same_business
      FOREIGN KEY (business_id, linked_follow_up_id)
      REFERENCES public.follow_ups (business_id, id)
      ON DELETE SET NULL (linked_follow_up_id);
  END IF;

  -- activity_logs -> profiles (actor, nullable)
  -- ON DELETE SET NULL: deleting an actor profile preserves the audit record.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.activity_logs'::regclass
      AND conname = 'activity_actor_same_business'
  ) THEN
    ALTER TABLE public.activity_logs
      ADD CONSTRAINT activity_actor_same_business
      FOREIGN KEY (business_id, actor_id)
      REFERENCES public.profiles (business_id, id)
      ON DELETE SET NULL (actor_id);
  END IF;

END;
$$;

-- Handle pre-existing evidence table that may have a file_url column.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'evidence' AND column_name = 'file_url'
  ) THEN
    ALTER TABLE public.evidence ALTER COLUMN file_url DROP NOT NULL;
  END IF;
END;
$$;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_business_customer
  ON public.profiles (business_id, customer_id)
  WHERE customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_storage_path
  ON public.evidence (storage_path)
  WHERE storage_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_business_id
  ON public.profiles (business_id);
CREATE INDEX IF NOT EXISTS idx_customers_business_id
  ON public.customers (business_id);
CREATE INDEX IF NOT EXISTS idx_assets_business_customer
  ON public.assets (business_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_requests_business_created
  ON public.service_requests (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_business_customer
  ON public.service_requests (business_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_requests_business_asset
  ON public.service_requests (business_id, asset_id);
CREATE INDEX IF NOT EXISTS idx_requests_business_follow_up
  ON public.service_requests (business_id, source_follow_up_id);
CREATE INDEX IF NOT EXISTS idx_jobs_business_status_created
  ON public.jobs (business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_business_request
  ON public.jobs (business_id, service_request_id);
CREATE INDEX IF NOT EXISTS idx_jobs_business_customer
  ON public.jobs (business_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_business_asset
  ON public.jobs (business_id, asset_id);
CREATE INDEX IF NOT EXISTS idx_diagnoses_business_job
  ON public.diagnoses (business_id, job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_business_job
  ON public.evidence (business_id, job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quote_versions_business_job
  ON public.quote_versions (business_id, job_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_business_job
  ON public.quotes (business_id, job_id);
CREATE INDEX IF NOT EXISTS idx_approvals_business_status
  ON public.approvals (business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignments_business_technician
  ON public.assignments (business_id, technician_id, status);
CREATE INDEX IF NOT EXISTS idx_assignments_business_job
  ON public.assignments (business_id, job_id, technician_id, status);
CREATE INDEX IF NOT EXISTS idx_repair_logs_business_job
  ON public.repair_logs (business_id, job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parts_used_business_job
  ON public.parts_used (business_id, job_id);
CREATE INDEX IF NOT EXISTS idx_qc_records_business_job
  ON public.qc_records (business_id, job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_business_job
  ON public.invoices (business_id, job_id);
CREATE INDEX IF NOT EXISTS idx_warranty_terms_business_job
  ON public.warranty_terms (business_id, job_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_business_status_due
  ON public.follow_ups (business_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_outcomes_business_outcome
  ON public.outcomes (business_id, outcome, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcomes_business_customer
  ON public.outcomes (business_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_comeback_cases_business_status
  ON public.comeback_cases (business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comeback_cases_business_job
  ON public.comeback_cases (business_id, original_job_id);
CREATE INDEX IF NOT EXISTS idx_comeback_cases_business_customer
  ON public.comeback_cases (business_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_business_created
  ON public.activity_logs (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_business_actor
  ON public.activity_logs (business_id, actor_id);

-- ============================================================
-- DATA SAFETY GUARDS (abort if unsafe data exists)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.approvals
    GROUP BY business_id, quote_version_id, customer_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate quote approvals exist. Review them before enforcing one approval per quote version and customer.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.outcomes
    GROUP BY business_id, follow_up_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate follow-up outcomes exist. Review them before enforcing one outcome per follow-up.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_version_customer
  ON public.approvals (business_id, quote_version_id, customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outcomes_one_per_follow_up
  ON public.outcomes (business_id, follow_up_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.assignments'::regclass AND conname = 'assignments_status_check') THEN
    IF EXISTS (SELECT 1 FROM public.assignments WHERE status NOT IN ('assigned', 'in_progress', 'completed', 'cancelled')) THEN
      RAISE EXCEPTION 'Assignments contain an unsupported status; review those rows before applying the status constraint.';
    END IF;
    ALTER TABLE public.assignments ADD CONSTRAINT assignments_status_check
      CHECK (status IN ('assigned', 'in_progress', 'completed', 'cancelled'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.parts_used'::regclass AND conname = 'parts_used_unit_cost_check') THEN
    IF EXISTS (SELECT 1 FROM public.parts_used WHERE unit_cost < 0) THEN
      RAISE EXCEPTION 'Parts contain a negative unit cost; review those rows before applying the cost constraint.';
    END IF;
    ALTER TABLE public.parts_used ADD CONSTRAINT parts_used_unit_cost_check CHECK (unit_cost >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_versions'::regclass AND conname = 'quote_versions_labour_charge_check') THEN
    IF EXISTS (SELECT 1 FROM public.quote_versions WHERE labour_charge < 0) THEN
      RAISE EXCEPTION 'Quotation versions contain a negative labour charge; review them before applying amount constraints.';
    END IF;
    ALTER TABLE public.quote_versions ADD CONSTRAINT quote_versions_labour_charge_check CHECK (labour_charge >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_versions'::regclass AND conname = 'quote_versions_parts_cost_check') THEN
    IF EXISTS (SELECT 1 FROM public.quote_versions WHERE parts_cost < 0) THEN
      RAISE EXCEPTION 'Quotation versions contain a negative parts cost; review them before applying amount constraints.';
    END IF;
    ALTER TABLE public.quote_versions ADD CONSTRAINT quote_versions_parts_cost_check CHECK (parts_cost >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_versions'::regclass AND conname = 'quote_versions_tax_amount_check') THEN
    IF EXISTS (SELECT 1 FROM public.quote_versions WHERE tax_amount < 0) THEN
      RAISE EXCEPTION 'Quotation versions contain a negative tax amount; review them before applying amount constraints.';
    END IF;
    ALTER TABLE public.quote_versions ADD CONSTRAINT quote_versions_tax_amount_check CHECK (tax_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.quote_versions'::regclass AND conname = 'quote_versions_total_amount_check') THEN
    IF EXISTS (SELECT 1 FROM public.quote_versions WHERE total_amount < 0) THEN
      RAISE EXCEPTION 'Quotation versions contain a negative total; review them before applying amount constraints.';
    END IF;
    ALTER TABLE public.quote_versions ADD CONSTRAINT quote_versions_total_amount_check CHECK (total_amount >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.approvals'::regclass AND conname = 'approvals_comments_check') THEN
    IF EXISTS (SELECT 1 FROM public.approvals WHERE comments IS NOT NULL AND length(comments) > 2000) THEN
      RAISE EXCEPTION 'Approval comments exceed 2000 characters; review them before applying the comments constraint.';
    END IF;
    ALTER TABLE public.approvals ADD CONSTRAINT approvals_comments_check
      CHECK (comments IS NULL OR length(comments) <= 2000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.invoices'::regclass AND conname = 'invoices_total_amount_check') THEN
    IF EXISTS (SELECT 1 FROM public.invoices WHERE total_amount < 0) THEN
      RAISE EXCEPTION 'Invoices contain a negative total; review them before applying the amount constraint.';
    END IF;
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_total_amount_check CHECK (total_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.invoices'::regclass AND conname = 'invoices_payment_status_check') THEN
    IF EXISTS (SELECT 1 FROM public.invoices WHERE payment_status NOT IN ('pending', 'paid', 'partially_paid', 'waived')) THEN
      RAISE EXCEPTION 'Invoices contain an unsupported payment status; review them before applying the status constraint.';
    END IF;
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_payment_status_check
      CHECK (payment_status IN ('pending', 'paid', 'partially_paid', 'waived'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.comeback_cases'::regclass AND conname = 'comeback_cases_status_check') THEN
    IF EXISTS (SELECT 1 FROM public.comeback_cases WHERE status NOT IN ('needs_review', 'open', 'in_progress', 'resolved', 'closed')) THEN
      RAISE EXCEPTION 'Comeback cases contain an unsupported status; review them before applying the status constraint.';
    END IF;
    ALTER TABLE public.comeback_cases ADD CONSTRAINT comeback_cases_status_check
      CHECK (status IN ('needs_review', 'open', 'in_progress', 'resolved', 'closed'));
  END IF;
END;
$$;

-- ============================================================
-- TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'businesses', 'profiles', 'customers', 'assets', 'service_requests', 'jobs',
    'diagnoses', 'quote_versions', 'quotes', 'approvals', 'qc_records', 'invoices',
    'warranty_terms', 'follow_ups', 'outcomes', 'comeback_cases'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      t
    );
  END LOOP;
END;
$$;

-- ============================================================
-- PRIVATE SCHEMA + HELPER FUNCTIONS
-- ============================================================

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

-- Returns the business_id of the currently signed-in user.
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

-- Returns TRUE if the current user holds any of the given roles.
CREATE OR REPLACE FUNCTION private.has_role(allowed_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = ANY (allowed_roles)
  )
$$;

-- Returns TRUE if the current technician has an active assignment on target_job_id.
CREATE OR REPLACE FUNCTION private.is_assigned_technician_job(target_job_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.assignments a
    WHERE a.business_id = private.current_business_id()
      AND a.job_id = target_job_id
      AND a.technician_id = auth.uid()
      AND a.status IN ('assigned', 'in_progress')
  )
$$;

-- Returns TRUE if the current user may read target_job_id.
-- OWNER_ADMIN / DISPATCHER / QC_REVIEWER see all jobs in their business.
-- TECHNICIAN sees only jobs they are actively assigned to.
CREATE OR REPLACE FUNCTION private.can_access_job(target_job_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.jobs j
    WHERE j.id = target_job_id
      AND j.business_id = private.current_business_id()
      AND (
        private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER', 'QC_REVIEWER'])
        OR (
          private.has_role(ARRAY['TECHNICIAN'])
          AND private.is_assigned_technician_job(j.id)
        )
      )
  )
$$;

-- Returns TRUE if the current technician may read target_customer_id
-- (via an active job assignment).
CREATE OR REPLACE FUNCTION private.can_access_customer(target_customer_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.jobs j
    WHERE j.business_id = private.current_business_id()
      AND j.customer_id = target_customer_id
      AND private.is_assigned_technician_job(j.id)
  )
$$;

-- Returns TRUE if the current technician may read target_asset_id.
CREATE OR REPLACE FUNCTION private.can_access_asset(target_asset_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.jobs j
    WHERE j.business_id = private.current_business_id()
      AND j.asset_id = target_asset_id
      AND private.is_assigned_technician_job(j.id)
  )
$$;

-- Returns TRUE if the current technician may read target_request_id.
CREATE OR REPLACE FUNCTION private.can_access_request(target_request_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.jobs j
    WHERE j.business_id = private.current_business_id()
      AND j.service_request_id = target_request_id
      AND private.is_assigned_technician_job(j.id)
  )
$$;

-- Extracts a UUID from a Storage object path segment (1 = business_id, 2 = job_id).
CREATE OR REPLACE FUNCTION private.storage_path_uuid(object_name TEXT, segment_number INTEGER)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  segment TEXT;
BEGIN
  IF segment_number < 1 OR segment_number > 2 THEN
    RETURN NULL;
  END IF;

  segment := split_part(object_name, '/', segment_number);
  IF segment ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN segment::UUID;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.current_business_id()                      FROM PUBLIC;
REVOKE ALL ON FUNCTION private.has_role(TEXT[])                           FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_assigned_technician_job(UUID)           FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_access_job(UUID)                       FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_access_customer(UUID)                  FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_access_asset(UUID)                     FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_access_request(UUID)                   FROM PUBLIC;
REVOKE ALL ON FUNCTION private.storage_path_uuid(TEXT, INTEGER)           FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.current_business_id()                   TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(TEXT[])                        TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_assigned_technician_job(UUID)        TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_job(UUID)                    TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_customer(UUID)               TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_asset(UUID)                  TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_request(UUID)                TO authenticated;
GRANT EXECUTE ON FUNCTION private.storage_path_uuid(TEXT, INTEGER)        TO authenticated;

-- ============================================================
-- PUBLIC CUSTOMER-FACING FUNCTIONS (SECURITY DEFINER)
-- ============================================================

-- Returns a minimal repair summary for the signed-in CUSTOMER.
CREATE OR REPLACE FUNCTION public.get_my_repair_summary()
RETURNS TABLE (
  job_id            UUID,
  status            TEXT,
  equipment_category TEXT,
  brand             TEXT,
  model             TEXT,
  handed_over_at    TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    j.id,
    j.status::TEXT,
    a.category,
    a.brand,
    a.model,
    j.handed_over_at
  FROM public.profiles p
  JOIN public.jobs j
    ON j.business_id = p.business_id
   AND j.customer_id = p.customer_id
  LEFT JOIN public.assets a
    ON a.business_id = j.business_id
   AND a.id = j.asset_id
  WHERE p.id = auth.uid()
    AND p.role = 'CUSTOMER'
    AND p.customer_id IS NOT NULL
$$;

-- Returns sent/approved/declined quote versions for the signed-in CUSTOMER.
CREATE OR REPLACE FUNCTION public.get_my_quote_versions()
RETURNS TABLE (
  quote_version_id UUID,
  job_id           UUID,
  version_number   INTEGER,
  labour_charge    NUMERIC,
  parts_cost       NUMERIC,
  tax_amount       NUMERIC,
  total_amount     NUMERIC
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    qv.id,
    qv.job_id,
    qv.version_number,
    qv.labour_charge,
    qv.parts_cost,
    qv.tax_amount,
    qv.total_amount
  FROM public.profiles p
  JOIN public.quotes q
    ON q.business_id = p.business_id
   AND q.customer_id = p.customer_id
  JOIN public.quote_versions qv
    ON qv.business_id = q.business_id
   AND qv.id = q.quote_version_id
   AND qv.job_id = q.job_id
  JOIN public.jobs j
    ON j.business_id = q.business_id
   AND j.id = q.job_id
  WHERE p.id = auth.uid()
    AND p.role = 'CUSTOMER'
    AND p.customer_id IS NOT NULL
    AND j.customer_id = p.customer_id
    AND qv.status IN ('sent', 'approved', 'declined')
$$;

-- Allows a CUSTOMER to approve or decline a sent quotation version.
-- Guards: linked customer profile required; quote must be in 'sent' status;
--         duplicate submissions are blocked with a friendly error.
CREATE OR REPLACE FUNCTION public.respond_to_quote(
  target_quote_version_id UUID,
  decision                TEXT,
  customer_comments       TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  customer_profile RECORD;
  approval_id      UUID;
BEGIN
  IF decision IS NULL OR decision NOT IN ('approved', 'declined') THEN
    RAISE EXCEPTION 'Decision must be approved or declined.'
      USING ERRCODE = '22023';
  END IF;

  IF customer_comments IS NOT NULL AND length(customer_comments) > 2000 THEN
    RAISE EXCEPTION 'Comments must be 2000 characters or fewer.'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.business_id, p.customer_id
  INTO customer_profile
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.role = 'CUSTOMER'
    AND p.customer_id IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer profile is not linked to a customer record.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.quotes q
    JOIN public.quote_versions qv
      ON qv.business_id = q.business_id
     AND qv.id = q.quote_version_id
    JOIN public.jobs j
      ON j.business_id = q.business_id
     AND j.id = q.job_id
    WHERE q.business_id        = customer_profile.business_id
      AND q.customer_id        = customer_profile.customer_id
      AND q.quote_version_id   = target_quote_version_id
      AND qv.job_id            = q.job_id
      AND j.customer_id        = customer_profile.customer_id
      AND qv.status            = 'sent'
  ) THEN
    RAISE EXCEPTION 'That quotation version is not available to this customer.'
      USING ERRCODE = '42501';
  END IF;

  -- Guard against duplicate submissions.
  -- The unique index idx_approvals_version_customer is a last-resort safety net;
  -- this check provides a friendly error instead of a raw constraint violation.
  IF EXISTS (
    SELECT 1 FROM public.approvals
    WHERE business_id      = customer_profile.business_id
      AND quote_version_id = target_quote_version_id
      AND customer_id      = customer_profile.customer_id
  ) THEN
    RAISE EXCEPTION 'You have already responded to this quotation version.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.approvals (
    business_id, quote_version_id, customer_id, status, approved_at, comments
  )
  VALUES (
    customer_profile.business_id,
    target_quote_version_id,
    customer_profile.customer_id,
    decision::public.approval_status,
    CASE WHEN decision = 'approved' THEN NOW() ELSE NULL END,
    customer_comments
  )
  RETURNING id INTO approval_id;

  -- Use an explicit CASE rather than a blind cast so future ENUM changes
  -- are caught at authoring time rather than silently at runtime.
  UPDATE public.quote_versions
  SET status = CASE WHEN decision = 'approved'
                    THEN 'approved'::public.quote_status
                    ELSE 'declined'::public.quote_status END
  WHERE id          = target_quote_version_id
    AND business_id = customer_profile.business_id;

  RETURN approval_id;
END;
$$;

-- Allows a CUSTOMER to record the outcome of a follow-up.
-- same_symptom  -> creates a comeback_case.
-- different_issue -> creates a new service_request (requires notes + consent).
-- no_response   -> rejected; it is recorded by the follow-up process, not the customer.
-- The FOR UPDATE lock on the follow_up row prevents concurrent double-submissions.
CREATE OR REPLACE FUNCTION public.record_my_follow_up_outcome(
  target_follow_up_id UUID,
  customer_outcome    public.repair_outcome,
  customer_notes      TEXT    DEFAULT NULL,
  has_privacy_consent BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  outcome_id      UUID,
  new_request_id  UUID,
  comeback_case_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  customer_profile   RECORD;
  follow_up_record   RECORD;
  inserted_outcome_id  UUID;
  inserted_request_id  UUID;
  inserted_comeback_id UUID;
BEGIN
  IF customer_outcome IS NULL THEN
    RAISE EXCEPTION 'A customer outcome is required.'
      USING ERRCODE = '22023';
  END IF;

  -- no_response is a system-recorded state, not a customer response.
  IF customer_outcome = 'no_response' THEN
    RAISE EXCEPTION 'no_response is recorded by the follow-up process, not by a customer response. Submit working_as_expected, same_symptom, partly_improved, or different_issue.'
      USING ERRCODE = '22023';
  END IF;

  IF customer_notes IS NOT NULL AND length(customer_notes) > 4000 THEN
    RAISE EXCEPTION 'Notes must be 4000 characters or fewer.'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.business_id, p.customer_id
  INTO customer_profile
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.role = 'CUSTOMER'
    AND p.customer_id IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer profile is not linked to a customer record.'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    f.id,
    f.business_id,
    f.status,
    j.id          AS job_id,
    j.asset_id,
    j.issue_summary,
    c.full_name,
    c.phone,
    a.category,
    a.brand,
    a.model
  INTO follow_up_record
  FROM public.follow_ups f
  JOIN public.jobs j
    ON j.business_id = f.business_id
   AND j.id = f.job_id
  JOIN public.customers c
    ON c.business_id = j.business_id
   AND c.id = j.customer_id
  LEFT JOIN public.assets a
    ON a.business_id = j.business_id
   AND a.id = j.asset_id
  WHERE f.id          = target_follow_up_id
    AND f.business_id = customer_profile.business_id
    AND j.customer_id = customer_profile.customer_id
  FOR UPDATE OF f;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That follow-up is not available to this customer.'
      USING ERRCODE = '42501';
  END IF;

  -- Block re-submission if already completed/closed.
  -- The FOR UPDATE lock above prevents a concurrent second submission from
  -- passing this check while the first is still in flight.
  IF follow_up_record.status NOT IN ('scheduled', 'sent', 'overdue') THEN
    RAISE EXCEPTION 'This follow-up has already been completed or closed.'
      USING ERRCODE = '23514';
  END IF;

  IF customer_outcome = 'different_issue'
     AND (NOT has_privacy_consent OR NULLIF(BTRIM(customer_notes), '') IS NULL) THEN
    RAISE EXCEPTION 'A problem description and privacy consent are required for a new service request.'
      USING ERRCODE = '22023';
  END IF;

  IF customer_outcome = 'different_issue'
     AND NULLIF(BTRIM(follow_up_record.phone), '') IS NULL THEN
    RAISE EXCEPTION 'A contact phone number is required to create a new service request.'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.outcomes (
    business_id, follow_up_id, customer_id, outcome, notes
  )
  VALUES (
    customer_profile.business_id,
    target_follow_up_id,
    customer_profile.customer_id,
    customer_outcome,
    customer_notes
  )
  RETURNING id INTO inserted_outcome_id;

  UPDATE public.follow_ups
  SET status = 'completed'
  WHERE id          = target_follow_up_id
    AND business_id = customer_profile.business_id;

  IF customer_outcome = 'same_symptom' THEN
    INSERT INTO public.comeback_cases (
      business_id, original_job_id, customer_id, issue_summary,
      linked_follow_up_id, status
    )
    VALUES (
      customer_profile.business_id,
      follow_up_record.job_id,
      customer_profile.customer_id,
      COALESCE(NULLIF(BTRIM(customer_notes), ''), follow_up_record.issue_summary),
      target_follow_up_id,
      'needs_review'
    )
    RETURNING id INTO inserted_comeback_id;

  ELSIF customer_outcome = 'different_issue' THEN
    INSERT INTO public.service_requests (
      business_id, customer_id, asset_id, source_follow_up_id,
      customer_name, phone, equipment_category, brand_model,
      reported_problem, urgency, request_reference, privacy_consent,
      submitted_by_customer
    )
    VALUES (
      customer_profile.business_id,
      customer_profile.customer_id,
      follow_up_record.asset_id,
      target_follow_up_id,
      follow_up_record.full_name,
      follow_up_record.phone,
      COALESCE(follow_up_record.category, 'Other'),
      COALESCE(
        NULLIF(BTRIM(CONCAT_WS(' ', follow_up_record.brand, follow_up_record.model)), ''),
        follow_up_record.category,
        'Equipment'
      ),
      BTRIM(customer_notes),
      'medium',
      'KA-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 10)),
      TRUE,
      TRUE
    )
    RETURNING id INTO inserted_request_id;
  END IF;

  RETURN QUERY
  SELECT inserted_outcome_id, inserted_request_id, inserted_comeback_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_repair_summary()                                        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_quote_versions()                                        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_to_quote(UUID, TEXT, TEXT)                             FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_my_follow_up_outcome(UUID, public.repair_outcome, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_repair_summary()                                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_quote_versions()                                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_quote(UUID, TEXT, TEXT)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_my_follow_up_outcome(UUID, public.repair_outcome, TEXT, BOOLEAN) TO authenticated;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.businesses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnoses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parts_used      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qc_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warranty_terms  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outcomes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comeback_cases  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs   ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE GRANTS
-- ============================================================

REVOKE ALL ON TABLE
  public.businesses, public.profiles, public.customers, public.assets,
  public.service_requests, public.jobs, public.diagnoses, public.evidence,
  public.quote_versions, public.quotes, public.approvals, public.assignments,
  public.repair_logs, public.parts_used, public.qc_records, public.invoices,
  public.warranty_terms, public.follow_ups, public.outcomes,
  public.comeback_cases, public.activity_logs
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.businesses, public.profiles, public.customers, public.assets,
  public.service_requests, public.jobs, public.diagnoses, public.evidence,
  public.quote_versions, public.quotes, public.approvals, public.assignments,
  public.repair_logs, public.parts_used, public.qc_records, public.invoices,
  public.warranty_terms, public.follow_ups, public.outcomes,
  public.comeback_cases, public.activity_logs
TO authenticated;

-- profiles included so OWNER_ADMIN can update staff roles and users can update own avatar/name.
-- quote_versions intentionally excluded: updated only via the respond_to_quote() SECURITY DEFINER.
GRANT UPDATE ON public.businesses, public.profiles, public.customers, public.assets,
  public.service_requests, public.jobs, public.assignments, public.invoices,
  public.warranty_terms, public.follow_ups, public.comeback_cases
TO authenticated;

GRANT INSERT ON public.customers, public.assets, public.service_requests,
  public.jobs, public.diagnoses, public.evidence, public.quote_versions,
  public.quotes, public.assignments, public.repair_logs, public.parts_used,
  public.qc_records, public.invoices, public.warranty_terms, public.follow_ups,
  public.comeback_cases
TO authenticated;

-- ============================================================
-- RLS POLICIES — businesses
-- ============================================================

DROP POLICY IF EXISTS business_isolation         ON public.businesses;
DROP POLICY IF EXISTS business_read_own          ON public.businesses;
DROP POLICY IF EXISTS business_select_internal   ON public.businesses;
DROP POLICY IF EXISTS business_update_owner      ON public.businesses;

CREATE POLICY business_select_internal ON public.businesses
  FOR SELECT TO authenticated
  USING (
    id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER', 'TECHNICIAN', 'QC_REVIEWER'])
  );
CREATE POLICY business_update_owner ON public.businesses
  FOR UPDATE TO authenticated
  USING    (id = private.current_business_id() AND private.has_role(ARRAY['OWNER_ADMIN']))
  WITH CHECK (id = private.current_business_id() AND private.has_role(ARRAY['OWNER_ADMIN']));

-- ============================================================
-- RLS POLICIES — profiles
-- ============================================================

DROP POLICY IF EXISTS tenant_scope              ON public.profiles;
DROP POLICY IF EXISTS profile_read_business     ON public.profiles;
DROP POLICY IF EXISTS profiles_select_internal  ON public.profiles;
DROP POLICY IF EXISTS profiles_update_owner     ON public.profiles;
DROP POLICY IF EXISTS profiles_update_self      ON public.profiles;

CREATE POLICY profiles_select_internal ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (
      business_id = private.current_business_id()
      AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER', 'TECHNICIAN', 'QC_REVIEWER'])
    )
  );

-- OWNER_ADMIN can update other staff profiles (role changes, name, avatar).
-- Cannot change own role; cannot elevate to OWNER_ADMIN; cannot change business_id.
CREATE POLICY profiles_update_owner ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN'])
    AND id <> auth.uid()
  )
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN'])
    AND id <> auth.uid()
    AND role IN ('DISPATCHER', 'TECHNICIAN', 'QC_REVIEWER', 'CUSTOMER')
  );

-- Any authenticated user may update their own display name and avatar.
-- role and business_id are intentionally not updatable via this policy.
CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND business_id = private.current_business_id()
  );

-- ============================================================
-- RLS POLICIES — customers
-- ============================================================

DROP POLICY IF EXISTS tenant_scope_customers    ON public.customers;
DROP POLICY IF EXISTS tenant_read_only          ON public.customers;
DROP POLICY IF EXISTS customers_select_staff    ON public.customers;
DROP POLICY IF EXISTS customers_insert_staff    ON public.customers;
DROP POLICY IF EXISTS customers_update_staff    ON public.customers;

CREATE POLICY customers_select_staff ON public.customers
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND (
      private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
      OR (private.has_role(ARRAY['TECHNICIAN'])  AND private.can_access_customer(id))
      OR (private.has_role(ARRAY['QC_REVIEWER']) AND private.can_access_customer(id))
    )
  );
CREATE POLICY customers_insert_staff ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );
CREATE POLICY customers_update_staff ON public.customers
  FOR UPDATE TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  )
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );

-- ============================================================
-- RLS POLICIES — assets
-- ============================================================

DROP POLICY IF EXISTS assets_select_staff  ON public.assets;
DROP POLICY IF EXISTS assets_insert_staff  ON public.assets;
DROP POLICY IF EXISTS assets_update_staff  ON public.assets;

CREATE POLICY assets_select_staff ON public.assets
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND (
      private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
      OR (private.has_role(ARRAY['TECHNICIAN'])  AND private.can_access_asset(id))
      OR (private.has_role(ARRAY['QC_REVIEWER']) AND private.can_access_asset(id))
    )
  );
CREATE POLICY assets_insert_staff ON public.assets
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );
CREATE POLICY assets_update_staff ON public.assets
  FOR UPDATE TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  )
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );

-- ============================================================
-- RLS POLICIES — service_requests
-- ============================================================

DROP POLICY IF EXISTS tenant_scope_service_requests    ON public.service_requests;
DROP POLICY IF EXISTS service_requests_select_staff    ON public.service_requests;
DROP POLICY IF EXISTS service_requests_insert_staff    ON public.service_requests;
DROP POLICY IF EXISTS service_requests_update_staff    ON public.service_requests;

CREATE POLICY service_requests_select_staff ON public.service_requests
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND (
      private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
      OR (private.has_role(ARRAY['TECHNICIAN'])  AND private.can_access_request(id))
      OR (private.has_role(ARRAY['QC_REVIEWER']) AND private.can_access_request(id))
    )
  );
CREATE POLICY service_requests_insert_staff ON public.service_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );
CREATE POLICY service_requests_update_staff ON public.service_requests
  FOR UPDATE TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  )
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );

-- ============================================================
-- RLS POLICIES — jobs
-- ============================================================

DROP POLICY IF EXISTS tenant_scope_jobs      ON public.jobs;
DROP POLICY IF EXISTS tenant_read_only       ON public.jobs;
DROP POLICY IF EXISTS jobs_select_assigned   ON public.jobs;
DROP POLICY IF EXISTS jobs_insert_dispatch   ON public.jobs;
DROP POLICY IF EXISTS jobs_update_assigned   ON public.jobs;
DROP POLICY IF EXISTS jobs_update_dispatch   ON public.jobs;

CREATE POLICY jobs_select_assigned ON public.jobs
  FOR SELECT TO authenticated
  USING (private.can_access_job(id));
CREATE POLICY jobs_insert_dispatch ON public.jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );
CREATE POLICY jobs_update_dispatch ON public.jobs
  FOR UPDATE TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  )
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );

-- ============================================================
-- RLS POLICIES — diagnoses
-- ============================================================

DROP POLICY IF EXISTS tenant_read_only         ON public.diagnoses;
DROP POLICY IF EXISTS diagnoses_select_assigned ON public.diagnoses;
DROP POLICY IF EXISTS diagnoses_insert_assigned ON public.diagnoses;

CREATE POLICY diagnoses_select_assigned ON public.diagnoses
  FOR SELECT TO authenticated
  USING (business_id = private.current_business_id() AND private.can_access_job(job_id));
CREATE POLICY diagnoses_insert_assigned ON public.diagnoses
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = private.current_business_id()
    AND (
      private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
      OR (
        private.has_role(ARRAY['TECHNICIAN'])
        AND technician_id = auth.uid()
        AND private.is_assigned_technician_job(job_id)
      )
    )
  );

-- ============================================================
-- RLS POLICIES — evidence
-- ============================================================

DROP POLICY IF EXISTS tenant_read_only        ON public.evidence;
DROP POLICY IF EXISTS evidence_select_assigned ON public.evidence;
DROP POLICY IF EXISTS evidence_insert_assigned ON public.evidence;

CREATE POLICY evidence_select_assigned ON public.evidence
  FOR SELECT TO authenticated
  USING (business_id = private.current_business_id() AND private.can_access_job(job_id));
CREATE POLICY evidence_insert_assigned ON public.evidence
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = private.current_business_id()
    AND (
      private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
      OR (
        private.has_role(ARRAY['TECHNICIAN'])
        AND private.is_assigned_technician_job(job_id)
      )
    )
  );

-- ============================================================
-- RLS POLICIES — quote_versions
-- ============================================================

DROP POLICY IF EXISTS tenant_read_only                ON public.quote_versions;
DROP POLICY IF EXISTS quote_versions_select_dispatch  ON public.quote_versions;
DROP POLICY IF EXISTS quote_versions_insert_dispatch  ON public.quote_versions;

CREATE POLICY quote_versions_select_dispatch ON public.quote_versions
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );
CREATE POLICY quote_versions_insert_dispatch ON public.quote_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );

-- ============================================================
-- RLS POLICIES — quotes
-- ============================================================

DROP POLICY IF EXISTS tenant_read_only       ON public.quotes;
DROP POLICY IF EXISTS quotes_select_dispatch ON public.quotes;
DROP POLICY IF EXISTS quotes_insert_dispatch ON public.quotes;

CREATE POLICY quotes_select_dispatch ON public.quotes
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );
CREATE POLICY quotes_insert_dispatch ON public.quotes
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );

-- ============================================================
-- RLS POLICIES — approvals
-- ============================================================

DROP POLICY IF EXISTS tenant_read_only        ON public.approvals;
DROP POLICY IF EXISTS approvals_select_dispatch ON public.approvals;

CREATE POLICY approvals_select_dispatch ON public.approvals
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );

-- ============================================================
-- RLS POLICIES — assignments
-- ============================================================

DROP POLICY IF EXISTS assignments_select_owner_or_self ON public.assignments;
DROP POLICY IF EXISTS assignments_insert_dispatch      ON public.assignments;
DROP POLICY IF EXISTS assignments_update_dispatch      ON public.assignments;

CREATE POLICY assignments_select_owner_or_self ON public.assignments
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND (
      private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER', 'QC_REVIEWER'])
      OR (private.has_role(ARRAY['TECHNICIAN']) AND technician_id = auth.uid())
    )
  );
CREATE POLICY assignments_insert_dispatch ON public.assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id          = technician_id
        AND p.business_id = private.current_business_id()
        AND p.role        = 'TECHNICIAN'
    )
    AND (assigned_by IS NULL OR assigned_by = auth.uid())
  );
CREATE POLICY assignments_update_dispatch ON public.assignments
  FOR UPDATE TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id          = technician_id
        AND p.business_id = private.current_business_id()
        AND p.role        = 'TECHNICIAN'
    )
  )
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id          = technician_id
        AND p.business_id = private.current_business_id()
        AND p.role        = 'TECHNICIAN'
    )
    AND (assigned_by IS NULL OR assigned_by = auth.uid())
  );

-- ============================================================
-- RLS POLICIES — repair_logs
-- ============================================================

DROP POLICY IF EXISTS tenant_read_only            ON public.repair_logs;
DROP POLICY IF EXISTS repair_logs_select_assigned ON public.repair_logs;
DROP POLICY IF EXISTS repair_logs_insert_assigned ON public.repair_logs;

CREATE POLICY repair_logs_select_assigned ON public.repair_logs
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND (
      private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
      OR (private.has_role(ARRAY['TECHNICIAN']) AND private.is_assigned_technician_job(job_id))
    )
  );
CREATE POLICY repair_logs_insert_assigned ON public.repair_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = private.current_business_id()
    AND (
      private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
      OR (
        private.has_role(ARRAY['TECHNICIAN'])
        AND technician_id = auth.uid()
        AND private.is_assigned_technician_job(job_id)
      )
    )
  );

-- ============================================================
-- RLS POLICIES — parts_used
-- ============================================================

DROP POLICY IF EXISTS tenant_read_only         ON public.parts_used;
DROP POLICY IF EXISTS parts_used_select_assigned ON public.parts_used;
DROP POLICY IF EXISTS parts_used_insert_assigned ON public.parts_used;

CREATE POLICY parts_used_select_assigned ON public.parts_used
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND (
      private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
      OR (private.has_role(ARRAY['TECHNICIAN']) AND private.is_assigned_technician_job(job_id))
    )
  );
CREATE POLICY parts_used_insert_assigned ON public.parts_used
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = private.current_business_id()
    AND (
      private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
      OR (
        private.has_role(ARRAY['TECHNICIAN'])
        AND private.is_assigned_technician_job(job_id)
      )
    )
  );

-- ============================================================
-- RLS POLICIES — qc_records
-- ============================================================

DROP POLICY IF EXISTS tenant_read_only           ON public.qc_records;
DROP POLICY IF EXISTS qc_records_select_reviewers ON public.qc_records;
DROP POLICY IF EXISTS qc_records_insert_reviewers ON public.qc_records;

CREATE POLICY qc_records_select_reviewers ON public.qc_records
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND (
      private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER', 'QC_REVIEWER'])
      OR (
        private.has_role(ARRAY['TECHNICIAN'])
        AND private.is_assigned_technician_job(job_id)
      )
    )
  );
CREATE POLICY qc_records_insert_reviewers ON public.qc_records
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = private.current_business_id()
    AND (
      private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
      OR (private.has_role(ARRAY['QC_REVIEWER']) AND reviewer_id = auth.uid())
    )
  );

-- ============================================================
-- RLS POLICIES — invoices
-- ============================================================

DROP POLICY IF EXISTS tenant_read_only        ON public.invoices;
DROP POLICY IF EXISTS invoices_select_dispatch ON public.invoices;
DROP POLICY IF EXISTS invoices_insert_dispatch ON public.invoices;
DROP POLICY IF EXISTS invoices_update_dispatch ON public.invoices;

CREATE POLICY invoices_select_dispatch ON public.invoices
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );
CREATE POLICY invoices_insert_dispatch ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );
CREATE POLICY invoices_update_dispatch ON public.invoices
  FOR UPDATE TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  )
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );

-- ============================================================
-- RLS POLICIES — warranty_terms
-- ============================================================

DROP POLICY IF EXISTS tenant_read_only              ON public.warranty_terms;
DROP POLICY IF EXISTS warranty_terms_select_dispatch ON public.warranty_terms;
DROP POLICY IF EXISTS warranty_terms_insert_dispatch ON public.warranty_terms;
DROP POLICY IF EXISTS warranty_terms_update_dispatch ON public.warranty_terms;

CREATE POLICY warranty_terms_select_dispatch ON public.warranty_terms
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );
CREATE POLICY warranty_terms_insert_dispatch ON public.warranty_terms
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );
CREATE POLICY warranty_terms_update_dispatch ON public.warranty_terms
  FOR UPDATE TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  )
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );

-- ============================================================
-- RLS POLICIES — follow_ups
-- ============================================================

DROP POLICY IF EXISTS tenant_scope_follow_ups    ON public.follow_ups;
DROP POLICY IF EXISTS tenant_read_only           ON public.follow_ups;
DROP POLICY IF EXISTS follow_ups_select_dispatch ON public.follow_ups;
DROP POLICY IF EXISTS follow_ups_insert_dispatch ON public.follow_ups;
DROP POLICY IF EXISTS follow_ups_update_dispatch ON public.follow_ups;

CREATE POLICY follow_ups_select_dispatch ON public.follow_ups
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );
CREATE POLICY follow_ups_insert_dispatch ON public.follow_ups
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );
CREATE POLICY follow_ups_update_dispatch ON public.follow_ups
  FOR UPDATE TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  )
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );

-- ============================================================
-- RLS POLICIES — outcomes
-- ============================================================

DROP POLICY IF EXISTS tenant_read_only        ON public.outcomes;
DROP POLICY IF EXISTS outcomes_select_dispatch ON public.outcomes;

CREATE POLICY outcomes_select_dispatch ON public.outcomes
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );

-- ============================================================
-- RLS POLICIES — comeback_cases
-- ============================================================

DROP POLICY IF EXISTS tenant_read_only                ON public.comeback_cases;
DROP POLICY IF EXISTS comeback_cases_select_internal  ON public.comeback_cases;
DROP POLICY IF EXISTS comeback_cases_insert_dispatch  ON public.comeback_cases;
DROP POLICY IF EXISTS comeback_cases_update_dispatch  ON public.comeback_cases;

CREATE POLICY comeback_cases_select_internal ON public.comeback_cases
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER', 'QC_REVIEWER'])
  );
CREATE POLICY comeback_cases_insert_dispatch ON public.comeback_cases
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );
CREATE POLICY comeback_cases_update_dispatch ON public.comeback_cases
  FOR UPDATE TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  )
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );

-- ============================================================
-- RLS POLICIES — activity_logs
-- ============================================================

DROP POLICY IF EXISTS tenant_read_only           ON public.activity_logs;
DROP POLICY IF EXISTS activity_logs_select_owner ON public.activity_logs;

CREATE POLICY activity_logs_select_owner ON public.activity_logs
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN'])
  );

-- ============================================================
-- STORAGE — private evidence bucket
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'kaamflow-private-evidence',
  'kaamflow-private-evidence',
  FALSE,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'kaamflow-private-evidence'
  ) THEN
    RAISE EXCEPTION 'The private evidence bucket could not be created.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'kaamflow-private-evidence'
      AND public IS DISTINCT FROM FALSE
  ) THEN
    RAISE EXCEPTION 'The existing evidence bucket is public; review it manually before continuing.';
  END IF;
END;
$$;

-- No DELETE policy is intentional: evidence is immutable once uploaded (audit/legal).
-- If file deletion is ever required, add an OWNER_ADMIN-only DELETE policy here.
DROP POLICY IF EXISTS kaamflow_evidence_delete         ON storage.objects;
DROP POLICY IF EXISTS kaamflow_evidence_select_internal ON storage.objects;
DROP POLICY IF EXISTS kaamflow_evidence_insert_internal ON storage.objects;

-- READ: user must be staff in the same business with job access,
-- AND the metadata row must already exist in public.evidence.
CREATE POLICY kaamflow_evidence_select_internal ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'kaamflow-private-evidence'
    AND private.storage_path_uuid(name, 1) = private.current_business_id()
    AND private.can_access_job(private.storage_path_uuid(name, 2))
    AND EXISTS (
      SELECT 1
      FROM public.evidence e
      WHERE e.business_id  = private.current_business_id()
        AND e.job_id       = private.storage_path_uuid(name, 2)
        AND e.storage_path = name
    )
  );

-- WRITE: INSERT evidence metadata row first, then upload the file.
-- The policy validates that the metadata row already exists (metadata-first pattern).
CREATE POLICY kaamflow_evidence_insert_internal ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'kaamflow-private-evidence'
    AND private.storage_path_uuid(name, 1) = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER', 'TECHNICIAN'])
    AND private.can_access_job(private.storage_path_uuid(name, 2))
    AND EXISTS (
      SELECT 1
      FROM public.evidence e
      WHERE e.business_id  = private.current_business_id()
        AND e.job_id       = private.storage_path_uuid(name, 2)
        AND e.storage_path = name
    )
  );

COMMIT;
