-- Run only against the confirmed disposable Supabase test project.
-- Requires the five test profiles from KAAMFLOW_TEST_ACCOUNT_SETUP_GUIDE.md.
-- This transaction creates synthetic fixtures and rolls them all back.
-- It runs as a database administrator, sets JWT subject claims for the
-- workflow functions/triggers, and separately checks effective role grants.
-- It does not create Auth users or test RLS row visibility.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path TO extensions, public;

SELECT no_plan();

CREATE TEMP TABLE handover_test_actors (
  actor_name TEXT PRIMARY KEY,
  actor_id UUID NOT NULL,
  business_id UUID NOT NULL
);

INSERT INTO handover_test_actors (actor_name, actor_id, business_id)
SELECT 'Test Owner A', p.id, p.business_id
FROM public.profiles p
WHERE p.full_name = 'Test Owner A'
  AND p.role = 'OWNER_ADMIN'
  AND p.is_active = TRUE;

INSERT INTO handover_test_actors (actor_name, actor_id, business_id)
SELECT 'Test Service Desk', p.id, p.business_id
FROM public.profiles p
WHERE p.full_name = 'Test Service Desk'
  AND p.role = 'DISPATCHER'
  AND p.is_active = TRUE;

INSERT INTO handover_test_actors (actor_name, actor_id, business_id)
SELECT 'Test Technician', p.id, p.business_id
FROM public.profiles p
WHERE p.full_name = 'Test Technician'
  AND p.role = 'TECHNICIAN'
  AND p.is_active = TRUE;

INSERT INTO handover_test_actors (actor_name, actor_id, business_id)
SELECT 'Test QC Reviewer', p.id, p.business_id
FROM public.profiles p
WHERE p.full_name = 'Test QC Reviewer'
  AND p.role = 'QC_REVIEWER'
  AND p.is_active = TRUE;

INSERT INTO handover_test_actors (actor_name, actor_id, business_id)
SELECT 'Test Owner B', p.id, p.business_id
FROM public.profiles p
WHERE p.full_name = 'Test Owner B'
  AND p.role = 'OWNER_ADMIN'
  AND p.is_active = TRUE;

DO $$
DECLARE
  expected_actor_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO expected_actor_count
  FROM pg_temp.handover_test_actors;

  IF expected_actor_count <> 5 THEN
    RAISE EXCEPTION
      'Expected five active disposable test profiles from the setup guide; found %.',
      expected_actor_count;
  END IF;

  IF (
    SELECT COUNT(DISTINCT business_id)
    FROM pg_temp.handover_test_actors
    WHERE actor_name IN ('Test Owner A', 'Test Service Desk', 'Test Technician', 'Test QC Reviewer')
  ) <> 1 THEN
    RAISE EXCEPTION 'Business A test profiles must belong to one business.';
  END IF;

  IF (
    SELECT business_id
    FROM pg_temp.handover_test_actors
    WHERE actor_name = 'Test Owner B'
  ) = (
    SELECT business_id
    FROM pg_temp.handover_test_actors
    WHERE actor_name = 'Test Owner A'
  ) THEN
    RAISE EXCEPTION 'Owner B must belong to the separate test business.';
  END IF;
END;
$$;

CREATE TEMP TABLE handover_test_jobs (
  case_name TEXT PRIMARY KEY,
  job_id UUID NOT NULL
);

DO $$
DECLARE
  owner_a_id UUID;
  qc_reviewer_id UUID;
  business_a_id UUID;
  fixture RECORD;
  new_job_id UUID;
  new_invoice_id UUID;
BEGIN
  SELECT actor_id, business_id
  INTO owner_a_id, business_a_id
  FROM pg_temp.handover_test_actors
  WHERE actor_name = 'Test Owner A';

  SELECT actor_id
  INTO qc_reviewer_id
  FROM pg_temp.handover_test_actors
  WHERE actor_name = 'Test QC Reviewer';

  PERFORM set_config('request.jwt.claim.sub', owner_a_id::TEXT, TRUE);

  FOR fixture IN
    SELECT *
    FROM (VALUES
      ('no_invoice', 'none', TRUE),
      ('positive_balance', 'pending', TRUE),
      ('paid_success', 'paid', TRUE),
      ('completed_unpaid', 'pending', TRUE),
      ('paid_status_without_ledger', 'paid_unbacked', TRUE),
      ('waived_positive_balance', 'waived_pending', TRUE),
      ('waived_zero_balance', 'waived_paid', TRUE),
      ('closed_positive_balance', 'pending', TRUE),
      ('closed_qc_missing_paid', 'paid', FALSE),
      ('qc_missing_paid', 'paid', FALSE),
      ('dual_failure', 'pending', FALSE),
      ('direct_update_positive_balance', 'pending', TRUE),
      ('direct_update_paid', 'paid', TRUE),
      ('direct_closed_paid', 'paid', TRUE),
      ('ordinary_status_update', 'none', TRUE),
      ('qc_failed', 'paid', FALSE),
      ('replay_positive_balance', 'pending', TRUE),
      ('multiple_invoices', 'multiple', TRUE),
      ('audit_failure', 'pending', TRUE)
    ) AS cases(case_name, invoice_case, has_passing_qc)
  LOOP
    INSERT INTO public.jobs (business_id, status, issue_summary)
    VALUES (business_a_id, 'intake', 'Disposable handover test: ' || fixture.case_name)
    RETURNING id INTO new_job_id;

    INSERT INTO pg_temp.handover_test_jobs (case_name, job_id)
    VALUES (fixture.case_name, new_job_id);

    IF fixture.invoice_case IN (
      'pending', 'waived_pending', 'waived_paid', 'paid', 'paid_unbacked'
    ) THEN
      INSERT INTO public.invoices (
        business_id, job_id, invoice_number, total_amount, payment_status
      )
      VALUES (
        business_a_id,
        new_job_id,
        'TST-' || REPLACE(gen_random_uuid()::TEXT, '-', ''),
        100.00,
        CASE
          WHEN fixture.invoice_case IN ('waived_pending', 'waived_paid') THEN 'waived'
          WHEN fixture.invoice_case IN ('paid', 'paid_unbacked') THEN 'paid'
          ELSE 'pending'
        END
      )
      RETURNING id INTO new_invoice_id;

      IF fixture.invoice_case IN ('waived_paid', 'paid') THEN
        INSERT INTO public.payments (
          business_id,
          job_id,
          invoice_id,
          payment_request_key,
          amount,
          payment_method,
          recorded_by
        )
        VALUES (
          business_a_id,
          new_job_id,
          new_invoice_id,
          gen_random_uuid(),
          100.00,
          'cash',
          owner_a_id
        );
      END IF;
    ELSIF fixture.invoice_case = 'multiple' THEN
      INSERT INTO public.invoices (
        business_id, job_id, invoice_number, total_amount, payment_status
      )
      VALUES (
        business_a_id, new_job_id,
        'TST-' || REPLACE(gen_random_uuid()::TEXT, '-', ''),
        100.00, 'paid'
      )
      RETURNING id INTO new_invoice_id;

      INSERT INTO public.payments (
        business_id, job_id, invoice_id, payment_request_key,
        amount, payment_method, recorded_by
      )
      VALUES (
        business_a_id, new_job_id, new_invoice_id,
        gen_random_uuid(), 100.00, 'cash', owner_a_id
      );

      INSERT INTO public.invoices (
        business_id, job_id, invoice_number, total_amount, payment_status
      )
      VALUES (
        business_a_id, new_job_id,
        'TST-' || REPLACE(gen_random_uuid()::TEXT, '-', ''),
        50.00, 'pending'
      );
    END IF;

    IF fixture.has_passing_qc THEN
      INSERT INTO public.qc_records (
        business_id, job_id, reviewer_id, passed, comments
      )
      VALUES (
        business_a_id, new_job_id, qc_reviewer_id, TRUE,
        'Disposable handover payment guard fixture'
      );
    END IF;
  END LOOP;

  INSERT INTO public.qc_records (
    business_id, job_id, reviewer_id, passed, comments
  )
  VALUES (
    business_a_id,
    (SELECT job_id FROM pg_temp.handover_test_jobs WHERE case_name = 'qc_failed'),
    qc_reviewer_id,
    FALSE,
    'Synthetic failed-QC acceptance fixture'
  );
END;
$$;

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.invoices', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.invoices', 'UPDATE'),
  'Existing authenticated invoice write revocations remain effective'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.handover_payment_overrides', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.handover_payment_overrides', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.handover_payment_overrides', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.handover_payment_overrides', 'DELETE')
  AND NOT has_table_privilege('service_role', 'public.handover_payment_overrides', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.handover_payment_overrides', 'INSERT'),
  'Clients have no direct access to one-time override authorizations'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.handover_transition_authorizations', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.handover_transition_authorizations', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.handover_transition_authorizations', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.handover_transition_authorizations', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.handover_transition_authorizations', 'INSERT'),
  'Clients cannot create or inspect one-shot transition authorizations'
);

SELECT ok(
  (
    SELECT c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'handover_payment_overrides'
  ),
  'Override authorization table has RLS enabled'
);

SELECT ok(
  (
    SELECT c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'handover_transition_authorizations'
  ),
  'One-shot transition authorization table has RLS enabled'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.transition_job_to_handover(uuid,public.job_status,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.transition_job_to_handover(uuid,public.job_status,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.transition_job_to_handover(uuid,public.job_status,text,text)',
    'EXECUTE'
  ),
  'Only authenticated callers can invoke the status-transition RPC'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::TEXT FROM handover_test_actors WHERE actor_name = 'Test Service Desk'),
  TRUE
);

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, %L, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'no_invoice'),
    'handover',
    'Dispatcher must never override billing'
  ),
  '42501',
  'Only an active Owner may override handover billing requirements.',
  'Service Desk cannot override a missing invoice'
);

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'no_invoice'),
    'handover'
  ),
  '42501',
  'Handover requires a recorded invoice balance override.',
  'Service Desk cannot hand over a job without an invoice'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::TEXT FROM handover_test_actors WHERE actor_name = 'Test Owner A'),
  TRUE
);

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'no_invoice'),
    'handover'
  ),
  '23514',
  'An Owner override reason between 10 and 1000 characters is required.',
  'Owner cannot bypass the missing-invoice rule without a reason'
);

SELECT lives_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, %L, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'no_invoice'),
    'handover',
    'Customer pickup approved under documented exception'
  ),
  'Owner may document an override when an invoice is missing'
);

SELECT is(
  (
    SELECT COUNT(*)::INTEGER
    FROM public.handover_payment_overrides o
    WHERE o.job_id = (SELECT job_id FROM handover_test_jobs WHERE case_name = 'no_invoice')
      AND o.consumed_at IS NOT NULL
      AND o.invoice_missing
  ),
  1,
  'Missing-invoice override is consumed exactly once'
);

SELECT is(
  (
    SELECT COUNT(*)::INTEGER
    FROM public.activity_logs l
    WHERE l.entity_id = (SELECT job_id FROM handover_test_jobs WHERE case_name = 'no_invoice')
      AND l.action = 'HANDOVER_PAYMENT_OVERRIDE'
      AND l.details->>'reason' = 'Customer pickup approved under documented exception'
  ),
  1,
  'Missing-invoice Owner override is auditable with its reason'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::TEXT FROM handover_test_actors WHERE actor_name = 'Test Service Desk'),
  TRUE
);

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, %L, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'positive_balance'),
    'handover',
    'Dispatcher must never override billing'
  ),
  '42501',
  'Only an active Owner may override handover billing requirements.',
  'Service Desk cannot override a positive balance'
);

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'positive_balance'),
    'handover'
  ),
  '42501',
  'Handover requires a recorded invoice balance override.',
  'Service Desk cannot hand over a job with an outstanding balance'
);

SELECT lives_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'paid_success'),
    'handover'
  ),
  'Service Desk may hand over after the payment ledger is settled'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::TEXT FROM handover_test_actors WHERE actor_name = 'Test Owner A'),
  TRUE
);

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'positive_balance'),
    'handover'
  ),
  '23514',
  'An Owner override reason between 10 and 1000 characters is required.',
  'Owner cannot bypass a positive balance without a reason'
);

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, %L, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'positive_balance'),
    'handover',
    'short'
  ),
  '23514',
  'An Owner override reason between 10 and 1000 characters is required.',
  'Owner override reason must meet the minimum length'
);

SELECT lives_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, %L, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'positive_balance'),
    'handover',
    'Customer pickup approved with balance outstanding'
  ),
  'Owner may override a positive ledger balance with a documented reason'
);

SELECT is(
  (
    SELECT o.outstanding_amount
    FROM public.handover_payment_overrides o
    WHERE o.job_id = (SELECT job_id FROM handover_test_jobs WHERE case_name = 'positive_balance')
      AND o.consumed_at IS NOT NULL
  ),
  100.00::NUMERIC,
  'Override audit snapshot records the actual outstanding amount'
);

SELECT is(
  (
    SELECT COUNT(*)::INTEGER
    FROM public.activity_logs l
    WHERE l.entity_id = (SELECT job_id FROM handover_test_jobs WHERE case_name = 'positive_balance')
      AND l.action = 'HANDOVER_PAYMENT_OVERRIDE'
  ),
  1,
  'Positive-balance override creates one activity-log event'
);

SELECT lives_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'positive_balance'),
    'handover'
  ),
  'Repeating an already completed handover is an idempotent no-op'
);

SELECT is(
  (
    SELECT COUNT(*)::INTEGER
    FROM public.activity_logs l
    WHERE l.entity_id = (SELECT job_id FROM handover_test_jobs WHERE case_name = 'positive_balance')
      AND l.action = 'HANDOVER_PAYMENT_OVERRIDE'
  ),
  1,
  'Idempotent handover does not create a duplicate override audit event'
);

UPDATE public.jobs
SET status = 'completed'
WHERE id = (SELECT job_id FROM handover_test_jobs WHERE case_name = 'completed_unpaid');

SELECT is(
  (
    SELECT j.status::TEXT
    FROM public.jobs j
    WHERE j.id = (SELECT job_id FROM handover_test_jobs WHERE case_name = 'completed_unpaid')
  ),
  'completed',
  'Repair completion is allowed with an outstanding balance; physical handover remains gated'
);

UPDATE public.jobs
SET status = 'intake'
WHERE id = (SELECT job_id FROM handover_test_jobs WHERE case_name = 'positive_balance');

SELECT throws_ok(
  format(
    'UPDATE public.jobs SET status = %L::public.job_status WHERE id = %L::UUID',
    'handover',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'positive_balance')
  ),
  '42501',
  'Handover and closure status changes must use the authorized transition RPC.',
  'Direct job update cannot replay a consumed override'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::TEXT FROM handover_test_actors WHERE actor_name = 'Test Service Desk'),
  TRUE
);

SELECT throws_ok(
  format(
    'UPDATE public.jobs SET status = %L::public.job_status WHERE id = %L::UUID',
    'handover',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'positive_balance')
  ),
  '42501',
  'Handover and closure status changes must use the authorized transition RPC.',
  'Direct Dispatcher job update cannot bypass the payment guard'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::TEXT FROM handover_test_actors WHERE actor_name = 'Test Technician'),
  TRUE
);

SELECT throws_ok(
  format(
    'UPDATE public.jobs SET status = %L::public.job_status WHERE id = %L::UUID',
    'handover',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'positive_balance')
  ),
  '42501',
  'Technicians may only update the status of assigned work.',
  'Direct Technician job update cannot bypass handover restrictions'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::TEXT FROM handover_test_actors WHERE actor_name = 'Test Owner A'),
  TRUE
);

SELECT throws_ok(
  format(
    'UPDATE public.jobs SET status = %L::public.job_status WHERE id = %L::UUID',
    'handover',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'direct_update_paid')
  ),
  '42501',
  'Handover and closure status changes must use the authorized transition RPC.',
  'Direct Owner update is blocked even when payment and QC requirements pass'
);

SELECT throws_ok(
  format(
    'UPDATE public.jobs SET status = %L::public.job_status WHERE id = %L::UUID',
    'closed',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'direct_closed_paid')
  ),
  '42501',
  'Handover and closure status changes must use the authorized transition RPC.',
  'Direct Owner update cannot bypass the RPC for CLOSED'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::TEXT FROM handover_test_actors WHERE actor_name = 'Test Service Desk'),
  TRUE
);

SELECT throws_ok(
  format(
    'UPDATE public.jobs SET status = %L::public.job_status WHERE id = %L::UUID',
    'handover',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'direct_update_paid')
  ),
  '42501',
  'Handover and closure status changes must use the authorized transition RPC.',
  'Direct Service Desk update is blocked when payment and QC requirements pass'
);

SELECT lives_ok(
  format(
    'UPDATE public.jobs SET status = %L::public.job_status WHERE id = %L::UUID',
    'diagnosis',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'ordinary_status_update')
  ),
  'Ordinary non-terminal job status updates remain available'
);

SELECT lives_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'direct_update_paid'),
    'handover'
  ),
  'Authorized RPC permits a normal paid-and-QC-passed handover'
);

SELECT lives_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'direct_closed_paid'),
    'closed'
  ),
  'Authorized RPC permits a normal paid-and-QC-passed closure'
);

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'qc_failed'),
    'handover'
  ),
  '23514',
  'Quality Control Required: latest QC inspection must pass or an owner must record an override reason.',
  'A recorded failed QC inspection blocks handover'
);

SELECT is(
  (
    SELECT COUNT(*)::INTEGER
    FROM public.handover_transition_authorizations a
    WHERE a.job_id = (SELECT job_id FROM handover_test_jobs WHERE case_name = 'direct_update_paid')
      AND a.consumed_at IS NOT NULL
  ),
  1,
  'Successful paid handover consumes its RPC-only authorization exactly once'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::TEXT FROM handover_test_actors WHERE actor_name = 'Test Owner A'),
  TRUE
);

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, %L, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'waived_positive_balance'),
    'handover',
    'Attempt to override waived invoice debt'
  ),
  '23514',
  'A waived invoice with an outstanding ledger balance cannot be handed over.',
  'Waived invoice with positive ledger balance remains blocked even for Owner'
);

SELECT lives_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'waived_zero_balance'),
    'handover'
  ),
  'Waived invoice is acceptable when the actual ledger balance is zero'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::TEXT FROM handover_test_actors WHERE actor_name = 'Test Service Desk'),
  TRUE
);

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'closed_positive_balance'),
    'closed'
  ),
  '42501',
  'Handover requires a recorded invoice balance override.',
  'CLOSED is subject to the same payment gate as HANDOVER'
);

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'closed_qc_missing_paid'),
    'closed'
  ),
  '23514',
  'Quality Control Required: latest QC inspection must pass or an owner must record an override reason.',
  'CLOSED is subject to the same QC requirement as HANDOVER'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::TEXT FROM handover_test_actors WHERE actor_name = 'Test Owner A'),
  TRUE
);

SELECT lives_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, %L, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'closed_positive_balance'),
    'closed',
    'Owner accepts documented closed-status payment exception'
  ),
  'Owner may document a positive-balance override for CLOSED'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::TEXT FROM handover_test_actors WHERE actor_name = 'Test Service Desk'),
  TRUE
);

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'qc_missing_paid'),
    'handover'
  ),
  '23514',
  'Quality Control Required: latest QC inspection must pass or an owner must record an override reason.',
  'Payment clearance does not bypass the QC requirement'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::TEXT FROM handover_test_actors WHERE actor_name = 'Test Owner A'),
  TRUE
);

SELECT lives_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, %L)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'qc_missing_paid'),
    'handover',
    'Owner documents QC exception for disposable test'
  ),
  'Owner may use the distinct QC override when the invoice ledger is settled'
);

SELECT lives_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, %L)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'closed_qc_missing_paid'),
    'closed',
    'Owner documents QC exception for closed-status test'
  ),
  'Owner may override QC for CLOSED only with a documented reason'
);

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, %L, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'dual_failure'),
    'handover',
    'Owner documents payment exception for test'
  ),
  '23514',
  'Quality Control Required: latest QC inspection must pass or an owner must record an override reason.',
  'Payment override alone cannot bypass a failed QC requirement'
);

SELECT lives_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, %L, %L)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'dual_failure'),
    'handover',
    'Owner documents payment exception for test',
    'Owner separately documents QC exception for test'
  ),
  'Both payment and QC exceptions are accepted only with separate Owner reasons'
);

SELECT is(
  (
    SELECT COUNT(*)::INTEGER
    FROM public.activity_logs l
    WHERE l.entity_id = (SELECT job_id FROM handover_test_jobs WHERE case_name = 'dual_failure')
      AND l.action = 'HANDOVER_PAYMENT_OVERRIDE'
  ),
  1,
  'Combined override records one payment audit event'
);

SELECT is(
  (
    SELECT COUNT(*)::INTEGER
    FROM public.activity_logs l
    WHERE l.entity_id = (SELECT job_id FROM handover_test_jobs WHERE case_name = 'dual_failure')
      AND l.action = 'JOB_STATUS_CHANGED'
      AND l.details->>'qc_override_reason' = 'Owner separately documents QC exception for test'
  ),
  1,
  'Combined override retains the separately documented QC reason'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::TEXT FROM handover_test_actors WHERE actor_name = 'Test Technician'),
  TRUE
);

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'waived_zero_balance'),
    'handover'
  ),
  '42501',
  'Only active Owners and Service Desk staff may request handover.',
  'Technician cannot use the handover transition RPC'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::TEXT FROM handover_test_actors WHERE actor_name = 'Test Owner B'),
  TRUE
);

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'positive_balance'),
    'handover'
  ),
  'P0002',
  'Repair job not found.',
  'Owner from the other business cannot target this job'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::TEXT FROM handover_test_actors WHERE actor_name = 'Test QC Reviewer'),
  TRUE
);

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'waived_zero_balance'),
    'handover'
  ),
  '42501',
  'Only active Owners and Service Desk staff may request handover.',
  'QC Reviewer cannot bypass Owner or Service Desk transition authorization'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::TEXT FROM handover_test_actors WHERE actor_name = 'Test Owner A'),
  TRUE
);

SELECT lives_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, %L, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'multiple_invoices'),
    'handover',
    'Owner approves the audited aggregate balance exception'
  ),
  'Multiple invoice balances are handled as one aggregate'
);

SELECT is(
  (
    SELECT o.outstanding_amount
    FROM public.handover_payment_overrides o
    WHERE o.job_id = (SELECT job_id FROM handover_test_jobs WHERE case_name = 'multiple_invoices')
      AND o.consumed_at IS NOT NULL
  ),
  50.00::NUMERIC,
  'Aggregate audit amount includes the remaining balance on every invoice'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::TEXT FROM handover_test_actors WHERE actor_name = 'Test Service Desk'),
  TRUE
);

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, NULL, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'paid_status_without_ledger'),
    'handover'
  ),
  '42501',
  'Handover requires a recorded invoice balance override.',
  'A forged paid status cannot replace the payment ledger'
);

SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT actor_id::TEXT FROM handover_test_actors WHERE actor_name = 'Test Owner A'),
  TRUE
);

CREATE FUNCTION pg_temp.fail_handover_payment_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.action = 'HANDOVER_PAYMENT_OVERRIDE' THEN
    RAISE EXCEPTION 'test forced handover audit failure'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER zzz_test_fail_handover_payment_audit
BEFORE INSERT ON public.activity_logs
FOR EACH ROW
EXECUTE FUNCTION pg_temp.fail_handover_payment_audit();

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, %L, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'audit_failure'),
    'handover',
    'Owner override used to verify audit rollback'
  ),
  'P0001',
  'test forced handover audit failure',
  'Audit failure aborts the override and handover transaction'
);

DROP TRIGGER zzz_test_fail_handover_payment_audit ON public.activity_logs;
DROP FUNCTION pg_temp.fail_handover_payment_audit();

SELECT is(
  (
    SELECT j.status::TEXT
    FROM public.jobs j
    WHERE j.id = (SELECT job_id FROM handover_test_jobs WHERE case_name = 'audit_failure')
  ),
  'intake',
  'Failed audit leaves the job status unchanged'
);

SELECT is(
  (
    SELECT COUNT(*)::INTEGER
    FROM public.handover_payment_overrides o
    WHERE o.job_id = (SELECT job_id FROM handover_test_jobs WHERE case_name = 'audit_failure')
  ),
  0,
  'Failed audit rolls back the one-time authorization record'
);

UPDATE public.profiles
SET is_active = FALSE
WHERE id = (SELECT actor_id FROM handover_test_actors WHERE actor_name = 'Test Owner A');

SELECT throws_ok(
  format(
    'SELECT public.transition_job_to_handover(%L::UUID, %L::public.job_status, %L, NULL)',
    (SELECT job_id::TEXT FROM handover_test_jobs WHERE case_name = 'waived_zero_balance'),
    'handover',
    'Inactive owner must not override'
  ),
  '42501',
  'Only active Owners and Service Desk staff may request handover.',
  'Inactive Owner cannot invoke the handover RPC'
);

SELECT * FROM finish();

ROLLBACK;
