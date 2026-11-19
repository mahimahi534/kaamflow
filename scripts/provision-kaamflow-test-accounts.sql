-- SQL Editor provisioning for kaamflow-test only.
-- First create six test Auth users in Authentication > Users. Use test email
-- addresses you control; invite links are preferred over storing passwords.
-- Replace every UUID and email placeholder below with the exact Auth user
-- values from this project. This script fails closed if placeholders remain.
--
-- Creates only two synthetic businesses, one synthetic customer, and six
-- insert-only profiles. Existing conflicting data aborts the transaction.

BEGIN;

CREATE TEMP TABLE kaamflow_test_user_seed (
  auth_user_id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  business_slug TEXT NOT NULL,
  customer_profile BOOLEAN NOT NULL DEFAULT FALSE
) ON COMMIT DROP;

INSERT INTO pg_temp.kaamflow_test_user_seed
  (auth_user_id, email, full_name, role, business_slug, customer_profile)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'replace-owner-a@example.invalid', 'Test Owner A', 'OWNER_ADMIN', 'kaamflow-test-business-a', FALSE),
  ('00000000-0000-0000-0000-000000000002', 'replace-service-desk-a@example.invalid', 'Test Service Desk', 'DISPATCHER', 'kaamflow-test-business-a', FALSE),
  ('00000000-0000-0000-0000-000000000003', 'replace-technician-a@example.invalid', 'Test Technician', 'TECHNICIAN', 'kaamflow-test-business-a', FALSE),
  ('00000000-0000-0000-0000-000000000004', 'replace-qc-reviewer-a@example.invalid', 'Test QC Reviewer', 'QC_REVIEWER', 'kaamflow-test-business-a', FALSE),
  ('00000000-0000-0000-0000-000000000005', 'replace-owner-b@example.invalid', 'Test Owner B', 'OWNER_ADMIN', 'kaamflow-test-business-b', FALSE),
  ('00000000-0000-0000-0000-000000000006', 'replace-portal-customer@example.invalid', 'Test Portal Customer', 'CUSTOMER', 'kaamflow-test-business-a', TRUE);

DO $$
DECLARE
  seed_count INTEGER;
  auth_match_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO seed_count
  FROM pg_temp.kaamflow_test_user_seed;

  IF seed_count <> 6
     OR EXISTS (
       SELECT 1
       FROM pg_temp.kaamflow_test_user_seed
       WHERE email LIKE 'replace-%'
          OR auth_user_id IN (
            '00000000-0000-0000-0000-000000000001'::UUID,
            '00000000-0000-0000-0000-000000000002'::UUID,
            '00000000-0000-0000-0000-000000000003'::UUID,
            '00000000-0000-0000-0000-000000000004'::UUID,
            '00000000-0000-0000-0000-000000000005'::UUID,
            '00000000-0000-0000-0000-000000000006'::UUID
          )
     ) THEN
    RAISE EXCEPTION 'Replace all six Auth UUID and email placeholders before provisioning.';
  END IF;

  SELECT COUNT(*) INTO auth_match_count
  FROM pg_temp.kaamflow_test_user_seed s
  JOIN auth.users u
    ON u.id = s.auth_user_id
   AND u.email = s.email;

  IF auth_match_count <> 6 THEN
    RAISE EXCEPTION 'Every supplied Auth UUID and email must match exactly one existing user in this project.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_temp.kaamflow_test_user_seed s
    JOIN auth.users u ON u.email = s.email
    WHERE u.id <> s.auth_user_id
  ) THEN
    RAISE EXCEPTION 'An email belongs to a different Auth UUID; stop and resolve manually.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.name IN ('KAAMFLOW Synthetic Test A', 'KAAMFLOW Synthetic Test B')
      AND b.slug NOT IN ('kaamflow-test-business-a', 'kaamflow-test-business-b')
  ) THEN
    RAISE EXCEPTION 'A synthetic test business name already exists under a different slug.';
  END IF;
END;
$$;

INSERT INTO public.businesses (name, slug)
VALUES
  ('KAAMFLOW Synthetic Test A', 'kaamflow-test-business-a'),
  ('KAAMFLOW Synthetic Test B', 'kaamflow-test-business-b')
ON CONFLICT (slug) DO NOTHING;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.businesses
      WHERE (slug, name) IN (
        ('kaamflow-test-business-a', 'KAAMFLOW Synthetic Test A'),
        ('kaamflow-test-business-b', 'KAAMFLOW Synthetic Test B')
      )) <> 2 THEN
    RAISE EXCEPTION 'A business slug already exists with unexpected data; no profiles were provisioned.';
  END IF;
END;
$$;

DO $$
DECLARE
  portal_email TEXT;
  business_a_id UUID;
  customer_id UUID;
  matching_customers INTEGER;
BEGIN
  SELECT email INTO portal_email
  FROM pg_temp.kaamflow_test_user_seed
  WHERE customer_profile;

  SELECT id INTO business_a_id
  FROM public.businesses
  WHERE slug = 'kaamflow-test-business-a';

  SELECT COUNT(*)
  INTO matching_customers
  FROM public.customers
  WHERE business_id = business_a_id
    AND email = portal_email;

  IF matching_customers > 1 THEN
    RAISE EXCEPTION 'Multiple customers already use the portal test email; resolve manually.';
  ELSIF matching_customers = 0 THEN
    INSERT INTO public.customers (business_id, full_name, email)
    VALUES (business_a_id, 'KAAMFLOW Synthetic Portal Customer', portal_email)
    RETURNING id INTO customer_id;
  ELSE
    SELECT id INTO customer_id
    FROM public.customers
    WHERE business_id = business_a_id
      AND email = portal_email;

    IF NOT EXISTS (
      SELECT 1
      FROM public.customers
      WHERE id = customer_id
        AND full_name = 'KAAMFLOW Synthetic Portal Customer'
    ) THEN
      RAISE EXCEPTION 'The portal test email already belongs to a different customer record.';
    END IF;
  END IF;
END;
$$;

INSERT INTO public.profiles
  (id, business_id, customer_id, email, full_name, role)
SELECT
  s.auth_user_id,
  b.id,
  CASE WHEN s.customer_profile THEN c.id ELSE NULL END,
  s.email,
  s.full_name,
  s.role
FROM pg_temp.kaamflow_test_user_seed s
JOIN public.businesses b ON b.slug = s.business_slug
LEFT JOIN public.customers c
  ON s.customer_profile
 AND c.business_id = b.id
 AND c.email = s.email
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  valid_profile_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO valid_profile_count
  FROM pg_temp.kaamflow_test_user_seed s
  JOIN public.businesses b ON b.slug = s.business_slug
  JOIN public.profiles p
    ON p.id = s.auth_user_id
   AND p.business_id = b.id
   AND p.email = s.email
   AND p.full_name = s.full_name
   AND p.role = s.role
   AND p.is_active = TRUE
  LEFT JOIN public.customers c
    ON s.customer_profile
   AND c.business_id = b.id
   AND c.email = s.email
  WHERE p.customer_id IS NOT DISTINCT FROM
    CASE WHEN s.customer_profile THEN c.id ELSE NULL END;

  IF valid_profile_count <> 6 THEN
    RAISE EXCEPTION 'Existing profile conflicts or missing customer linkage detected; no changes committed.';
  END IF;
END;
$$;

COMMIT;

SELECT p.full_name, p.role, p.is_active, b.slug,
       (p.customer_id IS NOT NULL) AS has_customer_link
FROM public.profiles p
JOIN public.businesses b ON b.id = p.business_id
WHERE p.full_name IN (
  'Test Owner A',
  'Test Service Desk',
  'Test Technician',
  'Test QC Reviewer',
  'Test Owner B',
  'Test Portal Customer'
)
ORDER BY b.slug, p.role;
