import assert from "node:assert/strict";
import test from "node:test";
import {
  executeHandoverTransition,
  type HandoverRpcArgs,
} from "./handover-transition";

function createRpc(
  error: { code: string | null; message: string } | null = null
) {
  const calls: HandoverRpcArgs[] = [];

  return {
    calls,
    rpc: async (args: HandoverRpcArgs) => {
      calls.push(args);
      return { error };
    },
  };
}

test("settled invoice and passing QC use the RPC without an override", async () => {
  const mock = createRpc();
  const result = await executeHandoverTransition({
    role: "DISPATCHER",
    jobId: "job-1",
    targetStatus: "handover",
    rpc: mock.rpc,
  });

  assert.deepEqual(result, { success: true });
  assert.deepEqual(mock.calls, [
    {
      target_job_id: "job-1",
      target_status: "handover",
      payment_override_reason: null,
      qc_override_reason: null,
    },
  ]);
});

test("settled closed handover also needs no override", async () => {
  const mock = createRpc();
  const result = await executeHandoverTransition({
    role: "DISPATCHER",
    jobId: "job-closed",
    targetStatus: "closed",
    rpc: mock.rpc,
  });

  assert.deepEqual(result, { success: true });
  assert.equal(mock.calls[0]?.target_status, "closed");
  assert.equal(mock.calls[0]?.payment_override_reason, null);
});

test("positive balance asks an Owner for a payment override reason", async () => {
  const mock = createRpc({
    code: "23514",
    message: "An Owner override reason between 10 and 1000 characters is required.",
  });
  const result = await executeHandoverTransition({
    role: "OWNER_ADMIN",
    jobId: "job-2",
    targetStatus: "handover",
    rpc: mock.rpc,
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.overrideRequired, "payment_override");
  }
});

test("missing invoice uses the same Owner payment-exception flow", async () => {
  const mock = createRpc({
    code: "23514",
    message: "An Owner override reason between 10 and 1000 characters is required.",
  });
  const result = await executeHandoverTransition({
    role: "OWNER_ADMIN",
    jobId: "job-without-invoice",
    targetStatus: "closed",
    rpc: mock.rpc,
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.overrideRequired, "payment_override");
  }
  assert.equal(mock.calls[0]?.target_status, "closed");
});

test("waived invoice with ledger debt cannot be overridden", async () => {
  const mock = createRpc({
    code: "23514",
    message: "A waived invoice with an outstanding ledger balance cannot be handed over.",
  });
  const result = await executeHandoverTransition({
    role: "OWNER_ADMIN",
    jobId: "job-3",
    targetStatus: "handover",
    paymentOverrideReason: "Approved exception by owner",
    rpc: mock.rpc,
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.overrideRequired, undefined);
    assert.match(result.error, /Resolve the invoice balance/);
  }
});

test("QC failure requests an Owner reason and is not overrideable by a Dispatcher", async () => {
  const error = {
    code: "23514",
    message: "Quality Control Required: latest QC inspection must pass.",
  };
  const ownerMock = createRpc(error);
  const ownerResult = await executeHandoverTransition({
    role: "OWNER_ADMIN",
    jobId: "job-4",
    targetStatus: "handover",
    rpc: ownerMock.rpc,
  });
  assert.equal(
    ownerResult.success === false ? ownerResult.overrideRequired : undefined,
    "qc_override"
  );

  const dispatcherMock = createRpc(error);
  const dispatcherResult = await executeHandoverTransition({
    role: "DISPATCHER",
    jobId: "job-4",
    targetStatus: "handover",
    rpc: dispatcherMock.rpc,
  });
  assert.equal(dispatcherResult.success, false);
  if (!dispatcherResult.success) {
    assert.equal(dispatcherResult.overrideRequired, undefined);
  }
});

test("Owner payment override reason is trimmed and sent to the RPC", async () => {
  const mock = createRpc();
  const result = await executeHandoverTransition({
    role: "OWNER_ADMIN",
    jobId: "job-5",
    targetStatus: "handover",
    paymentOverrideReason: "  Customer approved documented exception  ",
    rpc: mock.rpc,
  });

  assert.deepEqual(result, { success: true });
  assert.equal(mock.calls[0]?.payment_override_reason, "Customer approved documented exception");
});

test("non-Owners cannot submit override reasons or call the RPC with them", async () => {
  const mock = createRpc();
  const result = await executeHandoverTransition({
    role: "DISPATCHER",
    jobId: "job-6",
    targetStatus: "handover",
    paymentOverrideReason: "Dispatcher attempts unauthorized override",
    rpc: mock.rpc,
  });

  assert.equal(result.success, false);
  assert.equal(mock.calls.length, 0);
});

test("Technicians cannot request handover even without an override", async () => {
  const mock = createRpc();
  const result = await executeHandoverTransition({
    role: "TECHNICIAN",
    jobId: "job-7",
    targetStatus: "closed",
    rpc: mock.rpc,
  });

  assert.equal(result.success, false);
  assert.equal(mock.calls.length, 0);
});

test("both override reasons are forwarded independently", async () => {
  const mock = createRpc();
  const result = await executeHandoverTransition({
    role: "OWNER_ADMIN",
    jobId: "job-8",
    targetStatus: "closed",
    paymentOverrideReason: "Approved payment exception by owner",
    qcOverrideReason: "Documented QC exception by owner",
    rpc: mock.rpc,
  });

  assert.deepEqual(result, { success: true });
  assert.equal(mock.calls[0]?.payment_override_reason, "Approved payment exception by owner");
  assert.equal(mock.calls[0]?.qc_override_reason, "Documented QC exception by owner");
});

test("an uncertain RPC failure can be retried with identical arguments", async () => {
  const calls: HandoverRpcArgs[] = [];
  let attempt = 0;
  const rpc = async (args: HandoverRpcArgs) => {
    calls.push(args);
    attempt += 1;
    if (attempt === 1) throw new Error("connection interrupted");
    return { error: null };
  };
  const request = {
    role: "OWNER_ADMIN",
    jobId: "job-retry",
    targetStatus: "handover" as const,
    paymentOverrideReason: "Approved exception documented by owner",
    rpc,
  };

  const firstResult = await executeHandoverTransition(request);
  const retryResult = await executeHandoverTransition(request);

  assert.equal(firstResult.success, false);
  assert.deepEqual(retryResult, { success: true });
  assert.deepEqual(calls[0], calls[1]);
});
