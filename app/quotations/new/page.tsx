import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { requireRole } from "@/lib/auth/server";
import { getJobs, getJobById } from "@/lib/dal/jobs";
import { getQuotationById } from "@/lib/dal/quotations";
import { QuotationForm } from "@/components/quotations/quotation-form";

export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ jobId?: string; revisionFrom?: string }>;
}) {
  const session = await requireRole(["OWNER_ADMIN", "DISPATCHER"], "/quotations/new");
  const businessId = session.profile.business_id;

  const resolvedParams = await searchParams;
  const targetJobId = resolvedParams.jobId || "";
  const revisionFromId = resolvedParams.revisionFrom || "";

  // 1. Fetch available jobs for this business (active jobs in intake/diagnosis/quotation pipeline)
  const { data: availableJobs } = await getJobs(businessId, {
    status: "all",
    limit: 50,
  });

  // 2. If a specific job was chosen, fetch its full details (including parts_used and diagnoses)
  let initialJobDetails = null;
  if (targetJobId) {
    const jobRes = await getJobById(targetJobId);
    initialJobDetails = jobRes.data;
  }

  // 3. If revising an existing quotation version, prefill from it
  let initialValues = undefined;
  let versionNumber = 1;

  if (revisionFromId) {
    const prevQuoteRes = await getQuotationById(revisionFromId);
    if (prevQuoteRes.data) {
      initialValues = {
        labour_charge: prevQuoteRes.data.labour_charge,
        parts_cost: prevQuoteRes.data.parts_cost,
        notes: prevQuoteRes.data.notes || "",
      };
      versionNumber = prevQuoteRes.data.version_number + 1;
    }
  } else if (initialJobDetails?.diagnoses && initialJobDetails.diagnoses.length > 0) {
    // Helpful default: use technician diagnosis root cause in notes
    const latestDiag = initialJobDetails.diagnoses[0];
    initialValues = {
      notes: `Diagnostic: ${latestDiag.notes}${latestDiag.root_cause ? `\nRoot Cause: ${latestDiag.root_cause}` : ""}`,
    };
  }

  return (
    <AppShell
      title="Create Quotation"
      subheading="Draft versioned repair estimate, configure labor & parts, and send for customer approval."
    >
      <div className="mx-auto max-w-4xl space-y-4">
        <div>
          <Link
            href="/quotations"
            className="inline-flex items-center text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            &larr; Back to Quotations
          </Link>
        </div>
        <QuotationForm
          availableJobs={availableJobs}
          selectedJobId={targetJobId}
          initialJobDetails={initialJobDetails}
          versionNumber={versionNumber}
          initialValues={initialValues}
        />
      </div>
    </AppShell>
  );
}
