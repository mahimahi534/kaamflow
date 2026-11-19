# KAAMFLOW migration security review

**Review type:** Static SQL/code review only.  
**Execution status:** No migration has been run.  
**Database status:** The user is preparing a separate project named
`kaamflow-test`; credentials and test accounts are not yet confirmed.  
**Production status:** No production connection, migration, reset, or account change
was made during this review.

## Migration order and dependency review

Apply only to a confirmed disposable project, in this order:

1. `supabase/migrations/20261116084000_kaamflow_core.sql`
2. `supabase/migrations/20261118090000_kaamflow_mvp_completion.sql`
3. `supabase/migrations/20261118100000_kaamflow_workflow_hardening.sql`
4. `supabase/migrations/20261118110000_kaamflow_handover_payment_guard.sql`

The core migration creates the base tenant tables, enums, helper functions,
policies, and private evidence bucket. The MVP migration adds payments,
tracking tokens, complaints, parts orders, and checklist templates. The
workflow migration adds atomic RPCs, validation triggers, audit triggers,
token compatibility, and final permissions. The fourth adds a protected
handover transition RPC, a ledger-based balance helper, private override and
transition-authorization tables, and a payment-to-invoice composite key that
also enforces same-job integrity.

| Review area | Status | Static finding |
| --- | --- | --- |
| Dependency order | PASS / NOT TESTED | Referenced base tables are declared before the MVP additions; workflow functions follow the tables and helpers they call. No database parser/runtime test was possible. |
| Duplicate table declarations | PASS | The first three migrations declare 26 tables; the fourth adds two, for 28 total. It does not duplicate an existing table declaration. |
| Row Level Security | PASS / NOT TESTED | Static scan finds RLS enabled for all 28 declared tables. Runtime policies and effective grants remain unverified. |
| Tenant-composite foreign keys | FIXED / NOT TESTED | The later MVP tables pair `business_id` with job, invoice, customer, and profile references as applicable. The fourth migration extends payment integrity to `(business_id, job_id, invoice_id)` → invoices `(business_id, job_id, id)`. Existing rows are not rewritten; `VALIDATE CONSTRAINT` stops safely on mismatches. |
| Indexes | PASS / NOT TESTED | Tenant lookup, queue, payment request-key, invoice/payment, complaint, parts-order, and active tracking-token indexes are declared. Actual query plans and duplicate legacy data are not tested. |
| Payment writes | FIXED / NOT TESTED | Direct authenticated payment insert is removed and revoked. The workflow migration also revokes direct authenticated invoice INSERT/UPDATE. The staff RPC validates active role, amount, method, notes and balance, locks the invoice, records payment/status/audit atomically, and uses an idempotency key. The former four-argument RPC signature is revoked when present. |
| Payment retries | FIXED / NOT TESTED | A per-business unique request key returns the existing payment for the same actor and payload, and rejects key reuse with a different payload. UI retries retain the key after failure and rotate it after success. |
| Payment prerequisite for handover | IMPLEMENTED IN GENERATED SQL / NOT TESTED | The fourth migration gates `handover` and `closed` on ledger-derived balance and passing QC. Missing invoice or positive balance requires an active same-business Owner through a protected RPC; waived invoices with positive ledger balance remain blocked. |
| Direct status-update bypass | IMPLEMENTED IN GENERATED SQL / NOT TESTED | A private authorization table is RLS-enabled with direct grants revoked. The job trigger consumes transaction-scoped authorization for every `handover`/`closed` transition, including otherwise-paid/QC-passed jobs. Ordinary non-terminal updates remain separate. Trigger behavior still needs database tests. |
| Payment override authorization and audit | IMPLEMENTED IN GENERATED SQL / NOT TESTED | The migration uses one-time transaction-scoped authorization with no direct client grants and writes an audit event in the same transaction. |
| Handover concurrency | STATIC REVIEW PASS / NOT TESTED | The transition locks the job and then all invoices in deterministic ID order; the payment RPC does not take a job lock. Runbook two-session concurrency testing remains pending. |
| Checklist seeding | FIXED | Seed conflicts use `DO NOTHING`, preserving existing template contents. |
| Tracking tokens | FIXED for new links / PARTIAL for legacy | New tokens use 32 random bytes, are SHA-256 hashed, and are unique. Existing version-0 values are not bulk-rehashed because their raw-vs-digest form cannot be inferred safely. A valid legacy link can match either form and is upgraded to a digest on use. Unused legacy records remain version 0 until expiry/use; review existing links before deployment. |
| Functions and triggers | PARTIAL / NOT TESTED | Security-definer functions use a pinned empty `search_path` and perform server-side authorization. `CREATE OR REPLACE` and named trigger replacement are statically present; execution, signatures, trigger interactions, and behavior on an existing schema are untested. |
| Grants and permissions | FIXED in generated SQL / NOT TESTED | New MVP tables have explicit revokes/grants; payment table insert is not granted; only the new payment RPC is granted to `authenticated`. Effective role privileges and inherited project defaults must be queried in the disposable database. |
| Idempotency | PARTIAL / NOT TESTED | Type creation handles duplicate types; tables/columns/indexes use guarded creation where applicable; named policies/triggers are dropped and recreated. Re-running the complete SQL against both a fresh and partially initialized database has not been tested. |
| Statement-level failure recovery | PARTIAL / NOT TESTED | The core and fourth migrations have explicit `BEGIN`/`COMMIT`; the MVP and workflow migrations do not. If either reports an error in the SQL Editor, stop and inspect actual schema state before any retry; no automatic recovery is claimed. |
| Destructive operations | PASS with compatibility caution | No `DROP TABLE`, `DROP SCHEMA`, `DROP DATABASE`, or `DISABLE ROW LEVEL SECURITY` was found. Policies, named triggers, and one index are dropped/replaced. This preserves rows but can replace an existing object with the same name or change access behavior. |
| Storage bucket settings | FIXED / NOT TESTED | The core migration no longer overwrites existing bucket settings. It fails if the evidence bucket is public or unavailable. Verify bucket ownership/settings on the disposable project. |
| Existing-schema compatibility | BLOCKED | No target catalog/data was available. `CREATE TABLE IF NOT EXISTS` does not repair a pre-existing table with a different shape. Composite-FK validation can stop on bad legacy relationships and requires manual review rather than data deletion. |

### PostgreSQL compatibility note

The nullable composite foreign keys use column-specific `ON DELETE SET NULL`
syntax (for example, clearing `invoice_id` while retaining `business_id`).
Confirm the disposable project's PostgreSQL version supports this syntax
(PostgreSQL 15 or newer) before applying. No migration was executed to test it.

### Remaining migration risks

- The migrations replace policies and triggers with KAAMFLOW-named definitions.
  Inventory custom policies/triggers with matching names before running them
  against any non-empty schema.
- The outcome index is explicitly replaced. Confirm no downstream code depends
  on the old index name.
- The evidence migration does not move legacy files or rewrite old Storage
  paths.
- `scripts/provision-first-owner.sql` is explicit-ID and insert-only; its
  postcondition also checks email, tenant, role, and active status. It still
  must be run only after positively confirming the Dashboard is the
  disposable project.
- Auth role `SERVICE_DESK` is not present in the application or database role
  set. For the requested test, use `DISPATCHER` as the service-desk function;
  do not insert an unsupported literal role.
- Migration text and both pgTAP acceptance suites have not been parsed by
  PostgreSQL or applied to a fresh disposable database. Static review cannot
  establish SQL validity or runtime security.

## Live tests blocked

The previously tested configuration returned HTTP 200 from Auth health but
HTTP 401 from REST, including a request using `apikey` and one using both
`apikey` and `Authorization` headers. The 401 response contained no diagnostic
body, so its cause is unknown. This review made no new network request because
the current configuration has not been confirmed as a disposable project.

The following are therefore **NOT TESTED**: migration parsing/application,
table inventory, constraints, indexes, functions, grants, Auth sign-in, RLS,
cross-tenant access, payment retries, token redemption, direct transition
bypass, concurrency, and application workflows.

See [KAAMFLOW_TEST_ACCOUNT_SETUP_GUIDE.md](./KAAMFLOW_TEST_ACCOUNT_SETUP_GUIDE.md)
and [KAAMFLOW_SUPABASE_VERIFICATION_REPORT.md](./KAAMFLOW_SUPABASE_VERIFICATION_REPORT.md)
for prerequisites and next checks.
The ordered apply and workflow test plan is in
[KAAMFLOW_TEST_PROJECT_EXECUTION_RUNBOOK.md](./KAAMFLOW_TEST_PROJECT_EXECUTION_RUNBOOK.md).
