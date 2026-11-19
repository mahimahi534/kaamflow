# KAAMFLOW disposable Supabase test-account setup

## Important safety gate

The user is preparing a separate disposable project named `kaamflow-test`;
its credentials and test accounts are not yet confirmed, and no migration has
been run. Use this guide only after the project is configured locally and its
disposable status is explicitly confirmed.
Do not use the production project, production Auth users, customer data, or
service-role keys. Do not put passwords, access tokens, or secret keys in SQL,
source files, chat, or reports.

The app's supported roles are `OWNER_ADMIN`, `DISPATCHER`, `TECHNICIAN`,
`QC_REVIEWER`, and `CUSTOMER`. The requested `SERVICE_DESK` role does not
exist; provision the Service Desk test user as `DISPATCHER`.

## 1. Confirm the disposable project

1. Create a separate Supabase project intended only for testing.
2. Confirm its project name/reference in the Dashboard. Do not infer this from
   an environment variable or a copied URL.
3. Copy the exact Project URL and its matching publishable key from that
   project's Dashboard. Add them locally as
   `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local`.
4. Restart the local app after changing environment variables. Do not send the
   key or `.env.local` contents to anyone.
5. Before SQL Editor use, verify the Dashboard header still shows the
   disposable project. The migration review notes a PostgreSQL 15+ syntax
   requirement.

This guide does not authorize applying migrations. The current task explicitly
left them unapplied.

## 2. Create test Auth users

In the disposable project's Dashboard, open **Authentication → Users** and
create five separate accounts using test email addresses you control:

| Test account | Business | Stored role |
| --- | --- | --- |
| Owner A | Test business A | `OWNER_ADMIN` |
| Service Desk A | Test business A | `DISPATCHER` |
| Technician A | Test business A | `TECHNICIAN` |
| QC Reviewer A | Test business A | `QC_REVIEWER` |
| Owner B | Test business B | `OWNER_ADMIN` |

These are the five requested staff accounts. The focused
`202611_database_security_acceptance.test.sql` suite also requires a sixth Auth
user for business A with role `CUSTOMER`; that profile must link to a synthetic
customer row. Without this account, customer quotation approval cannot be
tested; the handover-guard suite still uses the five staff profiles.

Use the project's intended confirmation settings. Copy each exact Auth user
UUID and email from the Dashboard. Keep passwords in your password manager;
they are not needed in SQL.

## 3. Create two isolated test businesses

Only after all migrations have been reviewed and the disposable target has
been confirmed, create two uniquely named businesses in the SQL Editor. Replace
the sample slugs with unique test-only slugs. `ON CONFLICT DO NOTHING`
preserves an existing business row rather than renaming it.

```sql
INSERT INTO public.businesses (name, slug)
VALUES
  ('KAAMFLOW Disposable A', 'kaamflow-disposable-a-replace-me'),
  ('KAAMFLOW Disposable B', 'kaamflow-disposable-b-replace-me')
ON CONFLICT (slug) DO NOTHING;
```

Verify both rows before provisioning profiles:

```sql
SELECT id, name, slug
FROM public.businesses
WHERE slug IN (
  'kaamflow-disposable-a-replace-me',
  'kaamflow-disposable-b-replace-me'
);
```

## 4. Link users to exact businesses and roles

Replace every UUID, email, name, and slug placeholder. Run only on the
disposable project after migrations are applied. The insert checks that each
UUID/email pair exists in `auth.users`; `ON CONFLICT (id) DO NOTHING` never
reassigns or changes an existing profile. Stop and investigate if a row is
missing or a conflict occurs.

```sql
WITH test_users (user_id, email, full_name, role, business_slug) AS (
  VALUES
    ('OWNER_A_AUTH_UUID'::uuid, 'OWNER_A_TEST_EMAIL', 'Test Owner A', 'OWNER_ADMIN', 'kaamflow-disposable-a-replace-me'),
    ('SERVICE_DESK_AUTH_UUID'::uuid, 'SERVICE_DESK_TEST_EMAIL', 'Test Service Desk', 'DISPATCHER', 'kaamflow-disposable-a-replace-me'),
    ('TECHNICIAN_AUTH_UUID'::uuid, 'TECHNICIAN_TEST_EMAIL', 'Test Technician', 'TECHNICIAN', 'kaamflow-disposable-a-replace-me'),
    ('QC_REVIEWER_AUTH_UUID'::uuid, 'QC_REVIEWER_TEST_EMAIL', 'Test QC Reviewer', 'QC_REVIEWER', 'kaamflow-disposable-a-replace-me'),
    ('OWNER_B_AUTH_UUID'::uuid, 'OWNER_B_TEST_EMAIL', 'Test Owner B', 'OWNER_ADMIN', 'kaamflow-disposable-b-replace-me')
)
INSERT INTO public.profiles (id, business_id, email, full_name, role)
SELECT u.user_id, b.id, au.email, u.full_name, u.role
FROM test_users u
JOIN auth.users au
  ON au.id = u.user_id
 AND au.email = u.email
JOIN public.businesses b
  ON b.slug = u.business_slug
ON CONFLICT (id) DO NOTHING;
```

Verify all five links explicitly; do not include passwords or session tokens:

```sql
SELECT p.id, p.email, p.role, p.is_active, b.slug
FROM public.profiles p
JOIN public.businesses b ON b.id = p.business_id
WHERE p.email IN (
  'OWNER_A_TEST_EMAIL',
  'SERVICE_DESK_TEST_EMAIL',
  'TECHNICIAN_TEST_EMAIL',
  'QC_REVIEWER_TEST_EMAIL',
  'OWNER_B_TEST_EMAIL'
)
ORDER BY b.slug, p.role;
```

Expected output: four active accounts in business A, one active owner in
business B. If any profile already exists with a different business/role,
stop; do not use an upsert to silently move it.

The standalone
[provision-first-owner.sql](./scripts/provision-first-owner.sql) script now
requires an explicit user UUID and existing business slug, and is insert-only.
It is not a substitute for this multi-role setup.

### Optional customer profile for quote-approval testing

After Owner A creates a synthetic customer in business A with the same test
email as the optional Auth user, copy that customer's exact UUID and replace
the placeholders below. This insert-only statement does not move or modify an
existing profile:

```sql
INSERT INTO public.profiles (id, business_id, customer_id, email, full_name, role)
SELECT au.id, c.business_id, c.id, au.email, 'Test Portal Customer', 'CUSTOMER'
FROM auth.users au
JOIN public.customers c
  ON c.id = 'CUSTOMER_ROW_UUID'::uuid
 AND c.email = au.email
JOIN public.businesses b ON b.id = c.business_id
WHERE au.id = 'CUSTOMER_A_AUTH_UUID'::uuid
  AND au.email = 'CUSTOMER_A_TEST_EMAIL'
  AND b.slug = 'kaamflow-disposable-a-replace-me'
ON CONFLICT (id) DO NOTHING;
```

Verify the linked `customer_id`, business slug, role, and active status before
signing in as this customer.

## 5. RLS and tenant-isolation test checklist

Use a private browser session per account. Record only pass/fail and test
record IDs; do not capture passwords, tokens, or personal data.

Before access tests, use Owner A in the app to create a clearly synthetic
customer, asset, and service request/job in business A. Repeat with Owner B in
business B using different `TENANT-A-<suffix>` and `TENANT-B-<suffix>` labels.
Do not use real customer data. Test via the signed-in accounts' normal
authenticated sessions; the SQL Editor runs with elevated privileges and is
not a valid way to test RLS.

1. **Owner A:** can see/create records in business A; cannot list, read, edit,
   or delete business B records.
2. **Service Desk A (`DISPATCHER`):** can use allowed service-desk workflows
   within A; cannot access B.
3. **Technician A:** can read/update only assigned A jobs; cannot see
   unassigned jobs or any B records. Try an unauthorized direct REST request
   as well as the UI.
4. **QC Reviewer A:** can review/submit QC only for eligible A jobs; cannot
   write payment, customer, or B records.
5. **Owner B:** can access B records but not A records. This confirms
   isolation in both directions.
6. Attempt cross-business foreign-key combinations in the disposable
   database. They must be rejected by the composite constraints; do not use
   real data.
7. **Payments:** On a synthetic job with an approved quote and invoice, use an
   authenticated `OWNER_ADMIN`/`DISPATCHER` session and a small test amount.
   Direct authenticated `INSERT` into `payments` must be denied. Call the
   payment RPC twice with the exact same UUID request key and payload; it
   should return the same payment ID and leave one payment row. Reusing the key
   with a different amount/method must fail. A different key with an
   over-balance amount and any payment against a waived invoice must also fail.
   Do not use the SQL Editor as the caller for RPC authorization tests because
   it does not represent the signed-in test user.
8. Test tracking links using a new link and, if available, a disposable legacy
   version-0 row. Verify expiry/revocation and that only a digest remains after
   a valid legacy redemption.
9. Verify inactive profiles cannot call staff/customer RPCs or access records.
10. Inspect database catalogs using the read-only queries below. Also try one
    cross-tenant foreign-key reference in a transaction/expected-error test;
    it must fail and leave no row.

### Read-only catalog checks (disposable project only)

Run these after migrations; do not run the migrations or account inserts as
part of this preparation.

PostgreSQL compatibility:

```sql
SHOW server_version;
```

Confirm RLS is enabled for the KAAMFLOW tables:

```sql
SELECT c.relname, c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'businesses', 'profiles', 'customers', 'assets', 'service_requests',
    'jobs', 'diagnoses', 'evidence', 'quote_versions', 'quotes', 'approvals',
    'assignments', 'repair_logs', 'parts_used', 'qc_records', 'invoices',
    'warranty_terms', 'follow_ups', 'outcomes', 'comeback_cases',
    'activity_logs', 'payments', 'customer_tracking_tokens', 'complaints',
    'parts_orders', 'checklist_templates', 'handover_payment_overrides',
    'handover_transition_authorizations'
  )
ORDER BY c.relname;
```

After the planned fourth payment-guard migration is added and applied to the
disposable project, expect 28 rows, all `relrowsecurity = true`. Before that
migration, the current three-file schema has 26 rows. Then inspect the policy
expressions and checks (do not infer effective behavior from policy text
alone):

```sql
SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

Inspect the composite foreign-key definitions and validation state:

```sql
SELECT conrelid::regclass AS table_name,
       conname,
       convalidated,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype = 'f'
  AND pg_get_constraintdef(oid) LIKE '%(business_id,%'
ORDER BY conrelid::regclass::text, conname;
```

Expected constraints should pair `business_id` with the referenced record ID
and have `convalidated = true`. Verify that
`payments_invoice_job_same_business` references `(business_id, job_id,
invoice_id)` to `(business_id, job_id, id)` on `invoices`. Also verify the
payment privileges:

```sql
SELECT has_table_privilege('authenticated', 'public.payments', 'INSERT')
         AS authenticated_can_insert_payment,
       has_function_privilege(
         'authenticated',
         'public.record_manual_invoice_payment(uuid,numeric,text,uuid,text)',
         'EXECUTE'
       ) AS authenticated_can_call_payment_rpc,
       has_function_privilege(
         'anon',
         'public.record_manual_invoice_payment(uuid,numeric,text,uuid,text)',
         'EXECUTE'
       ) AS anon_can_call_payment_rpc;
```

Expected: `authenticated_can_insert_payment = false`,
`authenticated_can_call_payment_rpc = true`, and
`anon_can_call_payment_rpc = false`. Validate RLS behavior separately using the
five signed-in test users, not these privileged catalog queries.

For tracking tokens, inspect only counts and version/format—not token values:

```sql
SELECT token_hash_version,
       count(*) AS token_count,
       count(*) FILTER (WHERE token_hash ~ '^[0-9a-f]{64}$') AS digest_shaped
FROM public.customer_tracking_tokens
GROUP BY token_hash_version
ORDER BY token_hash_version;
```

The staff client must not be able to select `token_hash`; newly created links
should be version 1. Keep generated plaintext links private, and test expiry
and revocation through the tracking page.

Do not claim RLS, authentication, payment, token, or workflow verification
until these tests pass on the disposable project. Keep the project's reset or
deletion actions unused until test evidence has been saved outside production.

For the ordered Dashboard SQL Editor runbook and the final quotation/QC/
handover checklist, see
[KAAMFLOW_TEST_PROJECT_EXECUTION_RUNBOOK.md](./KAAMFLOW_TEST_PROJECT_EXECUTION_RUNBOOK.md).
