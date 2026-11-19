"use client";

import { useActionState } from "react";
import { loginAction, type LoginActionState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

export function LoginForm({ nextUrl }: { nextUrl?: string }) {
  const [state, formAction, isPending] = useActionState<LoginActionState, FormData>(
    loginAction,
    {}
  );

  return (
    <form action={formAction} className="space-y-4">
      {nextUrl ? <input type="hidden" name="next" value={nextUrl} /> : null}

      {state?.error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="font-bold text-rose-600">
              ✕
            </span>
            <span>{state.error}</span>
          </div>
        </div>
      ) : null}

      <div className="space-y-1">
        <label
          htmlFor="email"
          className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
        >
          Work Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="name@business.com"
          disabled={isPending}
          className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 disabled:bg-slate-100 disabled:opacity-60"
        />
        {state?.fieldErrors?.email ? (
          <p className="text-xs text-rose-600">{state.fieldErrors.email}</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <label
          htmlFor="password"
          className="block text-xs font-semibold uppercase tracking-wider text-slate-700"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••••••"
          disabled={isPending}
          className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 disabled:bg-slate-100 disabled:opacity-60"
        />
        {state?.fieldErrors?.password ? (
          <p className="text-xs text-rose-600">{state.fieldErrors.password}</p>
        ) : null}
      </div>

      <Button
        type="submit"
        disabled={isPending}
        className="w-full py-2.5"
      >
        {isPending ? (
          <span className="flex items-center gap-2">
            <svg
              className="h-4 w-4 animate-spin text-white"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Signing in...
          </span>
        ) : (
          "Sign In to KAAMFLOW"
        )}
      </Button>
    </form>
  );
}
