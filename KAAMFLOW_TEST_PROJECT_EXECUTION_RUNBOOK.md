# KAAMFLOW disposable test-project execution runbook

## Status and safety gate

The user is preparing a separate Supabase project named `kaamflow-test`.
Credentials and disposable status are not yet confirmed. **Nothing in this
runbook has been executed.** Do not run migrations, create Auth users/businesses,
or connect to any Supabase project until the user configures the test
credentials locally and explicitly confirms the project is disposable.

**Additional execution blocker:** the payment-before-handover migration and
pgTAP acceptance files are prepared locally but have not been parsed against
PostgreSQL or executed. Do not connect or run any migration until the user
configures the disposable project locally and explicitly confirms it is
disposable. See
[KAAMFLOW_HANDOVER_PAYMENT_GUARD_PLAN.md](./KAAMFLOW_HANDOVER_PAYMENT_GUARD_PLAN.md).

Never use production, a service-role key, real customer data, or production
accounts for these steps. Do not paste credentials or access tokens into SQL,
chat, source files, or test reports.

## Migration inventory and order

The four migration files present are:

1. [`20261116084000_kaamflow_core.sql`](./supabase/migrations/20261116084000_kaamflow_core.sql)
2. [`20261118090000_kaamflow_mvp_completion.sql`](./supabase/migrations/20261118090000_kaamflow_mvp_completion.sql)
3. [`20261118100000_kaamflow_workflow_hardening.sql`](./supabase/migrations/20261118100000_kaamflow_workflow_hardening.sql)
4. [`20261118110000_kaamflow_handover_payment_guard.sql`](./supabase/migrations/20261118110000_kaamflow_handover_payment_guard.sql)

The timestamp order is the dependency order:

- **Core:** creates the base enums, 21 core tables, tenant-composite keys,
  helpers, RLS policies, and private evidence bucket.
- **MVP completion:** depends on those base tables, extends profile/job/request
  columns, adds `profiles.is_active`, then creates five additional tables,
  their composite foreign keys, policies, grants, and checklist seeds.
- **Workflow hardening:** depends on both earlier migrations, including
  `profiles.is_active` and the MVP tables. It adds/replaces authorized RPCs,
  workflow/audit triggers, token-version handling, and final function grants.
- **Handover payment guard:** depends on the workflow trigger, jobs, invoices,
  payment ledger, active profiles, and activity log. It adds one-time Owner
  override and transition-authorization tables, a same-business/same-job
  payment-to-invoice foreign key, the billing-state helper, the authorized
  transition RPC, and the final handover/CLOSED checks.

There are no other `.sql` migration files in `supabase/migrations/`. The
explicit owner provisioning script depends on the completed
`profiles.is_active` column, so run account provisioning only after all four
migrations succeed.

Static inspection confirms the files and dependency order only. SQL parsing,
fresh-database application, and re-run behavior remain unverified.

## Prepared application steps — do not run yet

The repository has no `supabase/config.toml` or Supabase migration CLI script.
Use the Dashboard SQL Editor for this test preparation; do not run
`supabase db push` or guess a CLI project link.

After both safety gates are met—test credentials are configured locally and
the user explicitly confirms `kaamflow-test` is disposable:

1. Open Supabase Dashboard and select the project named `kaamflow-test`.
   Verify its project reference in the Dashboard. Confirm it is not production.
2. Confirm `.env.local` contains the exact URL and matching public key from
   this same test project. Do not print or share either value.
3. In **SQL Editor**, create a new query and run this read-only version check:

   ```sql
   SHOW server_version;
   ```

   Proceed only if the project is PostgreSQL 15 or newer. The composite
   foreign keys use column-specific `ON DELETE SET NULL` syntax.
4. In the SQL Editor create a new query. Copy the **entire contents** of
   `20261116084000_kaamflow_core.sql` into the editor and run it. Confirm the
   editor reports success before continuing.
5. Repeat with the **entire contents** of
   `20261118090000_kaamflow_mvp_completion.sql`.
6. Only after step 5 succeeds, repeat with the **entire contents** of
   `20261118100000_kaamflow_workflow_hardening.sql`.
7. Only after step 6 succeeds, run the reviewed fourth migration
   `20261118110000_kaamflow_handover_payment_guard.sql`.
8. If any file reports an error, **stop**. Do not continue to the next file or
   blindly rerun the failed file. The core migration has explicit
   `BEGIN`/`COMMIT`; the MVP and workflow files do not. Inspect the error and
   actual schema state in the disposable project before deciding how to
   recover. Do not repair by dropping tables or resetting the database.
9. After all four succeed, run the read-only catalog checks in
   [KAAMFLOW_TEST_ACCOUNT_SETUP_GUIDE.md](./KAAMFLOW_TEST_ACCOUNT_SETUP_GUIDE.md):
   version, 28 expected RLS-enabled tables (the existing 26 plus the two
   handover authorization tables), policy definitions, validated composite
   constraints, function/table privileges, token-version counts, and invoice
   direct-write privileges.
10. Only after confirming the schema, create the two synthetic businesses,
   then the five requested Auth users and profiles using the guide. Never use
   the SQL Editor to test user-facing RLS; its privileges are elevated.
11. After the five staff accounts and two businesses are ready, run
    [`202611_handover_payment_guard.test.sql`](./supabase/tests/202611_handover_payment_guard.test.sql)
    in the disposable project's SQL Editor. It requires pgTAP and uses
    transaction-scoped synthetic fixtures and ends with `ROLLBACK`.
12. Create the sixth `CUSTOMER` test profile as described in the account guide,
    then run
    [`202611_database_security_acceptance.test.sql`](./supabase/tests/202611_database_security_acceptance.test.sql).
    This suite switches to `authenticated` for two-business RLS, payment RPC,
    token, quotation, failed-QC, and direct-update checks. It also tests
    cross-tenant/cross-job foreign-key rejection. It uses synthetic fixtures
    and ends with `ROLLBACK`. Review every TAP result and stop if any test
    fails.
13. Run the separate two-session concurrency procedure below. A
    transaction-bound pgTAP script cannot prove behavior across concurrently
    held database sessions.

Do not combine all migrations into a single pasted query, reorder them, run
only selected statements, or add `DROP`/reset commands.

## Final test checklist

Use synthetic records and separate private browser sessions. Test with the
ordinary authenticated accounts, not the SQL Editor or service role, except
for explicitly read-only catalog queries.

### A. Migration and schema checks

- [ ] Dashboard is the confirmed disposable `kaamflow-test` project.
- [ ] PostgreSQL reports version 15 or newer.
- [ ] All four migrations completed in the order above without errors.
- [ ] Exactly the expected 28 KAAMFLOW tables are present: the existing 26
      plus `public.handover_payment_overrides` and
      `public.handover_transition_authorizations`.
- [ ] RLS is enabled on each; inspect `pg_policies` and effective grants.
- [ ] Same-business foreign keys are present and `convalidated = true`.
- [ ] Payment table direct INSERT is denied to `authenticated`; payment RPC
      EXECUTE is allowed to `authenticated` and denied to `anon`.
- [ ] `payments_invoice_job_same_business` enforces matching business and job.
- [ ] Do not claim runtime verification based only on catalog results.

### B. Five-user / two-business isolation

- [ ] Business A has Owner A, Service Desk A (`DISPATCHER`), Technician A,
      and QC Reviewer A.
- [ ] Business B has Owner B.
- [ ] Each profile uses the exact Auth UUID, correct test business, expected
      role, and `is_active = true`.
- [ ] Owner A creates a synthetic A-only customer/job; Owner B creates a
      different B-only customer/job.
- [ ] A roles cannot read or mutate B records; B owner cannot read or mutate A.
- [ ] Technician A sees only assigned A jobs; unassigned and B jobs are denied.
- [ ] Deactivate one disposable profile and verify its policies/RPCs deny access.
- [ ] An attempt to create a row with a different business's foreign record ID
      fails the composite constraint. Use a disposable-only negative test and
      confirm no row remains.

### C. Payment RPC and idempotency

- [ ] Create a synthetic job with approved quote and invoice.
- [ ] As the same active Owner/Dispatcher account, call the RPC with a fresh
      UUID request key and a small test amount.
- [ ] Retry with the identical key and payload: it returns the same payment ID
      and creates only one payment/activity record.
- [ ] Reuse that key with a different amount, method, job, or notes: it fails.
- [ ] A fresh key with an amount greater than the remaining balance fails.
- [ ] A waived invoice rejects payment.
- [ ] Direct authenticated table INSERT into `payments` fails.
- [ ] Do not use a real payment gateway or real funds.

### D. Tracking tokens

- [ ] Create a token through the app for a synthetic job; keep the plaintext
      link private and do not put it in reports.
- [ ] A valid link shows only customer-safe status/quote/parts information.
- [ ] Staff client cannot select `token_hash`; a catalog check shows new
      records at version 1 with digest-shaped hashes without printing values.
- [ ] Verify a revoked link and an expired link are rejected.
- [ ] If disposable version-0 data exists, verify a valid legacy link still
      works and is upgraded; do not manufacture a legacy row containing a
      plaintext bearer token just for the test.

### E. Quotation approval

- [ ] A job cannot move into `in_progress` while a required quotation lacks
      approval, except through the documented Owner waiver with a reason.
- [ ] Send a draft quotation and verify only its linked customer can see/respond
      to the latest sent version.
- [ ] For customer-portal approval, create the optional sixth Auth user with
      role `CUSTOMER`, linked to the synthetic customer. Five staff users alone
      cannot exercise customer approval.
- [ ] Approve the latest version and verify approval row/version/job status;
      try a wrong customer, old version, declined version, inactive profile,
      and duplicate response and expect denial.
- [ ] If the optional customer account is not created, test staff/offline
      approval only and label customer approval **NOT TESTED**.

### F. QC, payment guard, and handover

- [ ] Only active `OWNER_ADMIN`, `DISPATCHER`, or `QC_REVIEWER` can submit QC;
      Technician cannot call the QC RPC.
- [ ] QC submission only accepts a job in `qc_review`.
- [ ] Failed QC returns the job to `in_progress`, clears `qc_passed_at`, and
      increments the rework count.
- [ ] Passing QC records a pass and `qc_passed_at`.
- [ ] Moving a job to `completed` or `handover` without a latest passing QC is
      rejected. After pass, verify the expected transition succeeds.
- [ ] Technician cannot transition a job to `completed` or `handover`.
- [ ] An override is permitted only to an Owner with a non-empty reason and
      matching actor ID; verify other roles cannot use it.
- [ ] Payment guard: positive ledger-derived balance blocks `handover` and
      `closed` for Dispatcher/Technician and for an Owner without a reason.
- [ ] Active same-business Owner can override a positive balance only with a
      new reason; one audit event records actor, reason, invoice IDs, and due.
- [ ] `completed` remains distinct from handing over and may be reached while
      unpaid; transition to `handover`/`closed` remains gated.
- [ ] Missing invoice blocks handover except through a documented active-Owner
      override; forged `payment_status = paid/waived` cannot bypass an
      outstanding ledger balance.
- [ ] A waived invoice with a positive ledger balance remains blocked even for
      an Owner; a waived invoice is acceptable only when its ledger balance is
      zero.
- [ ] Existing migration revokes direct authenticated invoice `INSERT`/`UPDATE`;
      verify they remain effective while invoice creation/payment RPCs still work.
- [ ] Run the pgTAP payment-guard suite and confirm every assertion passes.
- [ ] Run the database-security pgTAP suite and confirm the RLS, payment retry,
      failed-QC, tracking-token, customer-approval, composite-FK, and direct
      terminal-status assertions pass.
- [ ] Direct authenticated updates to `handover`/`closed` fail even for
      settled, QC-passed jobs; the authorized RPC succeeds and ordinary
      non-terminal status updates remain available.
- [ ] Cross-business, inactive-owner, stale-reason, audit-failure, and
      concurrent-payment cases pass the focused matrix in
      [KAAMFLOW_HANDOVER_PAYMENT_GUARD_PLAN.md](./KAAMFLOW_HANDOVER_PAYMENT_GUARD_PLAN.md).
- [ ] Perform the two-session payment-vs-handover lock test below.

### G. Two-session concurrency check

Run this only in the confirmed disposable project, using two separate local
PostgreSQL sessions and synthetic test identities. Keep connection strings and
JWT values out of the report.

1. Prepare a synthetic job with one positive-balance invoice and passing QC.
2. In session A, begin a transaction, set the test owner's or dispatcher's
   JWT subject, and call `record_manual_invoice_payment()` for the exact
   remaining balance. Leave the transaction open so it retains the invoice
   lock.
3. In session B, begin a transaction, set the same business's Service Desk
   JWT subject, and call `transition_job_to_handover(job_id, 'handover', NULL,
   NULL)`. It should wait for session A's invoice lock.
4. Commit session A. Session B should finish successfully after re-reading the
   ledger and finding zero balance. Commit session B.
5. Repeat with a fresh unpaid synthetic job and let session B's normal
   handover check acquire the invoice lock first. It must reject the unpaid
   handover. Roll back session B's aborted transaction to release its locks,
   then verify session A's payment can proceed.

The payment RPC locks invoice rows; the transition RPC locks the job then
invoice rows in deterministic order. Payment does not lock the job, avoiding
an inverse lock-order cycle. This is a test procedure, not runtime evidence.

Keep test output to pass/fail, synthetic record IDs, and sanitized SQL errors.
Never include passwords, access tokens, publishable-key values, or plaintext
tracking links in the report.

## Migration failure recovery

- Never reset, drop, or blindly rerun a failed migration.
- The core and fourth migration wrap their statements in explicit
  `BEGIN`/`COMMIT`. If either fails before commit, confirm the editor reports
  rollback; issue `ROLLBACK` only if that same transaction is still open.
- The MVP and workflow-hardening migrations are not wrapped in a transaction.
  A SQL Editor error can leave earlier statements committed. Stop and inspect
  catalogs and object definitions before any retry. Prefer a reviewed additive
  repair migration; do not remove rows or disable RLS.
- The new payment composite-FK validation fails without rewriting rows if it
  finds a payment whose invoice belongs to another job/business. Inspect and
  resolve each mismatch explicitly before retrying.
- A successful migration has no automatic down migration. Preserve test
  evidence and use a separately reviewed forward correction if needed.

## Remaining blockers

1. The test project's credentials are not yet configured locally, and the user
   has not yet explicitly confirmed it is ready and disposable.
2. PostgreSQL version is unknown; 15+ must be confirmed.
3. The earlier REST HTTP 401 cause is still unknown. Re-test only against the
   confirmed disposable project after credentials are configured; do not probe
   the existing/production target.
4. No SQL parser/application, pgTAP suite, authenticated RLS test, or
   two-session concurrency test has been performed.
5. The sixth CUSTOMER test profile is required for customer quote-approval
   tests.
6. The updated migration and test scripts remain unverified until they pass on
   the disposable database. Do not claim database verification beforehand.

Wait for the user's explicit readiness confirmation before any database
connection, migration, or account creation.
