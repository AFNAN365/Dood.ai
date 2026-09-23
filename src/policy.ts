import { decimalToMinor, type DecisionBundle, type Invoice, type PaymentRequest } from "./domain.js";

export const POLICY_VERSION = "payment-policy-v1";
const HIGH_VALUE_USD_CENTS = 50_000n * 100n;

export function decidePayment(request: PaymentRequest, invoice: Invoice): DecisionBundle {
  const reasons: string[] = [];
  if (invoice.status !== "OPEN") {
    return { decision: "DENY", reasons: ["Invoice is not open"], policyVersion: POLICY_VERSION, checkedAt: new Date().toISOString() };
  }
  if (request.amount.currency !== invoice.total.currency) {
    return { decision: "DENY", reasons: ["Payment currency must match invoice currency"], policyVersion: POLICY_VERSION, checkedAt: new Date().toISOString() };
  }
  if (decimalToMinor(request.amount.amount) !== decimalToMinor(invoice.total.amount)) {
    return { decision: "DENY", reasons: ["Payment amount must exactly match the invoice total"], policyVersion: POLICY_VERSION, checkedAt: new Date().toISOString() };
  }
  if (invoice.vendorId !== "VENDOR-44") {
    return { decision: "DENY", reasons: ["Vendor is not in the approved-vendor set"], policyVersion: POLICY_VERSION, checkedAt: new Date().toISOString() };
  }
  if (request.amount.currency === "USD" && decimalToMinor(request.amount.amount) >= HIGH_VALUE_USD_CENTS) {
    reasons.push("Payment meets the high-value threshold and requires CFO approval");
    return { decision: "REQUIRE_APPROVAL", reasons, policyVersion: POLICY_VERSION, checkedAt: new Date().toISOString() };
  }
  return { decision: "ALLOW", reasons: ["Invoice, amount, currency, and vendor controls passed"], policyVersion: POLICY_VERSION, checkedAt: new Date().toISOString() };
}
