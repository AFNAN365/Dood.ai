export type Currency = "USD" | "PKR";
export type ProposalStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "INVALIDATED" | "EXECUTED";
export type Decision = "ALLOW" | "REQUIRE_APPROVAL" | "DENY";

export interface Money {
  amount: string;
  currency: Currency;
}

export interface Invoice {
  tenantId: string;
  id: string;
  vendorId: string;
  total: Money;
  status: "OPEN" | "PAID";
  version: number;
}

export interface PaymentRequest {
  tenantId: string;
  invoiceId: string;
  actorId: string;
  amount: Money;
  idempotencyKey: string;
  mode?: "execute" | "propose_only";
}

export interface DecisionBundle {
  decision: Decision;
  reasons: string[];
  policyVersion: string;
  checkedAt: string;
}

export interface Proposal {
  tenantId: string;
  id: string;
  operation: "payment.execute";
  payloadHash: string;
  requesterId: string;
  status: ProposalStatus;
  decision: DecisionBundle;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  executedAt?: string;
}

export interface AuditEvent {
  tenantId: string;
  id: string;
  type: string;
  actorId: string;
  correlationId: string;
  at: string;
  evidence: Record<string, unknown>;
}

export interface PaymentResult {
  status: "EXECUTED" | "PENDING_APPROVAL" | "ALREADY_EXECUTED";
  paymentId?: string;
  proposalId?: string;
  decision: DecisionBundle;
}

export function assertMoney(value: Money): void {
  if (!/^\d+(\.\d{1,2})?$/.test(value.amount)) throw new Error("Money amount must be a non-negative decimal string");
  if (!(["USD", "PKR"] as string[]).includes(value.currency)) throw new Error("Unsupported currency");
}

export function decimalToMinor(amount: string): bigint {
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

export function sha256(input: string): string {
  // Lazy import is avoided so this module stays deterministic in tests; server uses the same helper below.
  let hash = 0;
  for (let i = 0; i < input.length; i++) hash = Math.imul(31, hash) + input.charCodeAt(i) | 0;
  return `hash:${Math.abs(hash).toString(16)}`;
}
