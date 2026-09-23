import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertMoney, sha256, type AuditEvent, type PaymentRequest, type Proposal } from "./domain.js";
import { decidePayment } from "./policy.js";
import { Store } from "./store.js";

const app = Fastify({ logger: true });
const store = new Store();

const moneySchema = z.object({ amount: z.string(), currency: z.enum(["USD", "PKR"]) });
const paymentSchema = z.object({
  tenantId: z.string().min(1), invoiceId: z.string().min(1), actorId: z.string().min(1),
  amount: moneySchema, idempotencyKey: z.string().min(8), mode: z.enum(["execute", "propose_only"]).optional(),
});

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
function audit(tenantId: string, type: string, actorId: string, correlationId: string, evidence: Record<string, unknown>): void {
  const event: AuditEvent = { tenantId, id: randomUUID(), type, actorId, correlationId, at: new Date().toISOString(), evidence };
  store.addAudit(event);
}
function tenantAllowed(requestTenant: string, request: { headers: Record<string, string | string[] | undefined> }): boolean {
  const claimed = header(request.headers["x-tenant-id"]);
  return !claimed || claimed === requestTenant;
}

app.get("/health", async () => ({ status: "ok", service: "dsor-lab", policyVersion: "payment-policy-v1" }));

app.get("/api/v1/invoices/:id", async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const tenantId = header(request.headers["x-tenant-id"]);
  if (!tenantId) return reply.code(400).send({ error: "x-tenant-id header is required" });
  const invoice = store.getInvoice(tenantId, params.id);
  if (!invoice) return reply.code(404).send({ error: "Invoice not found" });
  return invoice;
});

app.post("/api/v1/payments/execute", async (request, reply) => {
  const parsed = paymentSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid payment request", details: parsed.error.issues });
  const input: PaymentRequest = parsed.data;
  if (!tenantAllowed(input.tenantId, request)) return reply.code(403).send({ error: "Tenant boundary violation" });
  try { assertMoney(input.amount); } catch (error) { return reply.code(400).send({ error: String(error) }); }

  const idemKey = store.idemKey(input.tenantId, input.idempotencyKey);
  const prior = store.idempotency.get(idemKey);
  if (prior) return reply.send({ ...prior.result, status: "ALREADY_EXECUTED" });

  const invoice = store.getInvoice(input.tenantId, input.invoiceId);
  if (!invoice) return reply.code(404).send({ error: "Invoice not found" });
  const decision = decidePayment(input, invoice);
  const correlationId = randomUUID();

  if (decision.decision === "DENY") {
    audit(input.tenantId, "payment.denied", input.actorId, correlationId, { invoiceId: input.invoiceId, reasons: decision.reasons, policyVersion: decision.policyVersion });
    return reply.code(403).send({ status: "DENIED", decision, correlationId });
  }

  if (input.mode === "propose_only" || decision.decision === "REQUIRE_APPROVAL") {
    const proposal: Proposal = {
      tenantId: input.tenantId, id: `prop_${randomUUID()}`, operation: "payment.execute",
      payloadHash: sha256(JSON.stringify({ invoiceId: input.invoiceId, amount: input.amount, idempotencyKey: input.idempotencyKey })),
      requesterId: input.actorId, idempotencyKey: input.idempotencyKey, invoiceId: input.invoiceId,
      invoiceVersion: invoice.version, amount: input.amount, status: "PENDING_APPROVAL", decision,
      createdAt: new Date().toISOString(),
    };
    store.saveProposal(proposal);
    const result = { status: "PENDING_APPROVAL" as const, proposalId: proposal.id, decision, correlationId };
    store.idempotency.set(idemKey, { tenantId: input.tenantId, result });
    audit(input.tenantId, "payment.proposed", input.actorId, correlationId, { proposalId: proposal.id, payloadHash: proposal.payloadHash, policyVersion: decision.policyVersion });
    return reply.code(202).send(result);
  }

  const paymentId = `pay_${randomUUID()}`;
  store.saveInvoice({ ...invoice, status: "PAID", version: invoice.version + 1 });
  const result = { status: "EXECUTED" as const, paymentId, decision };
  store.idempotency.set(idemKey, { tenantId: input.tenantId, result });
  audit(input.tenantId, "payment.executed", input.actorId, correlationId, { paymentId, invoiceId: input.invoiceId, policyVersion: decision.policyVersion });
  return reply.send(result);
});

app.get("/api/v1/proposals/:id", async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const tenantId = header(request.headers["x-tenant-id"]);
  if (!tenantId) return reply.code(400).send({ error: "x-tenant-id header is required" });
  const proposal = store.getProposal(tenantId, id);
  if (!proposal) return reply.code(404).send({ error: "Proposal not found" });
  return proposal;
});

app.post("/api/v1/proposals/:id/approve", async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const body = z.object({ tenantId: z.string().min(1), approverId: z.string().min(1) }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ error: "tenantId and approverId are required" });
  const { tenantId, approverId } = body.data;
  if (!tenantAllowed(tenantId, request)) return reply.code(403).send({ error: "Tenant boundary violation" });
  if (approverId !== "cfo-001") return reply.code(403).send({ error: "Approver is not authorized for this policy" });
  const proposal = store.getProposal(tenantId, id);
  if (!proposal) return reply.code(404).send({ error: "Proposal not found" });
  if (proposal.requesterId === approverId) return reply.code(403).send({ error: "Separation of duties: requester cannot approve own proposal" });
  if (proposal.status !== "PENDING_APPROVAL") return reply.code(409).send({ error: `Proposal is ${proposal.status}` });
  const invoice = store.getInvoice(tenantId, proposal.invoiceId);
  if (!invoice || invoice.version !== proposal.invoiceVersion || invoice.status !== "OPEN") {
    const invalidated: Proposal = { ...proposal, status: "INVALIDATED" };
    store.saveProposal(invalidated);
    audit(tenantId, "proposal.invalidated", approverId, randomUUID(), { proposalId: id, reason: "Current invoice state changed" });
    return reply.code(409).send({ error: "Proposal invalidated because current state changed" });
  }
  const approved: Proposal = { ...proposal, status: "APPROVED", approvedBy: approverId, approvedAt: new Date().toISOString() };
  store.saveProposal(approved);
  audit(tenantId, "proposal.approved", approverId, randomUUID(), { proposalId: id, policyVersion: proposal.decision.policyVersion });
  return approved;
});

app.post("/api/v1/proposals/:id/execute", async (request, reply) => {
  const { id } = z.object({ id: z.string() }).parse(request.params);
  const body = z.object({ tenantId: z.string().min(1), actorId: z.string().min(1) }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ error: "tenantId and actorId are required" });
  const { tenantId, actorId } = body.data;
  if (!tenantAllowed(tenantId, request)) return reply.code(403).send({ error: "Tenant boundary violation" });
  const proposal = store.getProposal(tenantId, id);
  if (!proposal) return reply.code(404).send({ error: "Proposal not found" });
  if (proposal.status !== "APPROVED") return reply.code(409).send({ error: `Proposal is ${proposal.status}` });
  const invoice = store.getInvoice(tenantId, proposal.invoiceId);
  if (!invoice || invoice.version !== proposal.invoiceVersion || invoice.status !== "OPEN") {
    store.saveProposal({ ...proposal, status: "INVALIDATED" });
    return reply.code(409).send({ error: "Proposal invalidated because current state changed" });
  }
  const idemKey = store.idemKey(tenantId, proposal.idempotencyKey);
  const prior = store.idempotency.get(idemKey);
  if (prior) return reply.send({ ...prior.result, status: "ALREADY_EXECUTED" });
  const paymentId = `pay_${randomUUID()}`;
  store.saveInvoice({ ...invoice, status: "PAID", version: invoice.version + 1 });
  store.saveProposal({ ...proposal, status: "EXECUTED", executedAt: new Date().toISOString() });
  const result = { status: "EXECUTED" as const, paymentId, proposalId: id, decision: proposal.decision };
  store.idempotency.set(idemKey, { tenantId, result });
  audit(tenantId, "payment.executed", actorId, randomUUID(), { paymentId, proposalId: id, approvedBy: proposal.approvedBy, policyVersion: proposal.decision.policyVersion });
  return reply.send(result);
});

app.get("/api/v1/audit/:tenantId", async (request, reply) => {
  const { tenantId } = z.object({ tenantId: z.string() }).parse(request.params);
  if (!tenantAllowed(tenantId, request)) return reply.code(403).send({ error: "Tenant boundary violation" });
  return { tenantId, events: store.getAudit(tenantId) };
});

const port = Number(process.env.PORT ?? 3000);
if (process.env.NODE_ENV !== "test") {
  await app.listen({ port, host: "0.0.0.0" });
}

export { app, store };
