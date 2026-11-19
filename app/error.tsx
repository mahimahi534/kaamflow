"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error("KAAMFLOW Application Error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
          <span className="text-xl font-bold">✕</span>
        </div>
        <h2 className="mt-4 text-xl font-bold text-slate-900">
          Something went wrong
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          An unexpected error occurred while loading this page.
        </p>
        {error?.message ? (
          <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs font-mono text-rose-800">
            {error.message}
          </div>
        ) : null}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => router.push("/")}>
            Go to Home
          </Button>
          <Button onClick={() => reset()}>
            Try Again
          </Button>
        </div>
      </div>
    </div>
  );
}
