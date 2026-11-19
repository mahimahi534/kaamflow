import Link from "next/link";
import { logoutAction } from "@/lib/auth/actions";
import { ROLE_DEFAULT_ROUTES, type UserRole } from "@/lib/auth/types";
import { Button } from "@/components/ui/button";

export default async function UnauthorizedPage({
  searchParams,
}: {
  searchParams?: Promise<{ current?: string; required?: string; path?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : {};
  const currentRole = (resolvedParams.current as UserRole) || "UNKNOWN";
  const requiredRoles = resolvedParams.required || "";
  const attemptedPath = resolvedParams.path || "";

  const homeRoute = currentRole in ROLE_DEFAULT_ROUTES
    ? ROLE_DEFAULT_ROUTES[currentRole as UserRole]
    : "/";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
          <span className="text-2xl font-bold">!</span>
        </div>

        <h1 className="mt-4 text-2xl font-bold text-slate-900">
          Access Restricted
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Your account does not have permission to access this KAAMFLOW screen.
        </p>

        <div className="mt-6 space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Your Active Role:</span>
            <span className="font-semibold text-slate-900">{currentRole}</span>
          </div>
          {attemptedPath ? (
            <div className="flex justify-between">
              <span className="text-slate-500">Requested Route:</span>
              <span className="font-mono text-xs text-slate-700">{attemptedPath}</span>
            </div>
          ) : null}
          {requiredRoles ? (
            <div className="flex justify-between">
              <span className="text-slate-500">Required Roles:</span>
              <span className="font-mono text-xs text-blue-700">{requiredRoles}</span>
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link href={homeRoute} className="flex-1">
            <Button className="w-full">
              Return to Authorized Workspace
            </Button>
          </Link>

          <form action={logoutAction} className="sm:w-auto">
            <Button variant="secondary" type="submit" className="w-full sm:w-auto">
              Sign Out
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
