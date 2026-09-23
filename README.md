# DSoR Lab — Data System of Record

A personal, educational TypeScript implementation inspired by Panaversity's DSoR specification.

> This repository is **not** the official Panaversity DSoR implementation. The official DSoR repository currently contains the specification and a working spec package, while the `@panaversity/dsor` reference implementation is marked not started. This project is an independent learner implementation of core DSoR ideas.

## What this implementation demonstrates

- Tenant-scoped state and authorization
- Current-state reads from the system of record
- Policy-controlled actions
- Approved-vendor control
- High-value payment approval
- Separation of duties (requester cannot approve their own proposal)
- Idempotency for state-changing commands
- Proposal → approval → execution lifecycle
- Audit events and decision evidence
- Exact decimal money handling without floating-point arithmetic
- Versioned API surface
- Automated tests and TypeScript type checking

## Architecture

```text
AI Worker / Client
       |
       v
  DSoR API v1
       |
       +--> Authorization / tenant boundary
       +--> Current state store
       +--> Policy controls
       +--> Approval workflow
       +--> Idempotency registry
       +--> Audit log
       |
       v
 Operational records (demo in-memory store)
```

## Requirements

- Node.js 22+
- npm 10+

## Run

```bash
npm install
npm run dev
```

The API starts on `http://localhost:3000`.

## Verify

```bash
npm test
npm run typecheck
npm run check
```

## Demo flow

Create an invoice, then execute a payment. Payments over the configured threshold become `PENDING_APPROVAL`; a different authorized user approves the proposal; execution is then allowed exactly once for the same idempotency key.

## API

- `GET /health`
- `GET /api/v1/invoices/:id`
- `POST /api/v1/payments/execute`
- `GET /api/v1/proposals/:id`
- `POST /api/v1/proposals/:id/approve`
- `GET /api/v1/audit/:tenantId`

Default demo identities:

- `agent-001` — agent/requester
- `cfo-001` — approver
- `ops-001` — operations

## Relationship to the upstream specification

The implementation follows the core concepts visible in the upstream DSoR specification: decision outcomes, `execute`/`propose_only` modes, approval proposals, idempotency, audit evidence, tenant isolation, and policy-linked decisions. It intentionally does not claim conformance to all 268 requirements of DSoR v1.4.0.

Upstream references:

- https://github.com/panaversity/dsor
- https://github.com/panaversity/dsor/blob/main/docs/status.md
- https://github.com/panaversity/dsor/tree/main/docs/baby_steps_tutorials
