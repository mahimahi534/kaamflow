import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logoutAction } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

export default async function PendingProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile = null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, business_id")
      .eq("id", user.id)
      .maybeSingle();
    profile = data;
  }

  const generatedSql = user
    ? `-- Run this in Supabase Dashboard -> SQL Editor:
INSERT INTO public.businesses (name, slug)
VALUES ('Kaamflow Central Workshop', 'kaamflow-central')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO public.profiles (id, business_id, email, full_name, role)
VALUES (
  '${user.id}',
  (SELECT id FROM public.businesses WHERE slug = 'kaamflow-central' LIMIT 1),
  '${user.email || ""}',
  'Kaamflow Operations Admin',
  'OWNER_ADMIN'
)
ON CONFLICT (id) DO UPDATE
  SET business_id = EXCLUDED.business_id,
      email       = EXCLUDED.email,
      role        = 'OWNER_ADMIN';`
    : "";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-blue-600">
          <span className="text-2xl font-bold">⏱</span>
        </div>

        <h1 className="mt-4 text-2xl font-bold text-slate-900">
          {profile ? "Profile Active" : "Profile Provisioning Pending"}
        </h1>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">
          {profile
            ? `Your profile is verified and active as ${profile.role}. You can now enter the dashboard.`
            : "Your authentication credentials have been verified, but your user profile has not yet been assigned to a business tenant or operational role in KAAMFLOW."}
        </p>

        {user ? (
          <div className="mt-5 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs">
            <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
              <span className="font-semibold text-slate-500">Authenticated Email:</span>
              <span className="font-mono font-medium text-slate-900">{user.email}</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
              <span className="font-semibold text-slate-500">User UUID:</span>
              <span className="font-mono text-slate-700">{user.id}</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
              <span className="font-semibold text-slate-500">Database Status:</span>
              <span
                className={`font-semibold ${
                  profile ? "text-emerald-600" : "text-amber-600"
                }`}
              >
                {profile ? `Assigned (${profile.role})` : "Unassigned in public.profiles"}
              </span>
            </div>
          </div>
        ) : null}

        {profile ? (
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <Link href="/" className="flex-1">
              <Button className="w-full">
                Enter Dashboard as {profile.role}
              </Button>
            </Link>
            <form action={logoutAction} className="sm:w-auto">
              <Button variant="secondary" type="submit" className="w-full">
                Sign Out
              </Button>
            </form>
          </div>
        ) : (
          <>
            <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50/70 p-4 text-xs text-blue-950 space-y-2">
              <p className="font-semibold text-blue-900">
                How to Complete OWNER_ADMIN Setup in Supabase
              </p>
              <p className="leading-relaxed">
                Run the pre-filled SQL below in your <strong>Supabase Dashboard &gt; SQL Editor</strong> to link this exact account to the <strong>Kaamflow Central Workshop</strong> tenant:
              </p>
              {generatedSql ? (
                <pre className="mt-2 overflow-x-auto rounded-xl border border-blue-200 bg-slate-900 p-3 font-mono text-[11px] text-blue-100">
                  {generatedSql}
                </pre>
              ) : null}
            </div>

            <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-end">
              <Link href="/pending-profile" className="flex-1 sm:flex-none">
                <Button variant="secondary" className="w-full sm:w-auto">
                  Refresh Status
                </Button>
              </Link>
              <form action={logoutAction} className="flex-1 sm:flex-none">
                <Button variant="quiet" type="submit" className="w-full sm:w-auto">
                  Sign Out
                </Button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
