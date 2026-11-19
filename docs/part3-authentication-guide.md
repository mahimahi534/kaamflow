# KAAMFLOW Part 3: Authentication & Role-Based Access Control Guide

## Overview

Part 3 implements enterprise-grade authentication and strict server-enforced Role-Based Access Control (RBAC) for KAAMFLOW using Next.js 16 App Router, `@supabase/ssr`, and PostgreSQL Row Level Security (RLS).

---

## 1. Security & Architecture Model

1. **Defense in Depth**:
   - **Network Edge (`proxy.ts`)**: Next.js 16 Proxy intercepts requests, keeps Supabase auth tokens refreshed via cookie exchange, redirects unauthenticated requests to `/login`, and redirects logged-in users away from the login screen.
   - **Server Components & Data Access Layer (`lib/auth/server.ts`)**: Every protected route enforces role access on the server using `requireRole(...)`. Roles and tenant membership are verified directly from the `public.profiles` and `public.businesses` tables. Client-supplied headers or cookies are **never** trusted for authorization.
   - **Database Row Level Security (PostgreSQL)**: Supabase RLS policies enforce isolation so users can only read and mutate rows belonging to their business tenant (`private.current_business_id()`) and role (`private.has_role(...)`).
2. **Key Protection**:
   - Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `ANON_KEY`) are present in client code.
   - The Supabase `service_role` key is **never** used in browser code.
3. **No Public Admin Self-Registration**:
   - The `profiles` table has no public `INSERT` policy for `authenticated` users. Staff and admin profiles must be provisioned by a trusted process or business owner.

---

## 2. Role-Based Access Control Matrix

| Route | Name | Allowed Roles | Default Home |
| :--- | :--- | :--- | :--- |
| `/` | Owner Dashboard | `OWNER_ADMIN`, `DISPATCHER`, `QC_REVIEWER` | Yes (Admin/Dispatch) |
| `/jobs` | Repair Jobs Board | `OWNER_ADMIN`, `DISPATCHER`, `TECHNICIAN`, `QC_REVIEWER` | — |
| `/requests` | Service Requests | `OWNER_ADMIN`, `DISPATCHER` | — |
| `/customers` | Customers Directory | `OWNER_ADMIN`, `DISPATCHER` | — |
| `/equipment` | Equipment Directory | `OWNER_ADMIN`, `DISPATCHER` | — |
| `/technicians` | Technicians Capacity | `OWNER_ADMIN`, `DISPATCHER` | — |
| `/quotations` | Quotations & Approvals | `OWNER_ADMIN`, `DISPATCHER` | — |
| `/quality-control` | QC Inspections | `OWNER_ADMIN`, `DISPATCHER`, `QC_REVIEWER` | Yes (QC Reviewer) |
| `/fixloop` | FixLoop Outcome Tracking | `OWNER_ADMIN`, `DISPATCHER` | — |
| `/analytics` | Outcome Intelligence | `OWNER_ADMIN`, `DISPATCHER` | — |
| `/settings` | Settings & System Config | `OWNER_ADMIN` | — |
| `/technician` | Technician Mobile Desk | `OWNER_ADMIN`, `TECHNICIAN` | Yes (Technician) |
| `CUSTOMER` | Customer Portal | Restricted from staff dashboard routes | Directed to portal/quotes |

---

## 3. Provisioning the First OWNER_ADMIN Account

For a **disposable test project only**, use the explicit-ID provisioning script.
Do not use it to create or alter production accounts.

### Step 1: Create the Auth User in Supabase Dashboard
1. Open your [Supabase Project Dashboard](https://supabase.com/dashboard).
2. Navigate to **Authentication** > **Users**.
3. Click **Add user** > **Create user**.
4. Enter an email address you control for testing and a secure password.
5. Use the project's intended email-confirmation setting.
6. Click **Create user**, then copy that exact user's UUID from the Auth users list.

### Step 2: Provision Business Tenant & Profile in SQL Editor
1. In the Supabase Dashboard, open the **SQL Editor**.
2. Create a test business first, then set the exact Auth UUID and business slug
   placeholders in [`provision-first-owner.sql`](../scripts/provision-first-owner.sql).
3. Confirm the Dashboard is the disposable project before running it. The script
   never selects the newest user and never overwrites an existing profile.
4. Confirm the resulting profile belongs to the intended test business.

---

## 4. Testing Your Login & Role Protection

1. Start the application:
   ```bash
   npm run dev
   ```
2. Navigate to `http://localhost:3000`. You will be automatically redirected to `/login`.
3. Sign in using the email and password you created.
4. You will be redirected to `/` (Owner Dashboard).
5. Verify that:
   - The top header displays your name, business tenant, and an `OWNER ADMIN` badge.
   - The sidebar displays active tenant security status.
   - You can access `/settings`.
   - Clicking **Sign out** invalidates the session and returns to `/login`.
