# KAAMFLOW Supabase verification report

**Overall status: BLOCKED / PARTIAL.** The Supabase Dashboard browser view
showed the project named `kaamflow-test` selected, but no SQL was executed and
database connectivity was not verified. Local credentials and role-specific
test accounts remain unverified. No Supabase data/API request or migration was
made during this review. Production has not been changed.

## Connection configuration

- The application reads `NEXT_PUBLIC_SUPABASE_URL` and prefers
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, with
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` as a compatibility fallback.
- Browser client, server client, and `proxy.ts` use the shared helper at
  `lib/supabase/env.ts`; no service-role key is used by these clients.
- `.env.local` exists and remains ignored by Git. It was not changed; values
  are not included here. The currently present key variable is the legacy
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`; its value has the `sb_publishable_` prefix.
  The shared helper accepts this variable name.
- The configured URL is HTTPS and uses a `.supabase.co` host whose project
  reference matches the earlier supplied reference. The earlier literal
  `.supabase.com` URL used a different suffix and did not resolve in that
  prior probe. This mismatch is not corrected by guessing a hostname. Copy the
  exact Project URL and matching public key from the confirmed disposable
  project's Dashboard.
- A `sb_publishable_` key cannot be locally decoded to prove its project
  reference. Therefore the URL/key pair is **not fully verified**.

## Prior connection test evidence

These are results from the earlier verification session, not a new test in
this review. Credential values were not logged in the previous report and are
not reproduced here.

| Probe | Result | Status |
| --- | --- | --- |
| Auth health on the previously configured host | HTTP 200 | PASS for endpoint reachability/key acceptance only |
| Auth settings endpoint | HTTP 200 | PARTIAL; not a user sign-in or session test |
| REST root with `apikey` header | HTTP 401, empty body | FAILED |
| REST query with `apikey` header | HTTP 401 | FAILED |
| REST probe with both `apikey` and `Authorization` headers | HTTP 401 | FAILED |
| Auth sign-in with a test account | Not attempted; no test account | BLOCKED |
| Authenticated database query | Not successful/verified | BLOCKED |

Earlier request headers were inspected by name only; no key/token values are
reported. The empty REST 401 response does not identify its cause. The
available evidence cannot distinguish among a project/key mismatch, Data API
configuration, or another gateway/API issue. No cause is guessed here. This
cannot be resolved safely until a disposable project's exact URL/key are
provided locally and its Dashboard API settings are checked.

## Migration review

**Status: Static review completed; SQL execution NOT TESTED.** The four
migrations are ordered core → MVP completion → workflow hardening → handover
payment guard. The
security corrections and remaining execution risks are documented in
[KAAMFLOW_MIGRATION_SECURITY_REVIEW.md](./KAAMFLOW_MIGRATION_SECURITY_REVIEW.md).
The handover-payment requirement and RPC-only terminal-status guard are
implemented in the generated fourth migration. The fourth migration adds two
RLS-enabled authorization tables, bringing the KAAMFLOW table expectation
from 26 to 28. The migration and both prepared pgTAP suites have not been
parsed or executed against PostgreSQL.

Static results:

- 28 KAAMFLOW tables are expected across the four files; the fourth adds
  `handover_payment_overrides` and `handover_transition_authorizations`.
- RLS enablement is present for all 28 declared tables; live policies and
  effective grants are not verified.
- No `DROP TABLE`, `DROP SCHEMA`, `DROP DATABASE`, or RLS disable statement
  found. Named policies/triggers and one index are replaced.
- Same-business composite foreign keys were added to later MVP tables.
- The fourth migration adds a same-business/same-job payment-to-invoice
  composite foreign key.
- The job trigger requires a transaction-scoped authorization from the
  transition RPC for every `handover`/`closed` status change, including paid,
  QC-passed cases. Direct authenticated status-update bypass is covered by
  prepared pgTAP assertions but remains untested in PostgreSQL.
- Checklist seed conflicts no longer overwrite existing templates.
- Payment table direct inserts are revoked; the role-checked payment RPC uses a
  per-business idempotency key and atomic invoice/payment updates.
- The new handover trigger locks and totals every invoice from the payment
  ledger. Positive balance or no invoice requires a fresh Owner authorization;
  waived invoices with outstanding ledger balance are denied. QC and payment
  overrides produce audit events.
- Both the handover-payment and database-security pgTAP acceptance suites are
  prepared, but no SQL parser or PostgreSQL execution has been run.
- New tracking tokens use cryptographically random bytes and SHA-256 digests.
  Ambiguous existing token rows are not bulk-rehashed; version-0 values are
  handled compatibly and upgraded on successful use.
- Schema compatibility, SQL parsing, constraint validation, and migration
  reruns have not been tested on PostgreSQL. Confirm PostgreSQL 15+ before
  applying the nullable composite foreign-key syntax.

## Database, authentication, and workflow tests

| Test | Status |
| --- | --- |
| Disposable test project confirmed | BLOCKED |
| Migrations applied to disposable project | NOT TESTED (explicitly not run) |
| Expected tables/functions/indexes verified in PostgreSQL | NOT TESTED |
| RLS and grants verified from database catalogs | NOT TESTED |
| OWNER_ADMIN / DISPATCHER / TECHNICIAN / QC_REVIEWER sign-in | NOT TESTED |
| Second-business tenant isolation | NOT TESTED |
| Payment direct-write denial, idempotency, and overpayment rejection | NOT TESTED |
| Tracking token create/redeem/revoke/expiry behavior | NOT TESTED |
| Customer-facing quotation approval (requires optional CUSTOMER account) | NOT TESTED |
| QC and QC-gated completed/handover transitions | NOT TESTED |
| Outstanding-balance handover gate and Owner override audit | NOT TESTED (SQL generated; not applied) |
| Main application workflows with valid test accounts | NOT TESTED |
| Local handover RPC-wrapper acceptance tests | PASS (11 tests; mocked RPC, no database verification) |

The requested `SERVICE_DESK` role does not exist in current application types
or database policy definitions. Use `DISPATCHER` for the Service Desk test
account; do not provision the unsupported literal role.

The fourth migration adds payment and QC enforcement for `handover` and
`closed`, plus the RPC-only status-transition gate and payment-to-invoice
integrity constraint. Its behavior remains unverified until the disposable project is
confirmed, the migrations and pgTAP suite are run there, and the wired
application flow is tested with disposable accounts. The local application
RPC-wrapper acceptance tests pass but do not verify database behavior. See the
[handover payment guard plan](./KAAMFLOW_HANDOVER_PAYMENT_GUARD_PLAN.md).

## Application checks

- `npm run lint` — PASS.
- `npm run build` — PASS, including TypeScript and route generation.
- `npm test` — PASS (11 application-level RPC-wrapper tests; mocked responses).
- The production build reports a non-blocking Turbopack warning that it ignored
  a parent-directory lockfile outside this repository.
- A local `next dev` smoke test used empty Supabase variables in the server
  process to avoid contacting the configured project. `/login` rendered with
  HTTP 200 and the expected sign-in controls; no sign-in was attempted.
- The local `/_next/mcp` endpoint successfully listed tools, reported no
  compilation issues, and compiled `/jobs/[id]` without issues. No
  authenticated route was opened, to avoid making a Supabase request.
- The dev server also logged Next.js's `instant-shell-url-data` diagnostic for
  `searchParams` access in the existing `/login` page. The route still rendered;
  that unrelated page behavior was not changed in this task.
- The application tests mock the RPC boundary; database, Auth, and RLS tests
  still require the disposable environment described in
  [KAAMFLOW_TEST_ACCOUNT_SETUP_GUIDE.md](./KAAMFLOW_TEST_ACCOUNT_SETUP_GUIDE.md).
- The ordered migration steps and full pre-execution test checklist are in
  [KAAMFLOW_TEST_PROJECT_EXECUTION_RUNBOOK.md](./KAAMFLOW_TEST_PROJECT_EXECUTION_RUNBOOK.md).

## Production safety

**PASS — no production changes made in this review.** No migration was
executed, no production account or data was modified, no database was reset,
and no deployment was performed. Keep production unchanged.

## Next safe steps

1. Create a separate disposable Supabase project and positively verify its
   Dashboard project reference.
2. Set its exact Project URL and matching publishable key locally; do not send
   credentials in chat.
3. Use the test-account setup guide to create role-specific users and a second
   business in that disposable project.
4. Resolve the REST 401 using the disposable project's Dashboard API settings
   and a fresh, locally configured public key.
5. Apply and test migrations only after confirming the disposable target and
   reviewing its existing catalog/data.
