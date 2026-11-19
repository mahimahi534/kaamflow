-- ============================================================================
-- KAAMFLOW ADDITIVE MIGRATION: PRODUCTION MVP COMPLETION
-- Migration: 20261118090000_kaamflow_mvp_completion.sql
-- ============================================================================

-- 1. BUSINESS TENANT EXTENSIONS
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS operating_hours JSONB DEFAULT '{"monday":"9am-6pm","tuesday":"9am-6pm","wednesday":"9am-6pm","thursday":"9am-6pm","friday":"9am-6pm","saturday":"10am-4pm","sunday":"closed"}'::jsonb,
  ADD COLUMN IF NOT EXISTS service_categories TEXT[] DEFAULT ARRAY['Appliance', 'Mobile Phone', 'Tablet', 'Laptop', 'Desktop Computer', 'Audio / Hi-Fi', 'TV / Display', 'Power Tool', 'HVAC / Cooling', 'Other'],
  ADD COLUMN IF NOT EXISTS coverage_notes TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_interval_days INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS observation_window_days INTEGER NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS min_sample_size INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS status_labels JSONB DEFAULT '{}'::jsonb;

-- 2. STAFF PROFILE EXTENSIONS
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- 3. REPAIR JOB WORKFLOW GUARDS & QC
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS quote_required BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS quote_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qc_passed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qc_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS qc_override_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rework_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rework_notes TEXT,
  ADD COLUMN IF NOT EXISTS is_rework BOOLEAN NOT NULL DEFAULT false;

-- 4. SERVICE REQUEST INTAKE EXTENSIONS
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS service_address TEXT,
  ADD COLUMN IF NOT EXISTS visible_condition TEXT,
  ADD COLUMN IF NOT EXISTS accessories_supplied TEXT,
  ADD COLUMN IF NOT EXISTS access_notes TEXT,
  ADD COLUMN IF NOT EXISTS privacy_consent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS appointment_status TEXT DEFAULT 'pending' CHECK (appointment_status IN ('pending', 'confirmed', 'rescheduled', 'cancelled')),
  ADD COLUMN IF NOT EXISTS appointment_notes TEXT;

ALTER TABLE public.service_requests
  ALTER COLUMN privacy_consent SET DEFAULT false;

-- 5. PAYMENTS & TRANSACTIONS TABLE
CREATE TABLE IF NOT EXISTS public.payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_id          UUID NOT NULL REFERENCES public.jobs(id)       ON DELETE CASCADE,
  invoice_id      UUID REFERENCES public.invoices(id)            ON DELETE SET NULL,
  payment_request_key UUID NOT NULL DEFAULT gen_random_uuid(),
  amount          NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  payment_method  TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'bank_transfer', 'cheque', 'mobile_pay', 'other')),
  notes           TEXT,
  recorded_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_request_key UUID;

UPDATE public.payments
SET payment_request_key = gen_random_uuid()
WHERE payment_request_key IS NULL;

ALTER TABLE public.payments
  ALTER COLUMN payment_request_key SET DEFAULT gen_random_uuid(),
  ALTER COLUMN payment_request_key SET NOT NULL;

-- 6. CUSTOMER SECURE TRACKING TOKENS
CREATE TABLE IF NOT EXISTS public.customer_tracking_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_id          UUID NOT NULL REFERENCES public.jobs(id)       ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. COMPLAINTS & DISPUTE TRACKING
CREATE TABLE IF NOT EXISTS public.complaints (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_id            UUID NOT NULL REFERENCES public.jobs(id)       ON DELETE CASCADE,
  customer_id       UUID REFERENCES public.customers(id)          ON DELETE SET NULL,
  complaint_text    TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'under_review', 'resolved', 'dismissed')),
  resolution_notes  TEXT,
  resolved_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. WAITING-FOR-PARTS PROCUREMENT TRACKING
CREATE TABLE IF NOT EXISTS public.parts_orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_id                UUID NOT NULL REFERENCES public.jobs(id)       ON DELETE CASCADE,
  part_name             TEXT NOT NULL,
  part_number           TEXT,
  supplier              TEXT,
  quantity              INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status                TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'shipped', 'received', 'cancelled')),
  expected_arrival_date DATE,
  customer_visible_note TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. CATEGORY-SPECIFIC CHECKLIST TEMPLATES
CREATE TABLE IF NOT EXISTS public.checklist_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('diagnosis', 'qc')),
  items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, category, type)
);

-- Enforce that tenant-owned references stay inside the row's business.
-- NOT VALID preserves existing rows during installation; VALIDATE below makes
-- invalid legacy relationships fail safely instead of silently rewriting data.
--
-- Composite tenant foreign keys require matching unique indexes on the
-- referenced (business_id, id) columns. The primary key guarantees id is
-- globally unique, while these indexes make the composite tenant key valid.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_business_id_id
  ON public.customers (business_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_business_id_id
  ON public.profiles (business_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_business_id_id
  ON public.jobs (business_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_business_id_id
  ON public.invoices (business_id, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payments'::regclass
      AND conname = 'payments_job_same_business'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_job_same_business
      FOREIGN KEY (business_id, job_id)
      REFERENCES public.jobs (business_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payments'::regclass
      AND conname = 'payments_invoice_same_business'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_invoice_same_business
      FOREIGN KEY (business_id, invoice_id)
      REFERENCES public.invoices (business_id, id)
      ON DELETE SET NULL (invoice_id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payments'::regclass
      AND conname = 'payments_recorder_same_business'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_recorder_same_business
      FOREIGN KEY (business_id, recorded_by)
      REFERENCES public.profiles (business_id, id)
      ON DELETE SET NULL (recorded_by) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.customer_tracking_tokens'::regclass
      AND conname = 'tracking_tokens_job_same_business'
  ) THEN
    ALTER TABLE public.customer_tracking_tokens
      ADD CONSTRAINT tracking_tokens_job_same_business
      FOREIGN KEY (business_id, job_id)
      REFERENCES public.jobs (business_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.customer_tracking_tokens'::regclass
      AND conname = 'tracking_tokens_creator_same_business'
  ) THEN
    ALTER TABLE public.customer_tracking_tokens
      ADD CONSTRAINT tracking_tokens_creator_same_business
      FOREIGN KEY (business_id, created_by)
      REFERENCES public.profiles (business_id, id)
      ON DELETE SET NULL (created_by) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.complaints'::regclass
      AND conname = 'complaints_job_same_business'
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_job_same_business
      FOREIGN KEY (business_id, job_id)
      REFERENCES public.jobs (business_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.complaints'::regclass
      AND conname = 'complaints_customer_same_business'
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_customer_same_business
      FOREIGN KEY (business_id, customer_id)
      REFERENCES public.customers (business_id, id)
      ON DELETE SET NULL (customer_id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.complaints'::regclass
      AND conname = 'complaints_resolver_same_business'
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_resolver_same_business
      FOREIGN KEY (business_id, resolved_by)
      REFERENCES public.profiles (business_id, id)
      ON DELETE SET NULL (resolved_by) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.parts_orders'::regclass
      AND conname = 'parts_orders_job_same_business'
  ) THEN
    ALTER TABLE public.parts_orders
      ADD CONSTRAINT parts_orders_job_same_business
      FOREIGN KEY (business_id, job_id)
      REFERENCES public.jobs (business_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.payments VALIDATE CONSTRAINT payments_job_same_business;
ALTER TABLE public.payments VALIDATE CONSTRAINT payments_invoice_same_business;
ALTER TABLE public.payments VALIDATE CONSTRAINT payments_recorder_same_business;
ALTER TABLE public.customer_tracking_tokens VALIDATE CONSTRAINT tracking_tokens_job_same_business;
ALTER TABLE public.customer_tracking_tokens VALIDATE CONSTRAINT tracking_tokens_creator_same_business;
ALTER TABLE public.complaints VALIDATE CONSTRAINT complaints_job_same_business;
ALTER TABLE public.complaints VALIDATE CONSTRAINT complaints_customer_same_business;
ALTER TABLE public.complaints VALIDATE CONSTRAINT complaints_resolver_same_business;
ALTER TABLE public.parts_orders VALIDATE CONSTRAINT parts_orders_job_same_business;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_business_request_key
  ON public.payments (business_id, payment_request_key);
CREATE INDEX IF NOT EXISTS idx_payments_business_job_created
  ON public.payments (business_id, job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_business_invoice_created
  ON public.payments (business_id, invoice_id, created_at DESC)
  WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_complaints_business_job_created
  ON public.complaints (business_id, job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_business_customer_created
  ON public.complaints (business_id, customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parts_orders_business_job_created
  ON public.parts_orders (business_id, job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parts_orders_business_status_arrival
  ON public.parts_orders (business_id, status, expected_arrival_date);

-- 10. ENABLE RLS ON ALL NEW TABLES
ALTER TABLE public.payments                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_tracking_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaints               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parts_orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_templates      ENABLE ROW LEVEL SECURITY;

-- 11. RLS POLICIES FOR NEW TABLES

-- Payments: Internal staff only
DROP POLICY IF EXISTS payments_select_staff ON public.payments;
CREATE POLICY payments_select_staff ON public.payments
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );

DROP POLICY IF EXISTS payments_insert_staff ON public.payments;

-- Customer Tracking Tokens: Internal staff management
DROP POLICY IF EXISTS tracking_tokens_select_staff ON public.customer_tracking_tokens;
CREATE POLICY tracking_tokens_select_staff ON public.customer_tracking_tokens
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );

DROP POLICY IF EXISTS tracking_tokens_insert_staff ON public.customer_tracking_tokens;
DROP POLICY IF EXISTS tracking_tokens_update_staff ON public.customer_tracking_tokens;

-- Complaints: Internal staff
DROP POLICY IF EXISTS complaints_select_staff ON public.complaints;
CREATE POLICY complaints_select_staff ON public.complaints
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );

DROP POLICY IF EXISTS complaints_insert_staff ON public.complaints;
CREATE POLICY complaints_insert_staff ON public.complaints
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
  );

DROP POLICY IF EXISTS complaints_update_staff ON public.complaints;

-- Parts Orders: Staff and assigned technicians
DROP POLICY IF EXISTS parts_orders_select_staff ON public.parts_orders;
CREATE POLICY parts_orders_select_staff ON public.parts_orders
  FOR SELECT TO authenticated
  USING (
    business_id = private.current_business_id()
    AND (
      private.has_role(ARRAY['OWNER_ADMIN', 'DISPATCHER'])
      OR (private.has_role(ARRAY['TECHNICIAN']) AND private.can_access_job(job_id))
    )
  );

DROP POLICY IF EXISTS parts_orders_insert_staff ON public.parts_orders;
DROP POLICY IF EXISTS parts_orders_update_staff ON public.parts_orders;

-- Checklist Templates: Internal staff
DROP POLICY IF EXISTS checklist_templates_select ON public.checklist_templates;
CREATE POLICY checklist_templates_select ON public.checklist_templates
  FOR SELECT TO authenticated
  USING (business_id = private.current_business_id());

DROP POLICY IF EXISTS checklist_templates_modify ON public.checklist_templates;

-- Explicit privileges avoid relying on project-wide default table grants.
REVOKE ALL ON TABLE
  public.payments, public.customer_tracking_tokens, public.complaints,
  public.parts_orders, public.checklist_templates
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.payments, public.complaints, public.parts_orders, public.checklist_templates
TO authenticated;
GRANT INSERT ON TABLE public.complaints TO authenticated;
GRANT SELECT (
  id, business_id, job_id, expires_at, revoked_at, created_at
) ON TABLE public.customer_tracking_tokens TO authenticated;

-- 12. PUBLIC CUSTOMER REPAIR TRACKING FUNCTION (SECURITY DEFINER)
-- Exposes ONLY customer-safe fields. Never internal notes, private diagnosis, or staff data.
CREATE OR REPLACE FUNCTION public.get_public_job_tracking(target_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  token_rec RECORD;
  result    JSONB;
BEGIN
  IF target_token IS NULL OR BTRIM(target_token) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid tracking token.');
  END IF;

  SELECT t.id, t.job_id, t.business_id, t.expires_at, t.revoked_at
  INTO token_rec
  FROM public.customer_tracking_tokens t
  WHERE t.token_hash = target_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tracking link not found or invalid.');
  END IF;

  IF token_rec.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This tracking link has been revoked by the workshop.');
  END IF;

  IF token_rec.expires_at < NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'This tracking link has expired.');
  END IF;

  SELECT jsonb_build_object(
    'success', true,
    'job_code', 'JOB-' || UPPER(SUBSTRING(j.id::text, 1, 8)),
    'status', j.status,
    'reported_issue', j.issue_summary,
    'equipment_category', COALESCE(a.category, 'Appliance / Device'),
    'brand', a.brand,
    'model', a.model,
    'created_at', j.created_at,
    'handed_over_at', j.handed_over_at,
    'workshop_name', b.name,
    'parts_status_note', (
      SELECT po.customer_visible_note
      FROM public.parts_orders po
      WHERE po.job_id = j.id
      ORDER BY po.created_at DESC
      LIMIT 1
    ),
    'quote_summary', (
      SELECT jsonb_build_object(
        'total', qv.total_amount,
        'status', qv.status
      )
      FROM public.quote_versions qv
      WHERE qv.job_id = j.id AND qv.status IN ('sent', 'approved', 'declined')
      ORDER BY qv.version_number DESC
      LIMIT 1
    )
  )
  INTO result
  FROM public.jobs j
  JOIN public.businesses b ON b.id = j.business_id
  LEFT JOIN public.assets a ON a.id = j.asset_id
  WHERE j.id = token_rec.job_id
    AND j.business_id = token_rec.business_id;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_job_tracking(TEXT) TO anon, authenticated;

-- 13. SEED DEFAULT CHECKLIST TEMPLATES (FOR KAAMFLOW CENTRAL WORKSHOP)
DO $$
DECLARE
  biz_id UUID;
BEGIN
  SELECT id INTO biz_id FROM public.businesses WHERE slug = 'kaamflow-central' LIMIT 1;
  IF biz_id IS NOT NULL THEN
    -- AC QC Checklist
    INSERT INTO public.checklist_templates (business_id, category, type, items)
    VALUES (
      biz_id,
      'HVAC / Cooling',
      'qc',
      '[
        {"id": "c1", "label": "Compressor operating pressure within specification", "critical": true},
        {"id": "c2", "label": "Refrigerant charge level and leak test passed", "critical": true},
        {"id": "c3", "label": "Blower fan balance and amp draw verified", "critical": false},
        {"id": "c4", "label": "Thermostat temperature differential delta-T >= 15°F", "critical": true},
        {"id": "c5", "label": "Condensate drain line clear and free flowing", "critical": false},
        {"id": "c6", "label": "Electrical contactors and capacitor rated microfarads inspected", "critical": true}
      ]'::jsonb
    ) ON CONFLICT (business_id, category, type) DO NOTHING;

    -- Refrigerator QC Checklist
    INSERT INTO public.checklist_templates (business_id, category, type, items)
    VALUES (
      biz_id,
      'Appliance',
      'qc',
      '[
        {"id": "r1", "label": "Freezer compartment reaches target <= 0°F / -18°C", "critical": true},
        {"id": "r2", "label": "Fresh food compartment reaches target 37°F / 3°C", "critical": true},
        {"id": "r3", "label": "Door magnetic gaskets seal perimeter completely", "critical": false},
        {"id": "r4", "label": "Defrost cycle heater & thermostat continuity verified", "critical": true},
        {"id": "r5", "label": "Evaporator fan and condenser coil clean & operational", "critical": false}
      ]'::jsonb
    ) ON CONFLICT (business_id, category, type) DO NOTHING;

    -- Washing Machine QC Checklist
    INSERT INTO public.checklist_templates (business_id, category, type, items)
    VALUES (
      biz_id,
      'Washing Machine',
      'qc',
      '[
        {"id": "w1", "label": "Water fill level pressure switch triggers accurately", "critical": true},
        {"id": "w2", "label": "High-speed spin cycle tested without excessive vibration", "critical": true},
        {"id": "w3", "label": "Drain pump evacuation time under 90 seconds", "critical": false},
        {"id": "w4", "label": "Lid switch / door interlock safety lock verified", "critical": true},
        {"id": "w5", "label": "No water leaks around tub seal, hoses, or pump", "critical": true}
      ]'::jsonb
    ) ON CONFLICT (business_id, category, type) DO NOTHING;

    -- Electronics / UPS Inverter Checklist
    INSERT INTO public.checklist_templates (business_id, category, type, items)
    VALUES (
      biz_id,
      'Electronics',
      'qc',
      '[
        {"id": "e1", "label": "AC mains transfer to battery inverter tested seamlessly", "critical": true},
        {"id": "e2", "label": "Output voltage waveform within nominal 220V/110V limits", "critical": true},
        {"id": "e3", "label": "Battery charging float and bulk cutoff voltage verified", "critical": true},
        {"id": "e4", "label": "Thermal cooling fan operates under 70% rated load", "critical": false},
        {"id": "e5", "label": "Ground insulation resistance test passed (> 2 MΩ)", "critical": true}
      ]'::jsonb
    ) ON CONFLICT (business_id, category, type) DO NOTHING;
  END IF;
END $$;
