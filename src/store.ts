import type { AuditEvent, Invoice, Proposal } from "./domain.js";

export class Store {
  readonly invoices = new Map<string, Invoice>();
  readonly proposals = new Map<string, Proposal>();
  readonly idempotency = new Map<string, { tenantId: string; result: unknown }>();
  readonly audit: AuditEvent[] = [];

  constructor() {
    this.invoices.set("tenant-a:INV-1008", {
      tenantId: "tenant-a", id: "INV-1008", vendorId: "VENDOR-44",
      total: { amount: "75000.00", currency: "USD" }, status: "OPEN", version: 1,
    });
    this.invoices.set("tenant-a:INV-1009", {
      tenantId: "tenant-a", id: "INV-1009", vendorId: "VENDOR-99",
      total: { amount: "250.00", currency: "USD" }, status: "OPEN", version: 1,
    });
  }

  invoiceKey(tenantId: string, id: string): string { return `${tenantId}:${id}`; }
  proposalKey(tenantId: string, id: string): string { return `${tenantId}:${id}`; }
  idemKey(tenantId: string, key: string): string { return `${tenantId}:${key}`; }

  getInvoice(tenantId: string, id: string): Invoice | undefined { return this.invoices.get(this.invoiceKey(tenantId, id)); }
  saveInvoice(invoice: Invoice): void { this.invoices.set(this.invoiceKey(invoice.tenantId, invoice.id), invoice); }
  getProposal(tenantId: string, id: string): Proposal | undefined { return this.proposals.get(this.proposalKey(tenantId, id)); }
  saveProposal(proposal: Proposal): void { this.proposals.set(this.proposalKey(proposal.tenantId, proposal.id), proposal); }

  addAudit(event: AuditEvent): void { this.audit.push(event); }
  getAudit(tenantId: string): AuditEvent[] { return this.audit.filter((event) => event.tenantId === tenantId); }
}
