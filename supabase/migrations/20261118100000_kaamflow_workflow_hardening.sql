-- Atomic workflow actions and server-side enforcement for KAAMFLOW.
-- Safe to apply after the core and MVP-completion migrations.

CREATE OR REPLACE FUNCTION public.record_my_follow_up_outcome(
  target_follow_up_id UUID,
  customer_outcome public.repair_outcome,
  customer_notes TEXT DEFAULT NULL,
  has_privacy_consent BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  outcome_id UUID,
  new_request_id UUID,
  comeback_case_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  customer_profile RECORD;
  follow_up_record RECORD;
  inserted_outcome_id UUID;
  inserted_request_id UUID;
  inserted_comeback_id UUID;
BEGIN
  IF customer_outcome IS NULL OR customer_outcome = 'no_response' THEN
    RAISE EXCEPTION 'Choose a customer-reported repair outcome.'
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
    AND p.is_active = TRUE
    AND p.role = 'CUSTOMER'
    AND p.customer_id IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer profile is not linked to a customer record.'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    f.id, f.business_id, f.status, j.id AS job_id,
    j.asset_id, j.issue_summary, c.full_name, c.phone, a.category, a.brand, a.model
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
  WHERE f.id = target_follow_up_id
    AND f.business_id = customer_profile.business_id
    AND j.customer_id = customer_profile.customer_id
  FOR UPDATE OF f;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That follow-up is not available to this customer.'
      USING ERRCODE = '42501';
  END IF;

  IF follow_up_record.status NOT IN ('scheduled', 'sent', 'overdue', 'unknown') THEN
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
    customer_profile.business_id, target_follow_up_id,
    customer_profile.customer_id, customer_outcome, customer_notes
  )
  RETURNING id INTO inserted_outcome_id;

  UPDATE public.follow_ups
  SET status = 'completed', updated_at = NOW()
  WHERE id = target_follow_up_id
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

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS quote_waiver_reason TEXT,
  ADD COLUMN IF NOT EXISTS quote_waiver_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.follow_ups
  ADD COLUMN IF NOT EXISTS reminder_count SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS customer_email TEXT;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_request_key UUID;

UPDATE public.payments
SET payment_request_key = gen_random_uuid()
WHERE payment_request_key IS NULL;

ALTER TABLE public.payments
  ALTER COLUMN payment_request_key SET DEFAULT gen_random_uuid(),
  ALTER COLUMN payment_request_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_business_request_key
  ON public.payments (business_id, payment_request_key);

DROP INDEX IF EXISTS public.idx_outcomes_one_per_follow_up;
CREATE UNIQUE INDEX IF NOT EXISTS idx_outcomes_one_final_per_follow_up
  ON public.outcomes (business_id, follow_up_id)
  WHERE outcome <> 'no_response'::public.repair_outcome;

CREATE INDEX IF NOT EXISTS idx_tracking_tokens_active_job
  ON public.customer_tracking_tokens (business_id, job_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_service_requests_public_rate_limit
  ON public.service_requests (
    business_id, (regexp_replace(phone, '[^0-9]', '', 'g')), created_at DESC
  );

-- Locate pgcrypto's installed schema so token hashing works with Supabase's
-- standard extensions schema and with installations that use the public schema.
DO $$
DECLARE
  crypto_schema TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    EXECUTE 'CREATE EXTENSION pgcrypto';
  END IF;

  SELECT n.nspname
  INTO crypto_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION private.hash_tracking_token(target_token TEXT)
     RETURNS TEXT
     LANGUAGE SQL
     IMMUTABLE
     STRICT
     SET search_path = ''''
     AS $function$
       SELECT encode(%I.digest(target_token, ''sha256''), ''hex'')
     $function$',
    crypto_schema
  );
END;
$$;

ALTER TABLE public.customer_tracking_tokens
  ADD COLUMN IF NOT EXISTS token_hash_version SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE public.customer_tracking_tokens
  ALTER COLUMN token_hash_version SET DEFAULT 1;

REVOKE ALL ON FUNCTION private.hash_tracking_token(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.current_business_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.business_id
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.is_active = TRUE
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION private.has_role(allowed_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = TRUE
      AND p.role = ANY (allowed_roles)
  )
$$;

CREATE OR REPLACE FUNCTION private.is_assigned_technician_job(target_job_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.assignments a
      ON a.business_id = p.business_id
     AND a.technician_id = p.id
    WHERE p.id = auth.uid()
      AND p.is_active = TRUE
      AND p.role = 'TECHNICIAN'
      AND a.job_id = target_job_id
      AND a.status IN ('assigned', 'in_progress')
  )
$$;

CREATE OR REPLACE FUNCTION public.get_my_repair_summary()
RETURNS TABLE (
  job_id UUID,
  status TEXT,
  equipment_category TEXT,
  brand TEXT,
  model TEXT,
  handed_over_at TIMESTAMPTZ
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
    AND p.is_active = TRUE
    AND p.role = 'CUSTOMER'
    AND p.customer_id IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.get_my_quote_versions()
RETURNS TABLE (
  quote_version_id UUID,
  job_id UUID,
  version_number INTEGER,
  labour_charge NUMERIC,
  parts_cost NUMERIC,
  tax_amount NUMERIC,
  total_amount NUMERIC
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
    AND p.is_active = TRUE
    AND p.role = 'CUSTOMER'
    AND p.customer_id IS NOT NULL
    AND j.customer_id = p.customer_id
    AND qv.status IN ('sent', 'approved', 'declined')
$$;

CREATE OR REPLACE FUNCTION private.enforce_quote_version_draft_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_role TEXT;
  actor_business_id UUID;
BEGIN
  SELECT p.role, p.business_id
  INTO actor_role, actor_business_id
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.is_active = TRUE;

  IF actor_business_id IS NULL
     OR actor_business_id <> NEW.business_id
     OR actor_role NOT IN ('OWNER_ADMIN', 'DISPATCHER')
     OR NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'Quotation versions must be created as drafts by active workshop staff.'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.quote_versions qv
    WHERE qv.business_id = NEW.business_id
      AND qv.job_id = NEW.job_id
      AND qv.status = 'sent'
  ) THEN
    RAISE EXCEPTION 'Resolve the currently sent quotation before creating another version.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quote_versions_draft_insert ON public.quote_versions;
CREATE TRIGGER quote_versions_draft_insert
  BEFORE INSERT ON public.quote_versions
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_quote_version_draft_insert();

REVOKE INSERT ON public.quotes, public.qc_records FROM authenticated;
REVOKE INSERT, UPDATE ON public.invoices FROM authenticated;
REVOKE UPDATE ON public.follow_ups FROM authenticated;

CREATE OR REPLACE FUNCTION public.send_quote_version(target_quote_version_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_business_id UUID;
  actor_name TEXT;
  quote_row RECORD;
  job_row RECORD;
BEGIN
  SELECT p.business_id, p.full_name
  INTO actor_business_id, actor_name
  FROM public.profiles p
  WHERE p.id = actor_id
    AND p.is_active = TRUE
    AND p.role IN ('OWNER_ADMIN', 'DISPATCHER');

  IF actor_business_id IS NULL THEN
    RAISE EXCEPTION 'Only active workshop staff can send quotations.'
      USING ERRCODE = '42501';
  END IF;

  SELECT qv.id, qv.business_id, qv.job_id, qv.status
  INTO quote_row
  FROM public.quote_versions qv
  WHERE qv.id = target_quote_version_id
    AND qv.business_id = actor_business_id
    AND qv.version_number = (
      SELECT MAX(latest.version_number)
      FROM public.quote_versions latest
      WHERE latest.business_id = actor_business_id
        AND latest.job_id = qv.job_id
    )
  FOR UPDATE;

  IF NOT FOUND OR quote_row.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft quotation can be sent.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.quote_versions prior
    WHERE prior.business_id = actor_business_id
      AND prior.job_id = quote_row.job_id
      AND prior.id <> quote_row.id
      AND prior.status = 'sent'
  ) THEN
    RAISE EXCEPTION 'Resolve the currently sent quotation before sending another version.'
      USING ERRCODE = '23514';
  END IF;

  SELECT j.id, j.customer_id, j.status
  INTO job_row
  FROM public.jobs j
  WHERE j.id = quote_row.job_id
    AND j.business_id = actor_business_id
  FOR UPDATE;

  IF NOT FOUND OR job_row.customer_id IS NULL THEN
    RAISE EXCEPTION 'A linked customer is required before sending a quotation.'
      USING ERRCODE = '23514';
  END IF;

  IF job_row.status IN ('completed', 'handover', 'closed') THEN
    RAISE EXCEPTION 'A quotation cannot be sent for a completed or closed repair.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.quotes q
    WHERE q.business_id = actor_business_id
      AND q.quote_version_id = quote_row.id
  ) THEN
    INSERT INTO public.quotes (
      business_id, job_id, quote_version_id, customer_id
    )
    VALUES (
      actor_business_id, quote_row.job_id, quote_row.id, job_row.customer_id
    );
  END IF;

  UPDATE public.quote_versions
  SET status = 'sent', updated_at = NOW()
  WHERE id = quote_row.id
    AND business_id = actor_business_id;

  UPDATE public.jobs
  SET status = 'awaiting_customer_approval', updated_at = NOW()
  WHERE id = job_row.id
    AND business_id = actor_business_id;

  INSERT INTO public.activity_logs (
    business_id, actor_id, entity_type, entity_id, action, details
  )
  VALUES (
    actor_business_id, actor_id, 'quote_version', quote_row.id, 'SEND_QUOTATION',
    jsonb_build_object('job_id', quote_row.job_id, 'sent_by', actor_name)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_staff_quote_decision(
  target_quote_version_id UUID,
  decision TEXT,
  staff_comments TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_business_id UUID;
  quote_row RECORD;
  job_row RECORD;
  approval_id UUID;
BEGIN
  IF decision IS NULL OR decision NOT IN ('approved', 'declined') THEN
    RAISE EXCEPTION 'Decision must be approved or declined.'
      USING ERRCODE = '22023';
  END IF;

  IF staff_comments IS NOT NULL AND length(staff_comments) > 2000 THEN
    RAISE EXCEPTION 'Comments must be 2000 characters or fewer.'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.business_id
  INTO actor_business_id
  FROM public.profiles p
  WHERE p.id = actor_id
    AND p.is_active = TRUE
    AND p.role IN ('OWNER_ADMIN', 'DISPATCHER');

  IF actor_business_id IS NULL THEN
    RAISE EXCEPTION 'Only active workshop staff can record an offline customer decision.'
      USING ERRCODE = '42501';
  END IF;

  SELECT qv.id, qv.business_id, qv.job_id, qv.status, qv.version_number
  INTO quote_row
  FROM public.quote_versions qv
  WHERE qv.id = target_quote_version_id
    AND qv.business_id = actor_business_id
    AND qv.version_number = (
      SELECT MAX(latest.version_number)
      FROM public.quote_versions latest
      WHERE latest.business_id = actor_business_id
        AND latest.job_id = qv.job_id
    )
  FOR UPDATE;

  IF NOT FOUND OR quote_row.status <> 'sent' THEN
    RAISE EXCEPTION 'Only a sent quotation can receive a customer decision.'
      USING ERRCODE = '23514';
  END IF;

  SELECT j.id, j.customer_id
  INTO job_row
  FROM public.jobs j
  WHERE j.id = quote_row.job_id
    AND j.business_id = actor_business_id
  FOR UPDATE;

  IF NOT FOUND OR job_row.customer_id IS NULL THEN
    RAISE EXCEPTION 'The repair has no linked customer.'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.approvals (
    business_id, quote_version_id, customer_id, status, approved_at, comments
  )
  VALUES (
    actor_business_id,
    quote_row.id,
    job_row.customer_id,
    decision::public.approval_status,
    CASE WHEN decision = 'approved' THEN NOW() ELSE NULL END,
    staff_comments
  )
  RETURNING id INTO approval_id;

  UPDATE public.quote_versions
  SET status = decision::public.quote_status, updated_at = NOW()
  WHERE id = quote_row.id
    AND business_id = actor_business_id;

  UPDATE public.jobs
  SET status = CASE WHEN decision = 'approved' THEN 'assigned' ELSE 'quotation' END,
      updated_at = NOW()
  WHERE id = job_row.id
    AND business_id = actor_business_id
    AND status = 'awaiting_customer_approval';

  INSERT INTO public.activity_logs (
    business_id, actor_id, entity_type, entity_id, action, details
  )
  VALUES (
    actor_business_id, actor_id, 'quote_version', quote_row.id,
    CASE WHEN decision = 'approved' THEN 'STAFF_RECORD_APPROVAL' ELSE 'STAFF_RECORD_DECLINE' END,
    jsonb_build_object('decision', decision, 'job_id', job_row.id)
  );

  RETURN approval_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_job_to_technician(
  target_job_id UUID,
  target_technician_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_business_id UUID;
  job_status TEXT;
  assignment_id UUID;
BEGIN
  SELECT p.business_id
  INTO actor_business_id
  FROM public.profiles p
  WHERE p.id = actor_id
    AND p.is_active = TRUE
    AND p.role IN ('OWNER_ADMIN', 'DISPATCHER');

  IF actor_business_id IS NULL THEN
    RAISE EXCEPTION 'Only active workshop staff can assign a technician.'
      USING ERRCODE = '42501';
  END IF;

  SELECT j.status
  INTO job_status
  FROM public.jobs j
  WHERE j.id = target_job_id
    AND j.business_id = actor_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repair job not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = target_technician_id
      AND p.business_id = actor_business_id
      AND p.role = 'TECHNICIAN'
      AND p.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Select an active technician from this workshop.'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.assignments
  SET status = 'cancelled'
  WHERE business_id = actor_business_id
    AND job_id = target_job_id
    AND status IN ('assigned', 'in_progress');

  INSERT INTO public.assignments (
    business_id, job_id, technician_id, assigned_by, status
  )
  VALUES (
    actor_business_id, target_job_id, target_technician_id, actor_id, 'assigned'
  )
  RETURNING id INTO assignment_id;

  IF job_status IN ('new_request', 'intake') THEN
    UPDATE public.jobs
    SET status = 'assigned', updated_at = NOW()
    WHERE id = target_job_id
      AND business_id = actor_business_id;
  END IF;

  RETURN assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.convert_service_request_to_job(target_service_request_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_business_id UUID;
  request_row RECORD;
  existing_job_id UUID;
  created_job_id UUID;
BEGIN
  SELECT p.business_id
  INTO actor_business_id
  FROM public.profiles p
  WHERE p.id = actor_id
    AND p.is_active = TRUE
    AND p.role IN ('OWNER_ADMIN', 'DISPATCHER');

  IF actor_business_id IS NULL THEN
    RAISE EXCEPTION 'Only active workshop staff can convert service requests.'
      USING ERRCODE = '42501';
  END IF;

  SELECT r.id, r.customer_id, r.asset_id, r.equipment_category,
         r.brand_model, r.reported_problem
  INTO request_row
  FROM public.service_requests r
  WHERE r.id = target_service_request_id
    AND r.business_id = actor_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service request not found.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT j.id
  INTO existing_job_id
  FROM public.jobs j
  WHERE j.business_id = actor_business_id
    AND j.service_request_id = target_service_request_id
  LIMIT 1;

  IF existing_job_id IS NOT NULL THEN
    RETURN existing_job_id;
  END IF;

  INSERT INTO public.jobs (
    business_id, service_request_id, customer_id, asset_id, status, issue_summary
  )
  VALUES (
    actor_business_id,
    target_service_request_id,
    request_row.customer_id,
    request_row.asset_id,
    'intake',
    BTRIM(request_row.equipment_category || ' - ' || request_row.brand_model || ': ' || request_row.reported_problem)
  )
  RETURNING id INTO created_job_id;

  RETURN created_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_job_diagnosis(
  target_job_id UUID,
  diagnosis_notes TEXT,
  diagnosis_root_cause TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_business_id UUID;
  actor_role TEXT;
  job_row RECORD;
  diagnosis_id UUID;
BEGIN
  IF diagnosis_notes IS NULL OR NULLIF(BTRIM(diagnosis_notes), '') IS NULL
     OR length(diagnosis_notes) > 4000
     OR (diagnosis_root_cause IS NOT NULL AND length(diagnosis_root_cause) > 2000) THEN
    RAISE EXCEPTION 'Diagnosis notes are required and must be within the supported length.'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.business_id, p.role
  INTO actor_business_id, actor_role
  FROM public.profiles p
  WHERE p.id = actor_id
    AND p.is_active = TRUE
    AND p.role IN ('OWNER_ADMIN', 'DISPATCHER', 'TECHNICIAN');

  IF actor_business_id IS NULL THEN
    RAISE EXCEPTION 'Only active workshop staff can record a diagnosis.'
      USING ERRCODE = '42501';
  END IF;

  SELECT j.id, j.status
  INTO job_row
  FROM public.jobs j
  WHERE j.id = target_job_id
    AND j.business_id = actor_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repair job not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF actor_role = 'TECHNICIAN'
     AND NOT private.is_assigned_technician_job(target_job_id) THEN
    RAISE EXCEPTION 'You can only diagnose work assigned to you.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.diagnoses (
    business_id, job_id, technician_id, notes, root_cause
  )
  VALUES (
    actor_business_id, target_job_id, actor_id, BTRIM(diagnosis_notes),
    NULLIF(BTRIM(diagnosis_root_cause), '')
  )
  RETURNING id INTO diagnosis_id;

  UPDATE public.jobs
  SET diagnosis_notes = BTRIM(diagnosis_notes),
      status = CASE
        WHEN job_row.status IN ('new_request', 'intake', 'assigned') THEN 'diagnosis'
        ELSE job_row.status
      END,
      updated_at = NOW()
  WHERE id = target_job_id
    AND business_id = actor_business_id;

  RETURN diagnosis_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_parts_order(
  target_job_id UUID,
  ordered_part_name TEXT,
  ordered_supplier TEXT DEFAULT NULL,
  expected_date DATE DEFAULT NULL,
  visible_note TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_business_id UUID;
  job_status TEXT;
  parts_order_id UUID;
BEGIN
  IF ordered_part_name IS NULL
     OR NULLIF(BTRIM(ordered_part_name), '') IS NULL
     OR length(ordered_part_name) > 200
     OR (ordered_supplier IS NOT NULL AND length(ordered_supplier) > 200)
     OR (visible_note IS NOT NULL AND length(visible_note) > 1000) THEN
    RAISE EXCEPTION 'Part name is required and order details must be within the supported lengths.'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.business_id
  INTO actor_business_id
  FROM public.profiles p
  WHERE p.id = actor_id
    AND p.is_active = TRUE
    AND p.role IN ('OWNER_ADMIN', 'DISPATCHER');

  IF actor_business_id IS NULL THEN
    RAISE EXCEPTION 'Only active workshop staff can order parts.'
      USING ERRCODE = '42501';
  END IF;

  SELECT j.status
  INTO job_status
  FROM public.jobs j
  WHERE j.id = target_job_id
    AND j.business_id = actor_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repair job not found.'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.parts_orders (
    business_id, job_id, part_name, supplier,
    expected_arrival_date, customer_visible_note, status, quantity
  )
  VALUES (
    actor_business_id, target_job_id, BTRIM(ordered_part_name),
    NULLIF(BTRIM(ordered_supplier), ''), expected_date,
    NULLIF(BTRIM(visible_note), ''), 'ordered', 1
  )
  RETURNING id INTO parts_order_id;

  IF job_status = 'in_progress' THEN
    UPDATE public.jobs
    SET status = 'waiting_for_parts', updated_at = NOW()
    WHERE id = target_job_id
      AND business_id = actor_business_id;
  END IF;

  RETURN parts_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_financial_parts_used(target_job_id UUID)
RETURNS TABLE (
  id UUID,
  business_id UUID,
  job_id UUID,
  part_name TEXT,
  part_number TEXT,
  quantity INTEGER,
  unit_cost NUMERIC,
  used_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_business_id UUID;
BEGIN
  SELECT p.business_id
  INTO actor_business_id
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.is_active = TRUE
    AND p.role IN ('OWNER_ADMIN', 'DISPATCHER');

  IF actor_business_id IS NULL THEN
    RAISE EXCEPTION 'Only active owners and dispatchers can view part costs.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT p.id, p.business_id, p.job_id, p.part_name, p.part_number,
         p.quantity, p.unit_cost, p.used_at
  FROM public.parts_used p
  WHERE p.business_id = actor_business_id
    AND p.job_id = target_job_id
  ORDER BY p.used_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_parts_used_cost_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_role TEXT;
  actor_business_id UUID;
BEGIN
  SELECT p.role, p.business_id
  INTO actor_role, actor_business_id
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.is_active = TRUE;

  IF actor_business_id IS NULL OR NEW.business_id <> actor_business_id THEN
    RAISE EXCEPTION 'Part usage must belong to your active workshop.'
      USING ERRCODE = '42501';
  END IF;

  IF actor_role = 'TECHNICIAN' THEN
    IF NEW.unit_cost <> 0 OR NOT private.is_assigned_technician_job(NEW.job_id) THEN
      RAISE EXCEPTION 'Technicians may record parts only on assigned jobs and cannot set costs.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF actor_role NOT IN ('OWNER_ADMIN', 'DISPATCHER') THEN
    RAISE EXCEPTION 'This role cannot record parts used.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS parts_used_cost_access ON public.parts_used;
CREATE TRIGGER parts_used_cost_access
  BEFORE INSERT ON public.parts_used
  FOR EACH ROW EXECUTE FUNCTION private.enforce_parts_used_cost_access();

REVOKE SELECT ON public.parts_used FROM authenticated;
GRANT SELECT (id, business_id, job_id, part_name, part_number, quantity, used_at)
  ON public.parts_used TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_public_service_request(
  target_business_slug TEXT,
  submitted_customer_name TEXT,
  submitted_phone TEXT,
  submitted_email TEXT,
  privacy_accepted BOOLEAN,
  submitted_service_address TEXT,
  submitted_category TEXT,
  submitted_brand_model TEXT,
  submitted_problem TEXT,
  submitted_preferred_appointment TIMESTAMPTZ,
  submitted_visible_condition TEXT,
  submitted_accessories TEXT,
  submitted_access_notes TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_business_id UUID;
  normalized_phone TEXT;
  reference_code TEXT;
BEGIN
  IF target_business_slug IS NULL OR length(target_business_slug) > 100
     OR privacy_accepted IS DISTINCT FROM TRUE
     OR submitted_customer_name IS NULL
     OR length(BTRIM(submitted_customer_name)) < 2
     OR length(submitted_customer_name) > 200
     OR submitted_phone IS NULL
     OR length(BTRIM(submitted_phone)) < 7
     OR length(submitted_phone) > 32
     OR (submitted_email IS NOT NULL AND length(submitted_email) > 254)
     OR (submitted_email IS NOT NULL AND submitted_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
     OR (submitted_service_address IS NOT NULL AND length(submitted_service_address) > 500)
     OR submitted_category IS NULL
     OR length(submitted_category) > 120
     OR submitted_brand_model IS NULL
     OR length(BTRIM(submitted_brand_model)) < 2
     OR length(submitted_brand_model) > 200
     OR submitted_problem IS NULL
     OR length(BTRIM(submitted_problem)) < 10
     OR length(submitted_problem) > 4000
     OR (submitted_visible_condition IS NOT NULL AND length(submitted_visible_condition) > 1000)
     OR (submitted_accessories IS NOT NULL AND length(submitted_accessories) > 1000)
     OR (submitted_access_notes IS NOT NULL AND length(submitted_access_notes) > 1000) THEN
    RAISE EXCEPTION 'One or more intake fields are invalid.'
      USING ERRCODE = '22023';
  END IF;

  SELECT b.id
  INTO target_business_id
  FROM public.businesses b
  WHERE b.slug = target_business_slug;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected workshop is not accepting online requests.'
      USING ERRCODE = 'P0002';
  END IF;

  normalized_phone := regexp_replace(BTRIM(submitted_phone), '[^0-9]', '', 'g');
  IF length(normalized_phone) < 7 OR length(normalized_phone) > 24 THEN
    RAISE EXCEPTION 'A valid contact phone number is required.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(target_business_id::TEXT || ':' || normalized_phone, 0)
  );

  IF (
    SELECT count(*)
    FROM public.service_requests r
    WHERE r.business_id = target_business_id
      AND regexp_replace(r.phone, '[^0-9]', '', 'g') = normalized_phone
      AND r.created_at >= NOW() - INTERVAL '1 hour'
  ) >= 5 THEN
    RAISE EXCEPTION 'Too many requests from this contact number. Please try again later.'
      USING ERRCODE = 'P0001';
  END IF;

  reference_code := 'KF-PUB-' ||
    to_char(NOW(), 'YYMM') || '-' ||
    UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 10));

  INSERT INTO public.service_requests (
    business_id, customer_name, customer_email, phone, equipment_category, brand_model,
    reported_problem, urgency, preferred_appointment, request_reference,
    privacy_consent, submitted_by_customer, service_address,
    visible_condition, accessories_supplied, access_notes
  )
  VALUES (
    target_business_id, BTRIM(submitted_customer_name),
    NULLIF(BTRIM(submitted_email), ''), BTRIM(submitted_phone),
    BTRIM(submitted_category), BTRIM(submitted_brand_model),
    BTRIM(submitted_problem), 'medium', submitted_preferred_appointment,
    reference_code, privacy_accepted, TRUE, NULLIF(BTRIM(submitted_service_address), ''),
    NULLIF(BTRIM(submitted_visible_condition), ''),
    NULLIF(BTRIM(submitted_accessories), ''),
    NULLIF(BTRIM(submitted_access_notes), '')
  );

  RETURN reference_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_quote(
  target_quote_version_id UUID,
  decision TEXT,
  customer_comments TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  customer_profile RECORD;
  quote_row RECORD;
  approval_id UUID;
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
    AND p.is_active = TRUE
    AND p.role = 'CUSTOMER'
    AND p.customer_id IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer profile is not linked to a customer record.'
      USING ERRCODE = '42501';
  END IF;

  SELECT qv.id, qv.job_id
  INTO quote_row
  FROM public.quote_versions qv
  JOIN public.quotes q
    ON q.business_id = qv.business_id
   AND q.quote_version_id = qv.id
   AND q.job_id = qv.job_id
  JOIN public.jobs j
    ON j.business_id = q.business_id
   AND j.id = q.job_id
  WHERE qv.id = target_quote_version_id
    AND qv.business_id = customer_profile.business_id
    AND qv.version_number = (
      SELECT MAX(latest.version_number)
      FROM public.quote_versions latest
      WHERE latest.business_id = customer_profile.business_id
        AND latest.job_id = qv.job_id
    )
    AND q.customer_id = customer_profile.customer_id
    AND j.customer_id = customer_profile.customer_id
    AND qv.status = 'sent'
  FOR UPDATE OF qv;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That quotation version is not available to this customer.'
      USING ERRCODE = '42501';
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

  UPDATE public.quote_versions
  SET status = decision::public.quote_status, updated_at = NOW()
  WHERE id = target_quote_version_id
    AND business_id = customer_profile.business_id;

  UPDATE public.jobs
  SET status = CASE WHEN decision = 'approved' THEN 'assigned' ELSE 'quotation' END,
      updated_at = NOW()
  WHERE id = quote_row.job_id
    AND business_id = customer_profile.business_id
    AND status = 'awaiting_customer_approval';

  INSERT INTO public.activity_logs (
    business_id, actor_id, entity_type, entity_id, action, details
  )
  VALUES (
    customer_profile.business_id, auth.uid(), 'quote_version', quote_row.id,
    CASE WHEN decision = 'approved' THEN 'CUSTOMER_APPROVED_QUOTATION' ELSE 'CUSTOMER_DECLINED_QUOTATION' END,
    jsonb_build_object('decision', decision, 'job_id', quote_row.job_id)
  );

  RETURN approval_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_qc_inspection(
  target_job_id UUID,
  inspection_passed BOOLEAN,
  submitted_checklist JSONB,
  inspection_comments TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_business_id UUID;
  job_row RECORD;
  qc_id UUID;
BEGIN
  IF inspection_passed IS NULL
     OR submitted_checklist IS NULL
     OR jsonb_typeof(submitted_checklist) <> 'object' THEN
    RAISE EXCEPTION 'A pass/fail decision and checklist object are required.'
      USING ERRCODE = '22023';
  END IF;

  IF inspection_comments IS NOT NULL AND length(inspection_comments) > 4000 THEN
    RAISE EXCEPTION 'Comments must be 4000 characters or fewer.'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.business_id
  INTO actor_business_id
  FROM public.profiles p
  WHERE p.id = actor_id
    AND p.is_active = TRUE
    AND p.role IN ('OWNER_ADMIN', 'DISPATCHER', 'QC_REVIEWER');

  IF actor_business_id IS NULL THEN
    RAISE EXCEPTION 'Only active quality-control staff can submit an inspection.'
      USING ERRCODE = '42501';
  END IF;

  SELECT j.id, j.status
  INTO job_row
  FROM public.jobs j
  WHERE j.id = target_job_id
    AND j.business_id = actor_business_id
  FOR UPDATE;

  IF NOT FOUND OR job_row.status <> 'qc_review' THEN
    RAISE EXCEPTION 'Only jobs in quality-control review can be inspected.'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.qc_records (
    business_id, job_id, reviewer_id, passed, checklist, comments
  )
  VALUES (
    actor_business_id, target_job_id, actor_id, inspection_passed,
    submitted_checklist, inspection_comments
  )
  RETURNING id INTO qc_id;

  IF inspection_passed THEN
    UPDATE public.jobs
    SET qc_passed_at = NOW(), updated_at = NOW()
    WHERE id = target_job_id
      AND business_id = actor_business_id;
  ELSE
    UPDATE public.jobs
    SET status = 'in_progress',
        qc_passed_at = NULL,
        rework_count = rework_count + 1,
        rework_notes = NULLIF(
          concat_ws(E'\n', NULLIF(rework_notes, ''), NULLIF(inspection_comments, '')),
          ''
        ),
        updated_at = NOW()
    WHERE id = target_job_id
      AND business_id = actor_business_id;
  END IF;

  INSERT INTO public.activity_logs (
    business_id, actor_id, entity_type, entity_id, action, details
  )
  VALUES (
    actor_business_id, actor_id, 'job', target_job_id, 'QC_INSPECTION_RECORDED',
    jsonb_build_object('qc_record_id', qc_id, 'passed', inspection_passed)
  );

  RETURN qc_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_invoice_from_job(target_job_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_business_id UUID;
  job_row RECORD;
  quote_row RECORD;
  invoice_id UUID;
BEGIN
  SELECT p.business_id
  INTO actor_business_id
  FROM public.profiles p
  WHERE p.id = actor_id
    AND p.is_active = TRUE
    AND p.role IN ('OWNER_ADMIN', 'DISPATCHER');

  IF actor_business_id IS NULL THEN
    RAISE EXCEPTION 'Only active workshop staff can create invoices.'
      USING ERRCODE = '42501';
  END IF;

  SELECT j.id
  INTO job_row
  FROM public.jobs j
  WHERE j.id = target_job_id
    AND j.business_id = actor_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repair job not found.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT i.id
  INTO invoice_id
  FROM public.invoices i
  WHERE i.business_id = actor_business_id
    AND i.job_id = target_job_id
  ORDER BY i.created_at
  LIMIT 1
  FOR UPDATE;

  IF invoice_id IS NOT NULL THEN
    RETURN invoice_id;
  END IF;

  SELECT qv.id, qv.total_amount
  INTO quote_row
  FROM public.quote_versions qv
  WHERE qv.business_id = actor_business_id
    AND qv.job_id = target_job_id
    AND qv.status = 'approved'
  ORDER BY qv.version_number DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An approved quotation is required before creating an invoice.'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.invoices (
    business_id, job_id, quote_version_id, invoice_number, total_amount, payment_status
  )
  VALUES (
    actor_business_id,
    target_job_id,
    quote_row.id,
    'INV-' || to_char(NOW(), 'YYYY') || '-' ||
      UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 8)),
    quote_row.total_amount,
    'pending'
  )
  RETURNING id INTO invoice_id;

  INSERT INTO public.activity_logs (
    business_id, actor_id, entity_type, entity_id, action, details
  )
  VALUES (
    actor_business_id, actor_id, 'invoice', target_job_id, 'GENERATE_INVOICE',
    jsonb_build_object(
      'invoice_id', invoice_id,
      'quote_version_id', quote_row.id,
      'total_amount', quote_row.total_amount
    )
  );

  RETURN invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_manual_invoice_payment(
  target_job_id UUID,
  payment_amount NUMERIC,
  payment_method TEXT,
  target_request_key UUID,
  payment_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_business_id UUID;
  invoice_row RECORD;
  existing_payment RECORD;
  paid_so_far NUMERIC(12, 2);
  payment_id UUID;
BEGIN
  IF target_request_key IS NULL THEN
    RAISE EXCEPTION 'A payment request key is required.'
      USING ERRCODE = '22023';
  END IF;

  IF payment_amount IS NULL OR payment_amount <= 0
     OR payment_amount > 9999999999.99
     OR payment_amount <> ROUND(payment_amount, 2) THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero and within the supported range.'
      USING ERRCODE = '22023';
  END IF;

  IF payment_method IS NULL OR payment_method NOT IN ('cash', 'card', 'bank_transfer', 'cheque', 'mobile_pay', 'other') THEN
    RAISE EXCEPTION 'Invalid payment method.'
      USING ERRCODE = '22023';
  END IF;

  IF payment_notes IS NOT NULL AND length(payment_notes) > 2000 THEN
    RAISE EXCEPTION 'Payment notes must be 2000 characters or fewer.'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.business_id
  INTO actor_business_id
  FROM public.profiles p
  WHERE p.id = actor_id
    AND p.is_active = TRUE
    AND p.role IN ('OWNER_ADMIN', 'DISPATCHER');

  IF actor_business_id IS NULL THEN
    RAISE EXCEPTION 'Only active workshop staff can record payments.'
      USING ERRCODE = '42501';
  END IF;

  SELECT i.id, i.total_amount, i.payment_status
  INTO invoice_row
  FROM public.invoices i
  WHERE i.business_id = actor_business_id
    AND i.job_id = target_job_id
  ORDER BY i.created_at
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Create an invoice before recording a payment.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(actor_business_id::TEXT || ':' || target_request_key::TEXT, 0)
  );

  SELECT p.id, p.job_id, p.invoice_id, p.amount, p.payment_method,
         p.notes, p.recorded_by
  INTO existing_payment
  FROM public.payments p
  WHERE p.business_id = actor_business_id
    AND p.payment_request_key = target_request_key;

  IF FOUND THEN
    IF existing_payment.job_id IS DISTINCT FROM target_job_id
       OR existing_payment.invoice_id IS DISTINCT FROM invoice_row.id
       OR existing_payment.amount IS DISTINCT FROM payment_amount
       OR existing_payment.payment_method IS DISTINCT FROM payment_method
       OR existing_payment.notes IS DISTINCT FROM payment_notes
       OR existing_payment.recorded_by IS DISTINCT FROM actor_id THEN
      RAISE EXCEPTION 'This payment request key was already used for a different payment.'
        USING ERRCODE = '23505';
    END IF;
    RETURN existing_payment.id;
  END IF;

  IF invoice_row.payment_status = 'waived' THEN
    RAISE EXCEPTION 'Payments cannot be recorded against a waived invoice.'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(p.amount), 0)
  INTO paid_so_far
  FROM public.payments p
  WHERE p.business_id = actor_business_id
    AND p.invoice_id = invoice_row.id;

  IF payment_amount > invoice_row.total_amount - paid_so_far THEN
    RAISE EXCEPTION 'Payment exceeds the remaining invoice balance.'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.payments (
    business_id, job_id, invoice_id, payment_request_key,
    amount, payment_method, notes, recorded_by
  )
  VALUES (
    actor_business_id, target_job_id, invoice_row.id, target_request_key,
    payment_amount, payment_method, payment_notes, actor_id
  )
  RETURNING id INTO payment_id;

  paid_so_far := paid_so_far + payment_amount;

  UPDATE public.invoices
  SET payment_status = CASE
        WHEN paid_so_far >= total_amount THEN 'paid'
        ELSE 'partially_paid'
      END,
      updated_at = NOW()
  WHERE id = invoice_row.id
    AND business_id = actor_business_id;

  INSERT INTO public.activity_logs (
    business_id, actor_id, entity_type, entity_id, action, details
  )
  VALUES (
    actor_business_id, actor_id, 'payment', target_job_id,
    'RECORD_MANUAL_PAYMENT',
    jsonb_build_object(
      'amount', payment_amount,
      'payment_method', payment_method,
      'total_paid', paid_so_far,
      'balance_remaining', GREATEST(0, invoice_row.total_amount - paid_so_far)
    )
  );

  RETURN payment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_staff_follow_up_outcome(
  target_follow_up_id UUID,
  outcome_key TEXT,
  staff_notes TEXT DEFAULT NULL,
  has_privacy_consent BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_business_id UUID;
  follow_up_row RECORD;
  saved_outcome public.repair_outcome;
  outcome_id UUID;
BEGIN
  IF outcome_key IS NULL
     OR outcome_key NOT IN ('working', 'same_symptom', 'partly', 'different_issue', 'no_response') THEN
    RAISE EXCEPTION 'Invalid outcome category.'
      USING ERRCODE = '22023';
  END IF;

  IF staff_notes IS NOT NULL AND length(staff_notes) > 4000 THEN
    RAISE EXCEPTION 'Notes must be 4000 characters or fewer.'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.business_id
  INTO actor_business_id
  FROM public.profiles p
  WHERE p.id = actor_id
    AND p.is_active = TRUE
    AND p.role IN ('OWNER_ADMIN', 'DISPATCHER');

  IF actor_business_id IS NULL THEN
    RAISE EXCEPTION 'Only active workshop staff can record follow-up outcomes.'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    f.id, f.status, f.reminder_count, f.job_id,
    j.customer_id, j.asset_id, j.issue_summary,
    c.full_name, c.phone, a.category, a.brand, a.model
  INTO follow_up_row
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
  WHERE f.id = target_follow_up_id
    AND f.business_id = actor_business_id
  FOR UPDATE OF f;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Follow-up record not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF follow_up_row.status NOT IN ('scheduled', 'sent', 'overdue', 'unknown') THEN
    RAISE EXCEPTION 'This follow-up has already been completed.'
      USING ERRCODE = '23514';
  END IF;

  IF outcome_key = 'no_response' THEN
    IF follow_up_row.status = 'scheduled' THEN
      UPDATE public.follow_ups
      SET status = 'sent', updated_at = NOW()
      WHERE id = target_follow_up_id
        AND business_id = actor_business_id;
    ELSIF follow_up_row.status = 'sent' AND follow_up_row.reminder_count < 1 THEN
      UPDATE public.follow_ups
      SET status = 'unknown',
          reminder_count = reminder_count + 1,
          updated_at = NOW()
      WHERE id = target_follow_up_id
        AND business_id = actor_business_id;
    ELSE
      RAISE EXCEPTION 'The initial contact and one reminder have already been recorded.'
        USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.activity_logs (
      business_id, actor_id, entity_type, entity_id, action, details
    )
    VALUES (
      actor_business_id, actor_id, 'follow_up', target_follow_up_id,
      'FOLLOW_UP_NO_RESPONSE',
      jsonb_build_object('status', CASE
        WHEN follow_up_row.status = 'scheduled' THEN 'sent'
        ELSE 'unknown'
      END)
    );

    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.outcomes o
    WHERE o.business_id = actor_business_id
      AND o.follow_up_id = target_follow_up_id
      AND o.outcome <> 'no_response'::public.repair_outcome
  ) THEN
    RAISE EXCEPTION 'A final customer outcome has already been recorded.'
      USING ERRCODE = '23505';
  END IF;

  IF outcome_key = 'different_issue'
     AND (NOT has_privacy_consent OR NULLIF(BTRIM(staff_notes), '') IS NULL) THEN
    RAISE EXCEPTION 'A problem description and privacy consent are required for a new service request.'
      USING ERRCODE = '22023';
  END IF;

  IF outcome_key = 'different_issue'
     AND NULLIF(BTRIM(follow_up_row.phone), '') IS NULL THEN
    RAISE EXCEPTION 'A contact phone number is required to create a new service request.'
      USING ERRCODE = '23514';
  END IF;

  saved_outcome := CASE outcome_key
    WHEN 'working' THEN 'working_as_expected'::public.repair_outcome
    WHEN 'partly' THEN 'partly_improved'::public.repair_outcome
    ELSE outcome_key::public.repair_outcome
  END;

  INSERT INTO public.outcomes (
    business_id, follow_up_id, customer_id, outcome, notes
  )
  VALUES (
    actor_business_id, target_follow_up_id,
    follow_up_row.customer_id, saved_outcome, staff_notes
  )
  RETURNING id INTO outcome_id;

  UPDATE public.follow_ups
  SET status = 'completed', updated_at = NOW()
  WHERE id = target_follow_up_id
    AND business_id = actor_business_id;

  IF outcome_key = 'same_symptom' THEN
    INSERT INTO public.comeback_cases (
      business_id, original_job_id, customer_id, issue_summary,
      linked_follow_up_id, status
    )
    VALUES (
      actor_business_id,
      follow_up_row.job_id,
      follow_up_row.customer_id,
      COALESCE(NULLIF(BTRIM(staff_notes), ''), follow_up_row.issue_summary),
      target_follow_up_id,
      'needs_review'
    );
  ELSIF outcome_key = 'different_issue' THEN
    INSERT INTO public.service_requests (
      business_id, customer_id, asset_id, source_follow_up_id,
      customer_name, phone, equipment_category, brand_model,
      reported_problem, urgency, request_reference, privacy_consent,
      submitted_by_customer
    )
    VALUES (
      actor_business_id,
      follow_up_row.customer_id,
      follow_up_row.asset_id,
      target_follow_up_id,
      follow_up_row.full_name,
      follow_up_row.phone,
      COALESCE(follow_up_row.category, 'Other'),
      COALESCE(
        NULLIF(BTRIM(CONCAT_WS(' ', follow_up_row.brand, follow_up_row.model)), ''),
        follow_up_row.category,
        'Equipment'
      ),
      BTRIM(staff_notes),
      'medium',
      'KA-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 10)),
      TRUE,
      FALSE
    );
  END IF;

  INSERT INTO public.activity_logs (
    business_id, actor_id, entity_type, entity_id, action, details
  )
  VALUES (
    actor_business_id, actor_id, 'follow_up', target_follow_up_id,
    'RECORD_FOLLOW_UP_OUTCOME',
    jsonb_build_object('outcome', saved_outcome, 'notes', staff_notes, 'job_id', follow_up_row.job_id)
  );

  RETURN outcome_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_customer_tracking_token(
  target_job_id UUID,
  token_digest TEXT,
  token_expiry TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_business_id UUID;
  actor_name TEXT;
  new_token_id UUID;
BEGIN
  IF token_digest IS NULL
     OR token_digest !~ '^[0-9a-f]{64}$'
     OR token_expiry IS NULL
     OR token_expiry <= NOW()
     OR token_expiry > NOW() + INTERVAL '31 days' THEN
    RAISE EXCEPTION 'Invalid tracking-token settings.'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.business_id, p.full_name
  INTO actor_business_id, actor_name
  FROM public.profiles p
  WHERE p.id = actor_id
    AND p.is_active = TRUE
    AND p.role IN ('OWNER_ADMIN', 'DISPATCHER');

  IF actor_business_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.jobs j
    WHERE j.id = target_job_id
      AND j.business_id = actor_business_id
  ) THEN
    RAISE EXCEPTION 'Repair job not found for this workshop.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.customer_tracking_tokens
  SET revoked_at = NOW()
  WHERE business_id = actor_business_id
    AND job_id = target_job_id
    AND revoked_at IS NULL;

  INSERT INTO public.customer_tracking_tokens (
    business_id, job_id, token_hash, expires_at, created_by
  )
  VALUES (
    actor_business_id, target_job_id, token_digest, token_expiry, actor_id
  )
  RETURNING id INTO new_token_id;

  INSERT INTO public.activity_logs (
    business_id, actor_id, entity_type, entity_id, action, details
  )
  VALUES (
    actor_business_id, actor_id, 'job', target_job_id,
    'GENERATE_TRACKING_LINK',
    jsonb_build_object('expires_at', token_expiry, 'generated_by', actor_name)
  );

  RETURN new_token_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_customer_tracking_token(
  target_token_id UUID,
  target_job_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_business_id UUID;
  actor_name TEXT;
BEGIN
  SELECT p.business_id, p.full_name
  INTO actor_business_id, actor_name
  FROM public.profiles p
  WHERE p.id = actor_id
    AND p.is_active = TRUE
    AND p.role IN ('OWNER_ADMIN', 'DISPATCHER');

  IF actor_business_id IS NULL THEN
    RAISE EXCEPTION 'Only active workshop staff can revoke a tracking link.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.customer_tracking_tokens
  SET revoked_at = NOW()
  WHERE id = target_token_id
    AND job_id = target_job_id
    AND business_id = actor_business_id
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active tracking link not found.'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.activity_logs (
    business_id, actor_id, entity_type, entity_id, action, details
  )
  VALUES (
    actor_business_id, actor_id, 'job', target_job_id,
    'REVOKE_TRACKING_LINK',
    jsonb_build_object('token_id', target_token_id, 'revoked_by', actor_name)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_job_tracking(target_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  token_rec RECORD;
  result JSONB;
  token_digest TEXT;
BEGIN
  IF target_token IS NULL OR BTRIM(target_token) = '' OR length(target_token) > 128 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid tracking token.');
  END IF;

  token_digest := private.hash_tracking_token(target_token);

  SELECT t.id, t.job_id, t.business_id, t.expires_at, t.revoked_at,
         t.token_hash, t.token_hash_version
  INTO token_rec
  FROM public.customer_tracking_tokens t
  WHERE (t.token_hash_version = 1 AND t.token_hash = token_digest)
     OR (t.token_hash_version = 0 AND t.token_hash IN (target_token, token_digest))
  ORDER BY CASE WHEN t.token_hash = token_digest THEN 0 ELSE 1 END
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tracking link not found or invalid.');
  END IF;

  IF token_rec.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This tracking link has been revoked by the workshop.');
  END IF;

  IF token_rec.token_hash_version = 0 THEN
    UPDATE public.customer_tracking_tokens
    SET token_hash = CASE
          WHEN token_rec.token_hash = target_token THEN token_digest
          ELSE token_rec.token_hash
        END,
        token_hash_version = 1
    WHERE id = token_rec.id
      AND business_id = token_rec.business_id;
  END IF;

  IF token_rec.expires_at < NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'This tracking link has expired.');
  END IF;

  SELECT jsonb_build_object(
    'success', TRUE,
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
        AND po.business_id = j.business_id
      ORDER BY po.created_at DESC
      LIMIT 1
    ),
    'quote_summary', (
      SELECT jsonb_build_object('total', qv.total_amount, 'status', qv.status)
      FROM public.quote_versions qv
      WHERE qv.job_id = j.id
        AND qv.business_id = j.business_id
        AND qv.version_number = (
          SELECT MAX(latest.version_number)
          FROM public.quote_versions latest
          WHERE latest.business_id = j.business_id
            AND latest.job_id = j.id
        )
        AND qv.status = 'approved'
      ORDER BY qv.version_number DESC
      LIMIT 1
    )
  )
  INTO result
  FROM public.jobs j
  JOIN public.businesses b ON b.id = j.business_id
  LEFT JOIN public.assets a
    ON a.id = j.asset_id
   AND a.business_id = j.business_id
  WHERE j.id = token_rec.job_id
    AND j.business_id = token_rec.business_id;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_job_workflow_requirements()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_role TEXT;
  latest_quote_status public.quote_status;
  latest_qc_passed BOOLEAN;
BEGIN
  SELECT p.role
  INTO actor_role
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.business_id = NEW.business_id
    AND p.is_active = TRUE;

  IF TG_OP = 'INSERT' THEN
    IF actor_role IS NULL
       OR actor_role NOT IN ('OWNER_ADMIN', 'DISPATCHER')
       OR NEW.status NOT IN ('new_request', 'intake', 'diagnosis')
       OR NEW.quote_required IS FALSE
       OR NEW.quote_waiver_reason IS NOT NULL
       OR NEW.quote_waiver_by IS NOT NULL
       OR NEW.qc_passed_at IS NOT NULL
       OR NEW.qc_override_reason IS NOT NULL
       OR NEW.qc_override_by IS NOT NULL THEN
      RAISE EXCEPTION 'New repair jobs must start in intake or diagnosis without workflow overrides.'
        USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.activity_logs (
      business_id, actor_id, entity_type, entity_id, action, details
    )
    VALUES (
      NEW.business_id, auth.uid(), 'job', NEW.id, 'CREATE_JOB',
      jsonb_build_object('status', NEW.status)
    );
    RETURN NEW;
  END IF;

  IF OLD.quote_required IS TRUE AND NEW.quote_required IS FALSE
     AND NOT (
       actor_role = 'OWNER_ADMIN'
       AND NULLIF(BTRIM(NEW.quote_waiver_reason), '') IS NOT NULL
       AND NEW.quote_waiver_by = auth.uid()
     ) THEN
    RAISE EXCEPTION 'Only an owner may waive a required quotation with a documented reason.'
      USING ERRCODE = '23514';
  END IF;

  IF actor_role = 'TECHNICIAN' THEN
    IF (to_jsonb(NEW) - ARRAY['status', 'updated_at', 'diagnosis_notes'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'updated_at', 'diagnosis_notes'])
       OR NEW.status NOT IN ('diagnosis', 'in_progress', 'waiting_for_parts', 'qc_review') THEN
      RAISE EXCEPTION 'Technicians may only update the status of assigned work.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'in_progress'
     AND COALESCE(NEW.quote_required, TRUE) THEN
    SELECT qv.status
    INTO latest_quote_status
    FROM public.quote_versions qv
    WHERE qv.business_id = NEW.business_id
      AND qv.job_id = NEW.id
    ORDER BY qv.version_number DESC
    LIMIT 1;

    IF latest_quote_status IS DISTINCT FROM 'approved'::public.quote_status
       AND NOT (
         actor_role = 'OWNER_ADMIN'
         AND NULLIF(BTRIM(NEW.quote_waiver_reason), '') IS NOT NULL
         AND NEW.quote_waiver_by = auth.uid()
       ) THEN
      RAISE EXCEPTION 'Quotation Approval Required: approved quotation or documented owner waiver required.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('completed', 'handover') THEN
    SELECT qc.passed
    INTO latest_qc_passed
    FROM public.qc_records qc
    WHERE qc.business_id = NEW.business_id
      AND qc.job_id = NEW.id
    ORDER BY qc.created_at DESC, qc.id DESC
    LIMIT 1;

    IF latest_qc_passed IS DISTINCT FROM TRUE
       AND NOT (
         actor_role = 'OWNER_ADMIN'
         AND NULLIF(BTRIM(NEW.qc_override_reason), '') IS NOT NULL
         AND NEW.qc_override_by = auth.uid()
       ) THEN
      RAISE EXCEPTION 'Quality Control Required: latest QC inspection must pass or an owner must record an override reason.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.activity_logs (
      business_id, actor_id, entity_type, entity_id, action, details
    )
    VALUES (
      NEW.business_id, auth.uid(), 'job', NEW.id, 'JOB_STATUS_CHANGED',
      jsonb_build_object(
        'previous_status', OLD.status,
        'new_status', NEW.status,
        'quote_waiver_reason', NEW.quote_waiver_reason,
        'qc_override_reason', NEW.qc_override_reason
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_workflow_requirements ON public.jobs;
CREATE TRIGGER jobs_workflow_requirements
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_job_workflow_requirements();

CREATE OR REPLACE FUNCTION private.audit_business_settings_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['updated_at']) THEN
    INSERT INTO public.activity_logs (
      business_id, actor_id, entity_type, entity_id, action, details
    )
    VALUES (
      NEW.id, auth.uid(), 'business', NEW.id, 'BUSINESS_SETTINGS_UPDATED',
      jsonb_build_object(
        'name_changed', NEW.name IS DISTINCT FROM OLD.name,
        'operating_hours_changed', NEW.operating_hours IS DISTINCT FROM OLD.operating_hours,
        'service_categories_changed', NEW.service_categories IS DISTINCT FROM OLD.service_categories,
        'coverage_notes_changed', NEW.coverage_notes IS DISTINCT FROM OLD.coverage_notes,
        'follow_up_interval_days_changed',
          NEW.follow_up_interval_days IS DISTINCT FROM OLD.follow_up_interval_days,
        'observation_window_days_changed',
          NEW.observation_window_days IS DISTINCT FROM OLD.observation_window_days
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.audit_profile_permission_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    INSERT INTO public.activity_logs (
      business_id, actor_id, entity_type, entity_id, action, details
    )
    VALUES (
      NEW.business_id, auth.uid(), 'profile', NEW.id,
      CASE
        WHEN NEW.role IS DISTINCT FROM OLD.role THEN 'TEAM_MEMBER_ROLE_CHANGED'
        WHEN NEW.is_active THEN 'TEAM_MEMBER_ACTIVATED'
        ELSE 'TEAM_MEMBER_DEACTIVATED'
      END,
      jsonb_build_object('previous_role', OLD.role, 'new_role', NEW.role, 'is_active', NEW.is_active)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.audit_parts_order_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.activity_logs (
    business_id, actor_id, entity_type, entity_id, action, details
  )
  VALUES (
    NEW.business_id, auth.uid(), 'job', NEW.job_id, 'PARTS_ORDER_RECORDED',
    jsonb_build_object(
      'part_name', NEW.part_name,
      'supplier', NEW.supplier,
      'expected_arrival', NEW.expected_arrival_date
    )
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.audit_complaint_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.activity_logs (
    business_id, actor_id, entity_type, entity_id, action, details
  )
  VALUES (
    NEW.business_id, auth.uid(), 'job', NEW.job_id, 'COMPLAINT_LOGGED',
    jsonb_build_object('customer_id', NEW.customer_id, 'complaint_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.audit_service_request_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.activity_logs (
    business_id, actor_id, entity_type, entity_id, action, details
  )
  VALUES (
    NEW.business_id, auth.uid(), 'service_request', NEW.id, 'SERVICE_REQUEST_CREATED',
    jsonb_build_object(
      'request_reference', NEW.request_reference,
      'submitted_by_customer', NEW.submitted_by_customer
    )
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.audit_assignment_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.activity_logs (
      business_id, actor_id, entity_type, entity_id, action, details
    )
    VALUES (
      NEW.business_id, auth.uid(), 'job', NEW.job_id,
      'TECHNICIAN_ASSIGNED',
      jsonb_build_object('technician_id', NEW.technician_id, 'status', NEW.status)
    );
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.activity_logs (
      business_id, actor_id, entity_type, entity_id, action, details
    )
    VALUES (
      NEW.business_id, auth.uid(), 'job', NEW.job_id, 'ASSIGNMENT_STATUS_CHANGED',
      jsonb_build_object('technician_id', NEW.technician_id, 'status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS businesses_audit_settings_change ON public.businesses;
CREATE TRIGGER businesses_audit_settings_change
  AFTER UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION private.audit_business_settings_change();

DROP TRIGGER IF EXISTS profiles_audit_permissions_change ON public.profiles;
CREATE TRIGGER profiles_audit_permissions_change
  AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.audit_profile_permission_change();

DROP TRIGGER IF EXISTS parts_orders_audit_insert ON public.parts_orders;
CREATE TRIGGER parts_orders_audit_insert
  AFTER INSERT ON public.parts_orders
  FOR EACH ROW EXECUTE FUNCTION private.audit_parts_order_insert();

DROP TRIGGER IF EXISTS complaints_audit_insert ON public.complaints;
CREATE TRIGGER complaints_audit_insert
  AFTER INSERT ON public.complaints
  FOR EACH ROW EXECUTE FUNCTION private.audit_complaint_insert();

DROP TRIGGER IF EXISTS service_requests_audit_insert ON public.service_requests;
CREATE TRIGGER service_requests_audit_insert
  AFTER INSERT ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION private.audit_service_request_insert();

DROP TRIGGER IF EXISTS assignments_audit_change ON public.assignments;
CREATE TRIGGER assignments_audit_change
  AFTER INSERT OR UPDATE ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION private.audit_assignment_change();

DROP POLICY IF EXISTS jobs_update_assigned_technician ON public.jobs;
CREATE POLICY jobs_update_assigned_technician ON public.jobs
  FOR UPDATE TO authenticated
  USING (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['TECHNICIAN'])
    AND private.is_assigned_technician_job(id)
  )
  WITH CHECK (
    business_id = private.current_business_id()
    AND private.has_role(ARRAY['TECHNICIAN'])
    AND private.is_assigned_technician_job(id)
  );

REVOKE ALL ON FUNCTION public.send_quote_version(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_my_follow_up_outcome(UUID, public.repair_outcome, TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_staff_quote_decision(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_job_to_technician(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.convert_service_request_to_job(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_job_diagnosis(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_parts_order(UUID, TEXT, TEXT, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_financial_parts_used(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_public_service_request(TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.submit_qc_inspection(UUID, BOOLEAN, JSONB, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_invoice_from_job(UUID) FROM PUBLIC, anon;
DO $$
BEGIN
  IF to_regprocedure('public.record_manual_invoice_payment(uuid,numeric,text,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.record_manual_invoice_payment(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.record_manual_invoice_payment(UUID, NUMERIC, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_staff_follow_up_outcome(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_customer_tracking_token(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_customer_tracking_token(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_public_job_tracking(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.send_quote_version(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_my_follow_up_outcome(UUID, public.repair_outcome, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_staff_quote_decision(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_job_to_technician(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_service_request_to_job(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_job_diagnosis(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_parts_order(UUID, TEXT, TEXT, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_financial_parts_used(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_public_service_request(TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_qc_inspection(UUID, BOOLEAN, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_job(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_manual_invoice_payment(UUID, NUMERIC, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_staff_follow_up_outcome(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_tracking_token(UUID, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_customer_tracking_token(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_job_tracking(TEXT) TO anon, authenticated;
