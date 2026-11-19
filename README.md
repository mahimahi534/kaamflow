# KAAMFLOW

KAAMFLOW is a repair-operations and outcome-intelligence platform for small appliance and electronics repair businesses. This starter project establishes the product foundation, dashboard UX, and database design for the one-week internship build.

## Tech stack

- Next.js 16 App Router
- TypeScript
- Tailwind CSS
- Supabase PostgreSQL
- Supabase Auth + Storage
- Vercel-ready structure

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Supabase environment

The browser and server-side Supabase SSR client helpers are in
`lib/supabase/client.ts` and `lib/supabase/server.ts`. Session refresh is handled
by the Next.js 16 `proxy.ts` convention. This prepares the connection helpers and refreshes Supabase Auth cookies. It
does not mean the database is migrated or that an end-to-end authenticated
session has been verified.

1. Copy `.env.example` to `.env.local` in the project root.
2. In your Supabase project's Connect dialog, copy the Project URL and the
   **publishable** key into `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. Keep `.env.local` private. Do not use a secret/service-role key in the
   browser or in any `NEXT_PUBLIC_` variable.
4. Set `KAAMFLOW_PUBLIC_BUSINESS_SLUG` to the slug of the workshop record that
   owns the public `/intake` form. If it is unset or does not match a business,
   intake fails safely; it never falls back to another tenant.
5. Restart `npm run dev` after changing environment variables.

For transition only, the helper also accepts the older public
`NEXT_PUBLIC_SUPABASE_ANON_KEY` variable. The publishable-key variable is the
preferred configuration. `.env.local` is ignored by Git.

## Foundation includes

- Responsive dashboard shell and mobile navigation
- Dashboard, customers, equipment, requests, repair jobs, quotations,
  technicians, QC, FixLoop, analytics, and settings screens
- Reusable buttons, cards, tables, form fields, status badges, loading states,
  and empty states
- A dashboard that reads operational metrics and jobs from the current
  authenticated Supabase session; it shows query errors rather than sample values
- Supabase browser/server client setup and a session-refresh proxy
- Database design and relationship diagram in `docs/database-architecture.md`
- Ordered SQL migrations for the core schema, MVP tables, and workflow
  hardening

## Product direction

The app is designed around the full repair journey:

Customer request → intake → diagnosis → quotation → approval → repair → QC → invoice → handover → follow-up → outcome intelligence.

The most important module is FixLoop: the platform distinguishes between confirmed successful repairs and unknown follow-up outcomes, creating comeback cases or new requests only when the customer reports a real issue.

## Database design

See `docs/database-architecture.md` for the Mermaid ER diagram, table
descriptions, indexes, tenant relationships, and access rules. The migrations
have been generated but have **not** been applied to Supabase. The old
`supabase/schema.sql` is a historical Part 1 draft; do not execute it.

### Applying the migration manually

Only apply this after you have explicitly approved the database changes and
made a backup if the project contains data:

1. Verify the project URL in `.env.local` belongs to the project you intend to
   change. Back up any existing data first.
2. In Supabase, open **SQL Editor** and create a new query.
3. Run each migration file in timestamp order, one at a time:
   - `supabase/migrations/20261116084000_kaamflow_core.sql`
   - `supabase/migrations/20261118090000_kaamflow_mvp_completion.sql`
   - `supabase/migrations/20261118100000_kaamflow_workflow_hardening.sql`
4. Review the SQL and any returned errors before continuing to the next file.
   The workflow migration adds transaction-safe RPCs, token hashing, and
   database-level workflow guards; it should not be run against an unintended
   or production project without explicit approval.
5. In **Table Editor**, verify the tables and functions. Test RLS and workflows
   using separate accounts for each role before entering real customer data.

The migration creates a private evidence bucket and customer-scoped RPCs for
quotation decisions and follow-up outcomes. The newest migration also upgrades
existing tracking tokens to hashes while preserving links, adds atomic quote,
QC, invoice, payment, assignment, diagnosis, parts-order, FixLoop, and public
intake operations, and adds audit triggers. If the old draft was previously
applied, existing evidence `file_url` values are preserved but are not moved
into the new private bucket; review and migrate any existing files separately.

The current local Supabase endpoint/key pairing has not passed the connection
check, so neither the database connection nor the cookie refresh has been
verified end to end. Ensure `.env.local` contains the correct project URL and
its matching publishable key before testing. Do not paste the key into chat.

## Part 1 routes

- `/` — Dashboard
- `/customers` — Customers
- `/equipment` — Equipment
- `/requests` — Service requests
- `/jobs` — Repair jobs
- `/quotations` — Quotations
- `/technicians` — Technicians
- `/technician` — Technician workspace
- `/quality-control` — Quality control
- `/fixloop` — FixLoop
- `/analytics` — Analytics
- `/settings` — Settings and connection setup status

The application includes authenticated data access and workflow actions, but
the database migrations have not been applied and the Supabase endpoint/key
pairing has not been verified. Consequently, successful live operation cannot
be claimed until the correct project credentials are configured and the
migrations are applied and tested.
