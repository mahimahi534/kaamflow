-- ============================================================================
-- KAAMFLOW ADDITIVE MIGRATION: HANDOVER PAYMENT GUARD
-- Migration: 20261118110000_kaamflow_handover_payment_guard.sql
-- Depends on: core, MVP completion, and workflow hardening migrations.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.handover_payment_overrides (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_id                UUID NOT NULL,
  target_status         public.job_status NOT NULL
                        CHECK (target_status IN ('handover', 'closed')),
  invoice_ids           UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  invoice_missing       BOOLEAN NOT NULL DEFAULT FALSE,
  outstanding_amount   NUMERIC(12, 2) NOT NULL DEFAULT 0
                        CHECK (outstanding_amount >= 0),
  reason                TEXT NOT NULL
                        CHECK (length(btrim(reason)) BETWEEN 10 AND 1000),
  authorized_by         UUID,
  authorization_txid    BIGINT NOT NULL DEFAULT txid_current(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at           TIMESTAMPTZ,
  consumed_by_status    public.job_status,
  CONSTRAINT handover_payment_override_job_same_business
    FOREIGN KEY (business_id, job_id)
    REFERENCES public.jobs (business_id, id)
    ON DELETE CASCADE,
  CONSTRAINT handover_payment_override_actor_same_business
    FOREIGN KEY (business_id, authorized_by)
    REFERENCES public.profiles (business_id, id)
    ON DELETE SET NULL (authorized_by),
  CONSTRAINT handover_payment_override_consumption_check
    CHECK (
      (consumed_at IS NULL AND consumed_by_status IS NULL)
      OR (consumed_at IS NOT NULL AND consumed_by_status = target_status)
    ),
  CONSTRAINT handover_payment_override_invoice_ids_check
    CHECK (invoice_missing = (cardinality(invoice_ids) = 0)),
  CONSTRAINT handover_payment_override_actor_retention_check
    CHECK (authorized_by IS NOT NULL OR consumed_at IS NOT NULL)
);

ALTER TABLE public.handover_payment_overrides ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.handover_payment_overrides
  FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_handover_payment_overrides_pending
  ON public.handover_payment_overrides
    (authorization_txid, business_id, job_id, target_status)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_handover_payment_overrides_business_job
  ON public.handover_payment_overrides
    (business_id, job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.handover_transition_authorizations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_id             UUID NOT NULL,
  target_status      public.job_status NOT NULL
                     CHECK (target_status IN ('handover', 'closed')),
  authorized_by      UUID NOT NULL,
  authorization_txid BIGINT NOT NULL DEFAULT txid_current(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at        TIMESTAMPTZ,
  CONSTRAINT handover_transition_authorization_job_same_business
    FOREIGN KEY (business_id, job_id)
    REFERENCES public.jobs (business_id, id)
    ON DELETE CASCADE,
  CONSTRAINT handover_transition_authorization_actor_same_business
    FOREIGN KEY (business_id, authorized_by)
    REFERENCES public.profiles (business_id, id)
    ON DELETE CASCADE
);

ALTER TABLE public.handover_transition_authorizations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.handover_transition_authorizations
  FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_handover_transition_authorizations_pending
  ON public.handover_transition_authorizations
    (authorization_txid, business_id, job_id, target_status)
  WHERE consumed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_business_job_id
  ON public.invoices (business_id, job_id, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.payments'::regclass
      AND conname = 'payments_invoice_job_same_business'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_invoice_job_same_business
      FOREIGN KEY (business_id, job_id, invoice_id)
      REFERENCES public.invoices (business_id, job_id, id)
      ON DELETE SET NULL (invoice_id)
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.payments
  VALIDATE CONSTRAINT payments_invoice_job_same_business;

CREATE OR REPLACE FUNCTION private.get_job_handover_billing_state(
  target_business_id UUID,
  target_job_id UUID
)
RETURNS TABLE (
  invoice_count BIGINT,
  invoice_ids UUID[],
  outstanding_balance NUMERIC,
  waived_with_balance BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM i.id
  FROM public.invoices i
  WHERE i.business_id = target_business_id
    AND i.job_id = target_job_id
  ORDER BY i.id
  FOR UPDATE;

  RETURN QUERY
  SELECT
    COUNT(i.id),
    COALESCE(array_agg(i.id ORDER BY i.id), ARRAY[]::UUID[]),
    COALESCE(
      SUM(GREATEST(i.total_amount - COALESCE(paid.total_paid, 0), 0)),
      0
    ),
    COALESCE(
      BOOL_OR(
        i.payment_status = 'waived'
        AND GREATEST(i.total_amount - COALESCE(paid.total_paid, 0), 0) > 0
      ),
      FALSE
    )
  FROM public.invoices i
  LEFT JOIN LATERAL (
    SELECT SUM(p.amount) AS total_paid
    FROM public.payments p
    WHERE p.business_id = i.business_id
      AND p.invoice_id = i.id
  ) paid ON TRUE
  WHERE i.business_id = target_business_id
    AND i.job_id = target_job_id;
END;
$$;

REVOKE ALL ON FUNCTION private.get_job_handover_billing_state(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.transition_job_to_handover(
  target_job_id UUID,
  target_status public.job_status,
  payment_override_reason TEXT DEFAULT NULL,
  qc_override_reason TEXT DEFAULT NULL
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
  current_status public.job_status;
  billing_state RECORD;
  requires_payment_override BOOLEAN;
  transition_authorization_id UUID;
  normalized_payment_reason TEXT := NULLIF(BTRIM(payment_override_reason), '');
  normalized_qc_reason TEXT := NULLIF(BTRIM(qc_override_reason), '');
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.'
      USING ERRCODE = '42501';
  END IF;

  IF target_status IS NULL OR target_status NOT IN ('handover', 'closed') THEN
    RAISE EXCEPTION 'Only handover or closed transitions are accepted.'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.business_id, p.role
  INTO actor_business_id, actor_role
  FROM public.profiles p
  WHERE p.id = actor_id
    AND p.is_active = TRUE
    AND p.role IN ('OWNER_ADMIN', 'DISPATCHER');

  IF actor_business_id IS NULL THEN
    RAISE EXCEPTION 'Only active Owners and Service Desk staff may request handover.'
      USING ERRCODE = '42501';
  END IF;

  SELECT j.status
  INTO current_status
  FROM public.jobs j
  WHERE j.id = target_job_id
    AND j.business_id = actor_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repair job not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF current_status = target_status THEN
    RETURN target_job_id;
  END IF;

  SELECT *
  INTO billing_state
  FROM private.get_job_handover_billing_state(actor_business_id, target_job_id);

  IF billing_state.waived_with_balance THEN
    RAISE EXCEPTION 'A waived invoice with an outstanding ledger balance cannot be handed over.'
      USING ERRCODE = '23514';
  END IF;

  requires_payment_override :=
    billing_state.invoice_count = 0
    OR billing_state.outstanding_balance > 0;

  IF payment_override_reason IS NOT NULL
     AND normalized_payment_reason IS NULL THEN
    RAISE EXCEPTION 'A payment override reason cannot be empty.'
      USING ERRCODE = '22023';
  END IF;

  IF payment_override_reason IS NOT NULL
     AND actor_role IS DISTINCT FROM 'OWNER_ADMIN' THEN
    RAISE EXCEPTION 'Only an active Owner may override handover billing requirements.'
      USING ERRCODE = '42501';
  END IF;

  IF requires_payment_override THEN
    IF actor_role IS DISTINCT FROM 'OWNER_ADMIN' THEN
      RAISE EXCEPTION 'Handover requires a recorded invoice balance override.'
        USING ERRCODE = '42501';
    END IF;

    IF normalized_payment_reason IS NULL
       OR length(normalized_payment_reason) < 10
       OR length(normalized_payment_reason) > 1000 THEN
      RAISE EXCEPTION 'An Owner override reason between 10 and 1000 characters is required.'
        USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.handover_payment_overrides (
      business_id,
      job_id,
      target_status,
      invoice_ids,
      invoice_missing,
      outstanding_amount,
      reason,
      authorized_by
    )
    VALUES (
      actor_business_id,
      target_job_id,
      target_status,
      billing_state.invoice_ids,
      billing_state.invoice_count = 0,
      billing_state.outstanding_balance,
      normalized_payment_reason,
      actor_id
    );
  ELSIF normalized_payment_reason IS NOT NULL THEN
    RAISE EXCEPTION 'A payment override is not needed when the ledger balance is zero.'
      USING ERRCODE = '22023';
  END IF;

  IF qc_override_reason IS NOT NULL
     AND normalized_qc_reason IS NULL THEN
    RAISE EXCEPTION 'A QC override reason cannot be empty.'
      USING ERRCODE = '22023';
  END IF;

  IF normalized_qc_reason IS NOT NULL THEN
    IF actor_role IS DISTINCT FROM 'OWNER_ADMIN' THEN
      RAISE EXCEPTION 'Only an active Owner may override Quality Control.'
        USING ERRCODE = '42501';
    END IF;

    IF length(normalized_qc_reason) < 10
       OR length(normalized_qc_reason) > 1000 THEN
      RAISE EXCEPTION 'A QC override reason between 10 and 1000 characters is required.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.handover_transition_authorizations (
    business_id,
    job_id,
    target_status,
    authorized_by
  )
  VALUES (
    actor_business_id,
    target_job_id,
    target_status,
    actor_id
  )
  RETURNING id INTO transition_authorization_id;

  UPDATE public.jobs j
  SET status = target_status,
      qc_override_reason = COALESCE(normalized_qc_reason, j.qc_override_reason),
      qc_override_by = CASE
        WHEN normalized_qc_reason IS NOT NULL THEN actor_id
        ELSE j.qc_override_by
      END,
      handed_over_at = COALESCE(j.handed_over_at, NOW()),
      updated_at = NOW()
  WHERE j.id = target_job_id
    AND j.business_id = actor_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Repair job not found.'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN target_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_job_to_handover(
  UUID, public.job_status, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transition_job_to_handover(
  UUID, public.job_status, TEXT, TEXT
) TO authenticated;

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
  billing_state RECORD;
  override_record RECORD;
  transition_authorization_id UUID;
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
     AND (
       actor_role IS DISTINCT FROM 'OWNER_ADMIN'
       OR NULLIF(BTRIM(NEW.quote_waiver_reason), '') IS NULL
       OR NEW.quote_waiver_by IS DISTINCT FROM auth.uid()
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

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('handover', 'closed') THEN
    SELECT a.id
    INTO transition_authorization_id
    FROM public.handover_transition_authorizations a
    WHERE a.business_id = NEW.business_id
      AND a.job_id = NEW.id
      AND a.target_status = NEW.status
      AND a.authorized_by = auth.uid()
      AND a.authorization_txid = txid_current()
      AND a.consumed_at IS NULL
    ORDER BY a.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Handover and closure status changes must use the authorized transition RPC.'
        USING ERRCODE = '42501';
    END IF;

    UPDATE public.handover_transition_authorizations
    SET consumed_at = NOW()
    WHERE id = transition_authorization_id
      AND consumed_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The status-transition authorization was already consumed.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status = 'in_progress'
     AND COALESCE(NEW.quote_required, TRUE) THEN
    SELECT qv.status
    INTO latest_quote_status
    FROM public.quote_versions qv
    WHERE qv.business_id = NEW.business_id
      AND qv.job_id = NEW.id
    ORDER BY qv.version_number DESC
    LIMIT 1;

    IF latest_quote_status IS DISTINCT FROM 'approved'::public.quote_status
       AND (
         actor_role IS DISTINCT FROM 'OWNER_ADMIN'
         OR NULLIF(BTRIM(NEW.quote_waiver_reason), '') IS NULL
         OR NEW.quote_waiver_by IS DISTINCT FROM auth.uid()
       ) THEN
      RAISE EXCEPTION 'Quotation Approval Required: approved quotation or documented owner waiver required.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('completed', 'handover', 'closed') THEN
    SELECT qc.passed
    INTO latest_qc_passed
    FROM public.qc_records qc
    WHERE qc.business_id = NEW.business_id
      AND qc.job_id = NEW.id
    ORDER BY qc.created_at DESC, qc.id DESC
    LIMIT 1;

    IF latest_qc_passed IS DISTINCT FROM TRUE THEN
      IF actor_role IS DISTINCT FROM 'OWNER_ADMIN'
         OR NULLIF(BTRIM(NEW.qc_override_reason), '') IS NULL
         OR NEW.qc_override_by IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Quality Control Required: latest QC inspection must pass or an owner must record an override reason.'
          USING ERRCODE = '23514';
      END IF;

      INSERT INTO public.activity_logs (
        business_id, actor_id, entity_type, entity_id, action, details
      )
      VALUES (
        NEW.business_id, auth.uid(), 'job', NEW.id, 'JOB_QC_OVERRIDE',
        jsonb_build_object(
          'target_status', NEW.status,
          'reason', NEW.qc_override_reason
        )
      );
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('handover', 'closed') THEN
    SELECT *
    INTO billing_state
    FROM private.get_job_handover_billing_state(NEW.business_id, NEW.id);

    IF billing_state.waived_with_balance THEN
      RAISE EXCEPTION 'A waived invoice with an outstanding ledger balance cannot be handed over.'
        USING ERRCODE = '23514';
    END IF;

    IF billing_state.invoice_count = 0
       OR billing_state.outstanding_balance > 0 THEN
      IF actor_role IS DISTINCT FROM 'OWNER_ADMIN' THEN
        RAISE EXCEPTION 'Handover requires a recorded invoice balance override.'
          USING ERRCODE = '42501';
      END IF;

      SELECT o.id, o.reason, o.invoice_ids, o.invoice_missing,
             o.outstanding_amount
      INTO override_record
      FROM public.handover_payment_overrides o
      WHERE o.business_id = NEW.business_id
        AND o.job_id = NEW.id
        AND o.target_status = NEW.status
        AND o.authorized_by = auth.uid()
        AND o.authorization_txid = txid_current()
        AND o.consumed_at IS NULL
        AND o.invoice_ids = billing_state.invoice_ids
        AND o.invoice_missing = (billing_state.invoice_count = 0)
        AND o.outstanding_amount = billing_state.outstanding_balance
      ORDER BY o.created_at DESC
      LIMIT 1
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Handover requires a fresh Owner override through the authorized transition RPC.'
          USING ERRCODE = '23514';
      END IF;

      UPDATE public.handover_payment_overrides
      SET consumed_at = NOW(),
          consumed_by_status = NEW.status
      WHERE id = override_record.id
        AND consumed_at IS NULL;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'The handover override authorization was already consumed.'
          USING ERRCODE = '23514';
      END IF;

      INSERT INTO public.activity_logs (
        business_id, actor_id, entity_type, entity_id, action, details
      )
      VALUES (
        NEW.business_id, auth.uid(), 'job', NEW.id,
        'HANDOVER_PAYMENT_OVERRIDE',
        jsonb_build_object(
          'target_status', NEW.status,
          'reason', override_record.reason,
          'invoice_ids', override_record.invoice_ids,
          'invoice_missing', override_record.invoice_missing,
          'outstanding_amount', override_record.outstanding_amount,
          'authorization_id', override_record.id
        )
      );
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
        'qc_override_reason', NEW.qc_override_reason,
        'transition_authorization_id', transition_authorization_id
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
