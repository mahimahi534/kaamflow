import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 text-2xl font-bold">
          404
        </div>
        <h2 className="mt-4 text-xl font-bold text-slate-900">
          Page Not Found
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          The repair operations screen you requested does not exist or has moved.
        </p>
        <div className="mt-6 flex justify-center">
          <Link href="/">
            <Button>Return to Dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
