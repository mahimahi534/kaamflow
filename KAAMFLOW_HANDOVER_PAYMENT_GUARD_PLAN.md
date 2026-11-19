# Handover payment guard: implementation plan and tests

## Status

**Prepared; not verified; no database execution.** The additive fourth migration
and pgTAP acceptance file are present. The original three migrations remain
unchanged and in order. The new SQL has not been parsed by PostgreSQL, applied,
or tested.

## Existing implementation reviewed

- `private.enforce_job_workflow_requirements()` in
  `supabase/migrations/20261118100000_kaamflow_workflow_hardening.sql` checks
  the latest QC result for `completed` and `handover`, and permits a
  reasoned `OWNER_ADMIN` QC override. It does not query invoices or payments.
- `updateJobStatusAction()` in `lib/actions/jobs.ts` prechecks QC and passes
  the QC override fields; it has no outstanding-balance check or payment
  override path. This client-side action is not a substitute for a database
  guard.
- Before the fourth migration, the trigger logged job status changes and QC
  override reasons but had no payment override event. The new migration adds
  distinct payment and QC override activity events.
- `record_manual_invoice_payment()` locks the invoice and records payments
  atomically. The existing workflow-hardening migration already revokes direct
  authenticated `INSERT` and `UPDATE` on invoices; its RLS write policies do
  not grant those SQL privileges. Keep and verify these revokes. The guard
  should still derive the balance from the ledger rather than trust a
  potentially stale `payment_status`.
- The repository had no automated database test harness. A pgTAP acceptance
  file is now prepared at
  `supabase/tests/202611_handover_payment_guard.test.sql`; it has not been run.

## Fourth migration design and review

### 1. Preserve migration order

The first three files are unchanged:

1. `20261116084000_kaamflow_core.sql`
2. `20261118090000_kaamflow_mvp_completion.sql`
3. `20261118100000_kaamflow_workflow_hardening.sql`
4. `20261118110000_kaamflow_handover_payment_guard.sql`

The fourth is additive, follows the workflow-hardening migration, uses an
explicit transaction, and contains no table/data drops or override backfill.
Do not run any of the four until SQL review is complete and the disposable
project gate is met.

### 2. Invoice balance source

- The migration preserves the existing `REVOKE INSERT, UPDATE ON public.invoices
  FROM authenticated` in the workflow-hardening migration. The code search
  found no application call site that directly inserts or updates invoices;
  invoice creation and payment updates use the security-definer RPCs
  `create_invoice_from_job()` and `record_manual_invoice_payment()`.
- It computes the balance from `invoices.total_amount` less payment ledger
  sums; `payment_status` alone cannot establish settlement.
- Its shared billing-state helper locks every invoice for the business/job in
  deterministic ID order before calculating. It considers every invoice,
  even though the payment RPC selects one invoice.
- A waived invoice passes only if its ledger-derived outstanding balance is
  zero; a waived invoice with a positive balance is rejected even for Owner.

### 3. Database enforcement and auditing

- The replacement workflow trigger applies the same QC requirement to
  `completed`, `handover`, and `closed`; payment requirements apply to
  `handover` and `closed`. The UI labels `closed` as “Closed / Handed Over.”
- Missing invoices and positive balances require a fresh transition through
  `transition_job_to_handover()`. Only an active same-business `OWNER_ADMIN`
  can supply the 10–1000 character payment-override reason. `DISPATCHER`,
  `TECHNICIAN`, `QC_REVIEWER`, inactive, anonymous, and cross-business callers
  cannot authorize the exception. `completed` remains distinct.
- The RLS-enabled `public.handover_payment_overrides` table has no direct
  client or service-role grants. The authorized RPC creates a transaction-ID
  scoped row; the trigger verifies and consumes it exactly once. Direct job
  updates cannot create or replay authorizations.
- The trigger logs `HANDOVER_PAYMENT_OVERRIDE` with actor, reason, invoice IDs,
  missing-invoice state, and amount. QC exceptions also create a
  `JOB_QC_OVERRIDE` event. Audit rows, consumed authorization, and job status
  update are transactional.
- If invoice balance is zero, no payment override is needed. A waived invoice
  is accepted only with zero actual balance. Handover without an invoice is
  possible only through a reasoned Owner override.

### 4. Keep the application flow aligned

- Keep the database trigger authoritative; do not rely on a UI-only balance
  lookup.
- The status Server Action now routes both `handover` and `closed` through
  `transition_job_to_handover`; it does not directly update those statuses.
- The Owner-only dialog asks for a mandatory payment and/or QC reason only
  when the RPC reports that exception is needed. If both are needed, it keeps
  the first reason and adds the second field before retrying with both values.
- The Server Action validates Owner authorization and reason lengths; the RPC
  and trigger remain the authoritative checks. Dispatchers get a clear blocked
  message and no override interface.
- Duplicate client submissions are locked while pending. Retrying an uncertain
  result resends the same operation; the RPC's already-at-target no-op avoids
  duplicate override audit events.
- The RPC sets `handed_over_at` on `handover` and `closed`. Existing
  `completed` behavior remains distinct and unchanged.
- Application-level RPC-wrapper tests are present in
  `lib/jobs/handover-transition.test.ts`; all 11 pass locally, but they use a
  mocked RPC and do not prove PostgreSQL behavior.

## Focused acceptance tests

`supabase/tests/202611_handover_payment_guard.test.sql` prepares rollback-only
synthetic fixtures and focused pgTAP assertions. It expects the five profiles
from the test-account guide, runs as a database administrator, simulates JWT
subjects for the security-definer transitions, and checks effective grants.
It does not test RLS row visibility or live concurrency. It has not been run.
Use it only in the confirmed disposable project after all four migrations are
reviewed and applied.

| Case | Expected result |
| --- | --- |
| Paid in full from ledger, `payment_status` says `paid` | Owner/Dispatcher may hand over; no override event |
| Positive ledger balance, Owner/Dispatcher has no reason | Handover rejected; no job status or audit change |
| Positive balance, Dispatcher supplies a reason/actor | Rejected; no override event |
| Positive balance, Technician supplies a reason | Rejected |
| Positive balance, active same-business Owner uses the transition RPC with a reason | Handover succeeds; exactly one fresh payment-override authorization and audit event records actor, reason, invoice IDs, and balance |
| Positive balance, Owner from another business | Rejected; no cross-tenant read/write or audit row |
| Positive balance, inactive Owner | Rejected |
| Existing QC override but no payment override | Still rejected for positive balance |
| Both QC and payment requirements fail | One transition succeeds only when both separate Owner reasons are supplied; both audit facts are retained |
| Attempt transition to `closed` with positive balance | Rejected or requires the same Owner payment override as `handover` |
| Transition to `completed` with positive balance | Allowed if other current workflow guards pass; handover is still blocked |
| No invoice | Normal handover rejected; an active Owner can proceed only with a reason and audit record |
| Disposable-only fixture has `payment_status = 'paid'` or `'waived'` with positive ledger balance | Authenticated handover remains blocked based on ledger; ordinary direct invoice mutation is denied |
| Invoice amount edit or direct invoice insert by authenticated staff | Permission denied; RPC paths remain functional |
| Multiple invoices with any aggregate positive balance | Blocked unless Owner override; audit records aggregate due and invoice IDs |
| Concurrent payment completes before handover check | Handover sees committed payment and uses the resulting balance |
| Concurrent handover check wins the invoice lock first | It blocks or records the authorized override; payment does not race past the check |
| Override reason is whitespace, too short/long; direct status update attempts to replay an old authorization | Rejected; no status change or override audit event |
| Override audit insertion fails | Entire status update rolls back |
| Repeat a paid handover update / no-op status update | No duplicate override event |
| Original three migrations plus new fourth on a fresh disposable database | All succeed in order; RLS, grants, existing RPC payment flow, quote, and QC tests still pass |

The runbook also includes a two-session concurrency procedure. Static lock
review shows the transition locks the job then all invoices deterministically;
payment locks invoice rows and does not lock the job, so there is no inverse
job/invoice lock order. This is a review conclusion, not runtime evidence.

## Decisions and blockers before execution

1. PostgreSQL-parse and run the pgTAP suite; test the two-session race and
   authenticated application status flow. No database verification is claimed
   before these pass.
2. Configure the separate test project's credentials locally and explicitly
   confirm it is disposable. Confirm PostgreSQL is at least 15.
3. Set up the five staff accounts across two businesses; add the optional
   `CUSTOMER` account for customer-facing quotation approval.
4. Execute all four migrations only after review and explicit disposable-target
   confirmation. No production access is authorized.

No migration has been run, no account/business has been created, and no
database has been contacted for this plan.
