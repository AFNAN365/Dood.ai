import { beforeEach, describe, expect, it } from "vitest";
import { app, store } from "../src/server.js";

describe("DSoR Lab payment governance", () => {
  beforeEach(() => {
    store.proposals.clear();
    store.idempotency.clear();
    store.audit.length = 0;
    const invoice = store.getInvoice("tenant-a", "INV-1008");
    if (invoice) store.saveInvoice({ ...invoice, status: "OPEN", version: 1 });
  });

  it("requires approval for a high-value payment", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/payments/execute",
      payload: { tenantId: "tenant-a", invoiceId: "INV-1008", actorId: "agent-001", amount: { amount: "75000.00", currency: "USD" }, idempotencyKey: "idem-high-001" },
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe("PENDING_APPROVAL");
  });

  it("enforces separation of duties", async () => {
    const create = await app.inject({
      method: "POST", url: "/api/v1/payments/execute",
      payload: { tenantId: "tenant-a", invoiceId: "INV-1008", actorId: "cfo-001", amount: { amount: "75000.00", currency: "USD" }, idempotencyKey: "idem-sod-001" },
    });
    const proposalId = create.json().proposalId as string;
    const approval = await app.inject({
      method: "POST", url: `/api/v1/proposals/${proposalId}/approve`,
      payload: { tenantId: "tenant-a", approverId: "cfo-001" },
    });
    expect(approval.statusCode).toBe(403);
  });

  it("approves and executes with idempotency", async () => {
    const create = await app.inject({
      method: "POST", url: "/api/v1/payments/execute",
      payload: { tenantId: "tenant-a", invoiceId: "INV-1008", actorId: "agent-001", amount: { amount: "75000.00", currency: "USD" }, idempotencyKey: "idem-exec-001" },
    });
    const proposalId = create.json().proposalId as string;
    const approval = await app.inject({ method: "POST", url: `/api/v1/proposals/${proposalId}/approve`, payload: { tenantId: "tenant-a", approverId: "cfo-001" } });
    expect(approval.statusCode).toBe(200);
    const execution = await app.inject({ method: "POST", url: `/api/v1/proposals/${proposalId}/execute`, payload: { tenantId: "tenant-a", actorId: "ops-001" } });
    expect(execution.statusCode).toBe(200);
    expect(execution.json().status).toBe("EXECUTED");
    const second = await app.inject({ method: "POST", url: `/api/v1/proposals/${proposalId}/execute`, payload: { tenantId: "tenant-a", actorId: "ops-001" } });
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe("ALREADY_EXECUTED");
  });

  it("denies a non-approved vendor", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/payments/execute",
      payload: { tenantId: "tenant-a", invoiceId: "INV-1009", actorId: "agent-001", amount: { amount: "250.00", currency: "USD" }, idempotencyKey: "idem-vendor-001" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBeUndefined();
    expect(response.json().decision.decision).toBe("DENY");
  });
});
