-- Run only on the confirmed disposable Supabase test project.
-- Requires the five staff profiles and the linked Test Portal Customer profile
-- from KAAMFLOW_TEST_ACCOUNT_SETUP_GUIDE.md. All business data is synthetic
-- and the transaction is rolled back.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path TO extensions, public;

SELECT no_plan();

CREATE TEMP TABLE security_test_actors (
  actor_name TEXT PRIMARY KEY,
  actor_id UUID NOT NULL,
  business_id UUID NOT NULL,
  customer_id UUID
);

INSERT INTO security_test_actors
SELECT 'Test Owner A', p.id, p.business_id, p.customer_id
FROM public.profiles p
WHERE p.full_name = 'Test Owner A'
  AND p.role = 'OWNER_ADMIN'
  AND p.is_active = TRUE;

INSERT INTO security_test_actors
SELECT 'Test Owner B', p.id, p.business_id, p.customer_id
FROM public.profiles p
WHERE p.full_name = 'Test Owner B'
  AND p.role = 'OWNER_ADMIN'
  AND p.is_active = TRUE;

INSERT INTO security_test_actors
SELECT 'Test Service Desk', p.id, p.business_id, p.customer_id
FROM public.profiles p
WHERE p.full_name = 'Test Service Desk'
  AND p.role = 'DISPATCHER'
  AND p.is_active = TRUE;

INSERT INTO security_test_actors
SELECT 'Test Portal Customer', p.id, p.business_id, p.customer_id
FROM public.profiles p
WHERE p.full_name = 'Test Portal Customer'
  AND p.role = 'CUSTOMER'
  AND p.is_active = TRUE;

DO $$
DECLARE
  actor_count INTEGER;
  owner_a_business UUID;
  owner_b_business UUID;
  customer_business UUID;
  owner_a_id UUID;
  owner_b_id UUID;
  service_desk_id UUID;
  portal_customer_actor_id UUID;
  portal_customer_id UUID;
  reviewer_id UUID;
  rls_customer_a UUID;
  rls_customer_b UUID;
  wrong_quote_customer_id UUID;
  fixture RECORD;
  new_job_id UUID;
  new_invoice_id UUID;
  quote_version_id UUID;
  raw_token TEXT;
  token_id UUID;
BEGIN
  SELECT COUNT(*) INTO actor_count FROM pg_temp.security_test_actors;
  IF actor_count <> 4 THEN
    RAISE EXCEPTION
      'Expected active Owner A, Owner B, Service Desk, and linked Test Portal Customer profiles; found %.',
      actor_count;
  END IF;

  SELECT actor_id, business_id
  INTO owner_a_id, owner_a_business
  FROM pg_temp.security_test_actors
  WHERE actor_name = 'Test Owner A';

  SELECT actor_id, business_id
  INTO owner_b_id, owner_b_business
  FROM pg_temp.security_test_actors
  WHERE actor_name = 'Test Owner B';

  SELECT actor_id
  INTO service_desk_id
  FROM pg_temp.security_test_actors
  WHERE actor_name = 'Test Service Desk';

  SELECT actor_id, business_id, customer_id
  INTO portal_customer_actor_id, customer_business, portal_customer_id
  FROM pg_temp.security_test_actors
  WHERE actor_name = 'Test Portal Customer';

  IF owner_a_business = owner_b_business
     OR customer_business <> owner_a_business
     OR portal_customer_id IS NULL THEN
    RAISE EXCEPTION 'Test profiles must use two businesses and a linked Business A customer.';
  END IF;

  SELECT p.id
  INTO reviewer_id
  FROM public.profiles p
  WHERE p.full_name = 'Test QC Reviewer'
    AND p.role = 'QC_REVIEWER'
    AND p.business_id = owner_a_business
    AND p.is_active = TRUE;

  IF reviewer_id IS NULL THEN
    RAISE EXCEPTION 'An active Test QC Reviewer profile is required in Business A.';
  END IF;

  PERFORM set_config('kaamflow.test.owner_a_id', owner_a_id::TEXT, TRUE);
  PERFORM set_config('kaamflow.test.owner_b_id', owner_b_id::TEXT, TRUE);
  PERFORM set_config(
    'kaamflow.test.service_desk_id',
    service_desk_id::TEXT,
    TRUE
  );
  PERFORM set_config('kaamflow.test.portal_customer_id', portal_customer_id::TEXT, TRUE);
  PERFORM set_config(
    'kaamflow.test.portal_customer_actor_id',
    portal_customer_actor_id::TEXT,
    TRUE
  );
  PERFORM set_config('kaamflow.test.owner_a_business', owner_a_business::TEXT, TRUE);
  PERFORM set_config('kaamflow.test.owner_b_business', owner_b_business::TEXT, TRUE);

  PERFORM set_config('request.jwt.claim.sub', owner_a_id::TEXT, TRUE);

  INSERT INTO public.customers (business_id, full_name, email)
  VALUES (owner_a_business, 'KAAMFLOW Synthetic RLS Customer A', 'rls-a@example.test')
  RETURNING id INTO rls_customer_a;

  INSERT INTO public.customers (business_id, full_name, email)
  VALUES (owner_b_business, 'KAAMFLOW Synthetic RLS Customer B', 'rls-b@example.test')
  RETURNING id INTO rls_customer_b;

  INSERT INTO public.customers (business_id, full_name, email)
  VALUES (owner_a_business, 'KAAMFLOW Synthetic Other Quote Customer', 'quote-other@example.test')
  RETURNING id INTO wrong_quote_customer_id;

  CREATE TEMP TABLE security_test_jobs (
    case_name TEXT PRIMARY KEY,
    job_id UUID NOT NULL,
    business_id UUID NOT NULL
  );

  FOR fixture IN
    SELECT *
    FROM (VALUES
      ('rls_a', owner_a_business, rls_customer_a),
      ('rls_b', owner_b_business, rls_customer_b),
      ('payment', owner_a_business, portal_customer_id),
      ('qc_failed', owner_a_business, portal_customer_id),
      ('tracking_valid', owner_a_business, portal_customer_id),
      ('tracking_expired', owner_a_business, portal_customer_id),
      ('tracking_revoked', owner_a_business, portal_customer_id),
      ('quote_valid', owner_a_business, portal_customer_id),
      ('quote_wrong_customer', owner_a_business, wrong_quote_customer_id),
      ('fk_a', owner_a_business, rls_customer_a),
      ('fk_a_other_job', owner_a_business, rls_customer_a),
      ('fk_b', owner_b_business, rls_customer_b),
      ('direct_handover', owner_a_business, portal_customer_id),
      ('direct_closed', owner_a_business, portal_customer_id),
      ('ordinary_status', owner_a_business, portal_customer_id)
    ) AS cases(case_name, business_id, customer_id)
  LOOP
    PERFORM set_config(
      'request.jwt.claim.sub',
      CASE WHEN fixture.business_id = owner_a_business
        THEN owner_a_id::TEXT
        ELSE owner_b_id::TEXT
      END,
      TRUE
    );

    INSERT INTO public.jobs (business_id, customer_id, status, issue_summary)
    VALUES (
      fixture.business_id,
      fixture.customer_id,
      'intake',
      'KAAMFLOW-SECURITY-' || fixture.case_name
    )
    RETURNING id INTO new_job_id;

    INSERT INTO pg_temp.security_test_jobs (case_name, job_id, business_id)
    VALUES (fixture.case_name, new_job_id, fixture.business_id);

    PERFORM set_config(
      'kaamflow.test.' || fixture.case_name || '_job_id',
      new_job_id::TEXT,
      TRUE
    );
  END LOOP;

  FOR fixture IN
    SELECT *
    FROM (VALUES
      ('payment', 100.00::NUMERIC, 'pending'),
      ('qc_failed', 0.00::NUMERIC, 'pending'),
      ('fk_a', 50.00::NUMERIC, 'pending'),
      ('fk_a_other_job', 50.00::NUMERIC, 'pending'),
      ('fk_b', 50.00::NUMERIC, 'pending'),
      ('direct_handover', 0.00::NUMERIC, 'paid'),
      ('direct_closed', 0.00::NUMERIC, 'paid')
    ) AS cases(case_name, total_amount, payment_status)
  LOOP
    SELECT business_id
    INTO customer_business
    FROM pg_temp.security_test_jobs
    WHERE case_name = fixture.case_name;

    INSERT INTO public.invoices (
      business_id, job_id, invoice_number, total_amount, payment_status
    )
    VALUES (
      customer_business,
      current_setting('kaamflow.test.' || fixture.case_name || '_job_id')::UUID,
      'SYN-' || REPLACE(gen_random_uuid()::TEXT, '-', ''),
      fixture.total_amount,
      fixture.payment_status
    )
    RETURNING id INTO new_invoice_id;

    PERFORM set_config(
      'kaamflow.test.' || fixture.case_name || '_invoice_id',
      new_invoice_id::TEXT,
      TRUE
    );
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', owner_a_id::TEXT, TRUE);

  INSERT INTO public.qc_records (
    business_id, job_id, reviewer_id, passed, comments
  )
  VALUES
    (
      owner_a_business,
      current_setting('kaamflow.test.payment_job_id')::UUID,
      reviewer_id,
      TRUE,
      'Synthetic passing QC fixture'
    ),
    (
      owner_a_business,
      current_setting('kaamflow.test.direct_handover_job_id')::UUID,
      reviewer_id,
      TRUE,
      'Synthetic passing QC fixture'
    ),
    (
      owner_a_business,
      current_setting('kaamflow.test.direct_closed_job_id')::UUID,
      reviewer_id,
      TRUE,
      'Synthetic passing QC fixture'
    ),
    (
      owner_a_business,
      current_setting('kaamflow.test.qc_failed_job_id')::UUID,
      reviewer_id,
      FALSE,
      'Synthetic failed QC fixture'
    );

  FOR fixture IN
    SELECT *
    FROM (VALUES
      ('quote_valid', portal_customer_id),
      ('quote_wrong_customer', wrong_quote_customer_id)
    ) AS cases(case_name, customer_id)
  LOOP
    INSERT INTO public.quote_versions (
      business_id, job_id, version_number, labour_charge, parts_cost,
      tax_amount, total_amount, status
    )
    VALUES (
      owner_a_business,
      current_setting('kaamflow.test.' || fixture.case_name || '_job_id')::UUID,
      1,
      50.00,
      25.00,
      0.00,
      75.00,
      'draft'
    )
    RETURNING id INTO quote_version_id;

    PERFORM set_config(
      'kaamflow.test.' || fixture.case_name || '_quote_id',
      quote_version_id::TEXT,
      TRUE
    );
    PERFORM public.send_quote_version(quote_version_id);
  END LOOP;

  PERFORM set_config(
    'kaamflow.test.payment_request_key',
    gen_random_uuid()::TEXT,
    TRUE
  );

  FOR fixture IN
    SELECT *
    FROM (VALUES
      ('tracking_valid', 'valid'),
      ('tracking_expired', 'expired'),
      ('tracking_revoked', 'revoked')
    ) AS cases(case_name, token_kind)
  LOOP
    raw_token := encode(gen_random_bytes(32), 'hex');
    token_id := public.create_customer_tracking_token(
      current_setting('kaamflow.test.' || fixture.case_name || '_job_id')::UUID,
      private.hash_tracking_token(raw_token),
      NOW() + INTERVAL '7 days'
    );

    PERFORM set_config(
      'kaamflow.test.' || fixture.token_kind || '_tracking_token',
      raw_token,
      TRUE
    );
    PERFORM set_config(
      'kaamflow.test.' || fixture.token_kind || '_tracking_id',
      token_id::TEXT,
      TRUE
    );

    IF fixture.token_kind = 'expired' THEN
      UPDATE public.customer_tracking_tokens
      SET expires_at = NOW() - INTERVAL '1 minute'
      WHERE id = token_id;
    ELSIF fixture.token_kind = 'revoked' THEN
      UPDATE public.customer_tracking_tokens
      SET revoked_at = NOW()
      WHERE id = token_id;
    END IF;
  END LOOP;
END;
$$;

SELECT set_config(
  'request.jwt.claim.sub',
  current_setting('kaamflow.test.owner_a_id'),
  TRUE
);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM public.jobs
   WHERE issue_summary = 'KAAMFLOW-SECURITY-rls_a'),
  1,
  'Business A Owner can see the synthetic Business A job'
);

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM public.jobs
   WHERE issue_summary = 'KAAMFLOW-SECURITY-rls_b'),
  0,
  'Business A Owner cannot see the synthetic Business B job'
);

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM public.customers
   WHERE full_name = 'KAAMFLOW Synthetic RLS Customer B'),
  0,
  'Business A Owner cannot see the synthetic Business B customer'
);

UPDATE public.jobs
SET status = 'diagnosis'
WHERE issue_summary = 'KAAMFLOW-SECURITY-rls_b';

SELECT set_config(
  'request.jwt.claim.sub',
  current_setting('kaamflow.test.owner_b_id'),
  TRUE
);

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM public.jobs
   WHERE issue_summary = 'KAAMFLOW-SECURITY-rls_b'),
  1,
  'Business B Owner can see the synthetic Business B job'
);

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM public.jobs
   WHERE issue_summary = 'KAAMFLOW-SECURITY-rls_a'),
  0,
  'Business B Owner cannot see the synthetic Business A job'
);

RESET ROLE;

SELECT is(
  (SELECT status::TEXT FROM public.jobs
   WHERE issue_summary = 'KAAMFLOW-SECURITY-rls_b'),
  'intake',
  'Business A could not update a Business B job through RLS'
);

SELECT set_config(
  'request.jwt.claim.sub',
  current_setting('kaamflow.test.owner_a_id'),
  TRUE
);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  format(
    'UPDATE public.jobs SET status = %L::public.job_status WHERE id = %L::UUID',
    'handover',
    current_setting('kaamflow.test.direct_handover_job_id')
  ),
  '42501',
  'Handover and closure status changes must use the authorized transition RPC.',
  'Authenticated Owner cannot directly set HANDOVER even with settled billing and passing QC'
);

SELECT set_config(
  'request.jwt.claim.sub',
  current_setting('kaamflow.test.service_desk_id'),
  TRUE
);

SELECT throws_ok(
  format(
    'UPDATE public.jobs SET status = %L::public.job_status WHERE id = %L::UUID',
    'closed',
    current_setting('kaamflow.test.direct_closed_job_id')
  ),
  '42501',
  'Handover and closure status changes must use the authorized transition RPC.',
  'Authenticated Service Desk cannot directly set CLOSED even with settled billing and passing QC'
);

SELECT lives_ok(
  format(
    'UPDATE public.jobs SET status = %L::public.job_status WHERE id = %L::UUID',
    'diagnosis',
    current_setting('kaamflow.test.ordinary_status_job_id')
  ),
  'Ordinary non-terminal authenticated job status updates remain permitted'
);

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, NULL)',
    current_setting('kaamflow.test.qc_failed_job_id'),
    'handover'
  ),
  '23514',
  'Quality Control Required: latest QC inspection must pass or an owner must record an override reason.',
  'A failed QC record blocks a paid handover'
);

SELECT is(
  public.record_manual_invoice_payment(
    current_setting('kaamflow.test.payment_job_id')::UUID,
    100.00,
    'cash',
    current_setting('kaamflow.test.payment_request_key')::UUID,
    'Synthetic idempotency acceptance payment'
  ),
  public.record_manual_invoice_payment(
    current_setting('kaamflow.test.payment_job_id')::UUID,
    100.00,
    'cash',
    current_setting('kaamflow.test.payment_request_key')::UUID,
    'Synthetic idempotency acceptance payment'
  ),
  'Identical payment retries return the same payment ID'
);

SELECT throws_ok(
  format(
    'SELECT public.record_manual_invoice_payment(%L::UUID, 99.00, %L, %L::UUID, %L)',
    current_setting('kaamflow.test.payment_job_id'),
    'cash',
    current_setting('kaamflow.test.payment_request_key'),
    'Synthetic idempotency acceptance payment'
  ),
  '23505',
  'This payment request key was already used for a different payment.',
  'A changed amount cannot reuse a payment request key'
);

SELECT throws_ok(
  format(
    'SELECT public.record_manual_invoice_payment(%L::UUID, 100.00, %L, %L::UUID, %L)',
    current_setting('kaamflow.test.payment_job_id'),
    'card',
    current_setting('kaamflow.test.payment_request_key'),
    'Synthetic idempotency acceptance payment'
  ),
  '23505',
  'This payment request key was already used for a different payment.',
  'A changed method cannot reuse a payment request key'
);

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM public.payments
   WHERE payment_request_key = current_setting('kaamflow.test.payment_request_key')::UUID),
  1,
  'Idempotent payment retries create exactly one ledger row'
);

SELECT throws_ok(
  format(
    'INSERT INTO public.payments (business_id, job_id, invoice_id, amount, payment_method, recorded_by) VALUES (%L::UUID, %L::UUID, %L::UUID, 1.00, %L, %L::UUID)',
    current_setting('kaamflow.test.owner_a_business'),
    current_setting('kaamflow.test.payment_job_id'),
    current_setting('kaamflow.test.payment_invoice_id'),
    'cash',
    current_setting('kaamflow.test.owner_a_id')
  ),
  '42501',
  'permission denied for table payments',
  'Authenticated users cannot bypass the payment RPC with direct INSERT'
);

SELECT lives_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, NULL)',
    current_setting('kaamflow.test.payment_job_id'),
    'handover'
  ),
  'A fully paid, QC-passed job can transition through the authorized RPC'
);

SELECT is(
  (public.get_public_job_tracking(
    current_setting('kaamflow.test.valid_tracking_token')
  )->>'success'),
  'true',
  'A valid synthetic tracking token is redeemable'
);

SELECT ok(
  NOT (
    public.get_public_job_tracking(
      current_setting('kaamflow.test.valid_tracking_token')
    ) ? 'diagnosis_notes'
  ),
  'Public tracking output excludes internal diagnosis notes'
);

SELECT is(
  (public.get_public_job_tracking(
    current_setting('kaamflow.test.expired_tracking_token')
  )->>'error'),
  'This tracking link has expired.',
  'An expired synthetic tracking token is rejected'
);

SELECT is(
  (public.get_public_job_tracking(
    current_setting('kaamflow.test.revoked_tracking_token')
  )->>'error'),
  'This tracking link has been revoked by the workshop.',
  'A revoked synthetic tracking token is rejected'
);

SELECT set_config(
  'request.jwt.claim.sub',
current_setting('kaamflow.test.portal_customer_actor_id'),
  TRUE
);

SELECT lives_ok(
  format(
    'SELECT public.respond_to_quote(%L::UUID, %L, %L)',
    current_setting('kaamflow.test.quote_valid_quote_id'),
    'approved',
    'Synthetic customer approval'
  ),
  'The linked customer can approve their latest sent quotation'
);

SELECT throws_ok(
  format(
    'SELECT public.respond_to_quote(%L::UUID, %L, NULL)',
    current_setting('kaamflow.test.quote_valid_quote_id'),
    'approved'
  ),
  '42501',
  'That quotation version is not available to this customer.',
  'A duplicate customer quotation response is rejected'
);

SELECT throws_ok(
  format(
    'SELECT public.respond_to_quote(%L::UUID, %L, NULL)',
    current_setting('kaamflow.test.quote_wrong_customer_quote_id'),
    'approved'
  ),
  '42501',
  'That quotation version is not available to this customer.',
  'A customer cannot approve another customer’s quotation'
);

RESET ROLE;

SELECT is(
  (SELECT qv.status::TEXT FROM public.quote_versions qv
   WHERE qv.id = current_setting('kaamflow.test.quote_valid_quote_id')::UUID),
  'approved',
  'Customer approval updates the quotation version'
);

SELECT throws_ok(
  format(
    'INSERT INTO public.payments (business_id, job_id, invoice_id, amount, payment_method) VALUES (%L::UUID, %L::UUID, %L::UUID, 1.00, %L)',
    current_setting('kaamflow.test.owner_a_business'),
    current_setting('kaamflow.test.fk_b_job_id'),
    current_setting('kaamflow.test.fk_b_invoice_id'),
    'cash'
  ),
  '23503',
  NULL,
  'A payment cannot reference a job from another business'
);

SELECT throws_ok(
  format(
    'INSERT INTO public.payments (business_id, job_id, invoice_id, amount, payment_method) VALUES (%L::UUID, %L::UUID, %L::UUID, 1.00, %L)',
    current_setting('kaamflow.test.owner_a_business'),
    current_setting('kaamflow.test.fk_a_job_id'),
    current_setting('kaamflow.test.fk_b_invoice_id'),
    'cash'
  ),
  '23503',
  NULL,
  'A payment cannot reference an invoice from another business'
);

SELECT throws_ok(
  format(
    'INSERT INTO public.payments (business_id, job_id, invoice_id, amount, payment_method) VALUES (%L::UUID, %L::UUID, %L::UUID, 1.00, %L)',
    current_setting('kaamflow.test.owner_a_business'),
    current_setting('kaamflow.test.fk_a_job_id'),
    current_setting('kaamflow.test.fk_a_other_job_invoice_id'),
    'cash'
  ),
  '23503',
  NULL,
  'A payment cannot reference a same-business invoice for a different job'
);

SELECT is(
  (SELECT COUNT(*)::INTEGER
   FROM public.handover_transition_authorizations a
   WHERE a.job_id = current_setting('kaamflow.test.direct_handover_job_id')::UUID
     AND a.consumed_at IS NOT NULL),
  0,
  'Rejected direct updates leave no transition authorization record'
);

SELECT * FROM finish();

ROLLBACK;
