# KAAMFLOW Migration 2 Failure Repair

**Status:** Root cause confirmed by read-only test-project inspection.  
**Execution status:** Migration 2 executed successfully after the repair.
No migration 3/4 SQL was executed.

## Migration 2 execution result

The corrected migration 2 was applied once to the disposable
`kaamflow-test` project, project reference `lgdxtpmqwqrwqtcaxmox`.

Post-execution read-only verification found:

- `public.payments`: present.
- `public.customer_tracking_tokens`: present.
- `public.complaints`: present.
- `public.parts_orders`: present.
- `public.checklist_templates`: present.
- Public table count: 26.
- `idx_customers_business_id_id`: present and unique.
- `idx_profiles_business_id_id`: present and unique.
- `idx_jobs_business_id_id`: present and unique.
- `idx_invoices_business_id_id`: present and unique.
- `payments_job_same_business`: validated.
- `payments_invoice_same_business`: validated.
- `payments_recorder_same_business`: validated.
- Migration 3/4 handover and override tables: absent.

## Root cause

Migration 2 attempted to create `payments_invoice_same_business`, referencing:

```sql
public.invoices (business_id, id)
```

from:

```sql
public.payments (business_id, invoice_id)
```

PostgreSQL requires a matching unique constraint or unique index on the referenced
columns. Read-only catalog inspection confirmed:

- `public.invoices.id` is `uuid` and a primary key.
- `public.invoices.business_id` is `uuid` and not null.
- No unique index existed on `(business_id, id)`.
- `public.payments` did not exist after the failure.
- Migration 2's business/profile/job/intake extensions and five new tables did
  not exist.
- Migration 3 and migration 4 objects did not exist.

This inspection indicates migration 2 did not leave its earlier markers
partially applied in this test project.

## Exact repair

Before the migration 2 composite foreign-key block, migration 2 now creates
matching unique indexes for every `(business_id, id)` target used by migration
2:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_business_id_id
  ON public.customers (business_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_business_id_id
  ON public.profiles (business_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_business_id_id
  ON public.jobs (business_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_business_id_id
  ON public.invoices (business_id, id);
```

These indexes are additive and preserve existing rows. The id primary keys
already prevent duplicate `(business_id, id)` pairs, so these indexes do not
normally require row rewriting or data deletion.

Migration 1 is also corrected so a fresh migration 1 run declares
`public.invoices` with `UNIQUE (business_id, id)`. This source-level correction
does not retroactively add the index to the already-applied migration 1 test
database; migration 2's index supplies that recovery.

## Related dependency review

Migration 2 also references composite `(business_id, id)` keys for:

- `jobs`
- `profiles`
- `customers`
- `invoices`

The repaired migration creates indexes for all four targets before validating
its composite foreign keys.

Migration 3 does not introduce the reviewed composite foreign-key targets.
Migration 4 creates a unique index on
`invoices (business_id, job_id, id)` before its payment composite foreign key,
which matches its three-column reference:

```sql
public.payments (business_id, job_id, invoice_id)
```

Migration 4 also references `jobs (business_id, id)` and
`profiles (business_id, id)`; migration 2 now supplies matching unique indexes
in the tested migration order.

## Recovery procedure

Because no migration 2 partial markers were found, the recovery is to rerun
the corrected migration 2 only after explicit approval. Do not combine
migrations or run migration 3/4 yet.

Before rerun:

1. Confirm `public.payments` and the migration 2 extension/table markers are
   still absent.
2. Confirm no new KAAMFLOW rows or migration 2 objects were added manually.
3. Run migration 2 once in the disposable test project.
4. Stop on the first error.
5. Re-run read-only catalog checks before considering a retry.
6. Proceed to migrations 3 and 4 only after migration 2 reports success.

Do not blindly rerun migration 2. Do not drop tables or reset the database.

## Verification queries

```sql
SELECT to_regclass('public.payments') IS NOT NULL AS payments_exists,
       to_regclass('public.customer_tracking_tokens') IS NOT NULL AS tracking_exists,
       to_regclass('public.complaints') IS NOT NULL AS complaints_exists,
       to_regclass('public.parts_orders') IS NOT NULL AS parts_orders_exists,
       to_regclass('public.checklist_templates') IS NOT NULL AS templates_exists;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_customers_business_id_id',
    'idx_profiles_business_id_id',
    'idx_jobs_business_id_id',
    'idx_invoices_business_id_id'
  );

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.payments'::regclass
  AND conname IN (
    'payments_job_same_business',
    'payments_invoice_same_business',
    'payments_recorder_same_business'
  );
```

Before validation, migration 2's composite constraints are `NOT VALID`.
Successful validation should leave all three constraints with
`convalidated = true`.
