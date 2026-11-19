# KAAMFLOW security report

## Status and scope

**Code/migration review only.** This report covers the generated Supabase SQL
and application-side corrections. No migration was executed, no live
Supabase request was made during this review, and no production data or
accounts were changed. Runtime RLS, authentication, payment behavior, and
tenant isolation remain **NOT TESTED**.

## Findings and current status

| Finding | Status | Result |
| --- | --- | --- |
| Cross-business references in the later MVP tables | FIXED / NOT TESTED | Same-business composite foreign keys were added for payments, tracking tokens, complaints, and parts orders. Existing data is not rewritten; constraint validation will fail safely if mismatches exist. |
| Direct payment insertion bypassing the atomic workflow | FIXED / NOT TESTED | Direct authenticated table writes are revoked. Payment recording uses an active-staff-checked RPC, locks the invoice, checks remaining balance, writes the ledger/audit data together, and uses an idempotency key. |
| Direct invoice writes bypassing the billing workflow | FIXED / NOT TESTED | The workflow migration revokes authenticated direct INSERT/UPDATE on invoices; creation and payment updates use authorized security-definer RPCs. Effective privileges remain unverified in a database. |
| Duplicate/replayed payment submissions | FIXED / NOT TESTED | The UI keeps the same UUID request key after an error and rotates it only after success; the database uses a business-scoped unique key and rejects key reuse with a different payload. |
| Checklist seed overwriting edited templates | FIXED | Seed conflicts now use `DO NOTHING`; existing checklist edits are not replaced. |
| Tracking token entropy and storage | FIXED for new links / PARTIAL for legacy | New links use 32 cryptographically random bytes; only a SHA-256 digest is stored. Ambiguous pre-existing token values are not bulk-rehashed. Legacy valid links are matched safely and upgraded on successful use. No database or link-level runtime test has been done. |
| Handover payment gate | IMPLEMENTED IN GENERATED SQL / NOT TESTED | The fourth migration gates `handover` and `closed` on ledger-derived balance and passing QC. Missing invoice or positive balance requires an active same-business Owner through a protected transition RPC; waived invoices with positive ledger balance remain blocked. |
| Owner override authorization and audit | IMPLEMENTED IN GENERATED SQL / NOT TESTED | Payment overrides use a fresh, transaction-scoped authorization record with no direct client/service-role grants and an activity-log event. QC overrides are separately checked and audited. |
| Direct status-update bypass | IMPLEMENTED IN GENERATED SQL / NOT TESTED | A private transition-authorization table and job trigger require the authorized RPC for every `handover`/`closed` status transition, including otherwise-paid/QC-passed jobs. Direct grants are revoked; trigger behavior remains untested. |
| Payment-to-invoice integrity | IMPLEMENTED IN GENERATED SQL / NOT TESTED | A validated composite FK is intended to require payment business, job, and invoice to match the same invoice row. Migration validation has not run. |
| Application handover path | IMPLEMENTED / DATABASE NOT TESTED | The status Server Action routes `handover` and `closed` through the RPC, and non-Owners cannot submit override reasons through the action. Local mocked-RPC tests need to be rerun against the current change set; live authorization and trigger behavior remain unverified. |
| Inactive-profile authorization | FIXED in generated workflow SQL / NOT TESTED | Tenant, role, assignment, and customer RPC helpers require active profiles. |
| RLS and tenant separation | PARTIAL / NOT TESTED | Static migration review finds RLS enabled for all 28 generated tables, but no database is ready for policy execution or role-based verification. |
| Public intake abuse control | PARTIAL | The database limits intake by normalized phone/business and validates fields; this is not IP/device rate limiting or CAPTCHA. Add an edge/API rate limit before broad public launch. |
| Existing evidence files | NOT TESTED | The migration configures a private bucket but does not migrate older `file_url` objects. Audit and migrate any prior files separately. |
| First-owner provisioning | FIXED in script | The provisioning script now requires an explicit Auth UUID and existing business slug, does not select the newest user, and never overwrites an existing profile. Use only in a disposable project. |

## Security implementation notes

- Browser, server, and `proxy.ts` use the shared public Supabase configuration
  helper. It prefers `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and falls back to
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`. No service-role key is used in those
  clients.
- Private evidence has storage policies that require a same-business job path
  and matching metadata. Customer-facing tracking output excludes internal
  notes and staff details.
- Security-definer functions in the workflow migration pin `search_path` to
  the empty string and qualify application objects.
- The database architecture and detailed migration findings are in
  [KAAMFLOW_DATABASE_ARCHITECTURE.md](./KAAMFLOW_DATABASE_ARCHITECTURE.md) and
  [KAAMFLOW_MIGRATION_SECURITY_REVIEW.md](./KAAMFLOW_MIGRATION_SECURITY_REVIEW.md).

## Required before real data

1. Prepare and positively identify a separate disposable Supabase project.
2. Verify its exact Project URL and matching public key in local configuration;
   never share or print the key.
3. Apply migrations only to that disposable project after reviewing schema
   compatibility.
4. Verify grants, RPCs, RLS, role restrictions, payment retries, legacy token
   behavior, and two-business isolation using separate test accounts.
5. Keep production unchanged until those checks pass and a separate explicit
   production approval is given.

The handover-guard pgTAP suite and the broader database-security acceptance
suite are prepared but not executed. No database connection, SQL validity,
migration application, or RLS behavior is claimed as verified by this report.
