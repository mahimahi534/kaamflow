import { createClient } from "@/lib/supabase/server";
import type { Invoice, Payment, QuoteVersion } from "@/lib/types/database";

export interface JobBillingData {
  invoice: Invoice | null;
  payments: Payment[];
  totalAmount: number;
  totalPaid: number;
  balanceDue: number;
  quoteVersion: QuoteVersion | null;
}

export async function getJobBilling(jobId: string): Promise<JobBillingData> {
  try {
    const supabase = await createClient();

    // 1. Fetch invoice, payments, and approved quote version in parallel
    const [invRes, payRes, quoteRes] = await Promise.all([
      supabase.from("invoices").select("*").eq("job_id", jobId).maybeSingle(),
      supabase
        .from("payments")
        .select("*, recorder:profiles!payments_recorded_by_fkey(id, full_name, email)")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false }),
      supabase
        .from("quote_versions")
        .select("*")
        .eq("job_id", jobId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const invoice = (invRes.data as Invoice) || null;
    const payments = (payRes.data as unknown as Payment[]) || [];
    const quoteVersion = (quoteRes.data as QuoteVersion) || null;

    const totalAmount = invoice
      ? Number(invoice.total_amount)
      : quoteVersion
        ? Number(quoteVersion.total_amount)
        : 0;

    const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const balanceDue = Math.max(0, totalAmount - totalPaid);

    return {
      invoice,
      payments,
      totalAmount,
      totalPaid,
      balanceDue,
      quoteVersion,
    };
  } catch (err) {
    console.error("Error in getJobBilling DAL:", err);
    return {
      invoice: null,
      payments: [],
      totalAmount: 0,
      totalPaid: 0,
      balanceDue: 0,
      quoteVersion: null,
    };
  }
}
