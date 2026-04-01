# axme-sdk-typescript

**TypeScript SDK for AXME** - send intents, listen for deliveries, resume workflows. Fully typed, Promise-based, works in Node.js and edge runtimes.

[![Alpha](https://img.shields.io/badge/status-alpha-orange)](https://cloud.axme.ai/alpha/cli) [![npm](https://img.shields.io/npm/v/@axme/axme)](https://www.npmjs.com/package/@axme/axme) [![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

**[Quick Start](https://cloud.axme.ai/alpha/cli)** · **[Docs](https://github.com/AxmeAI/axme-docs)** · **[Examples](https://github.com/AxmeAI/axme-examples)**

---

## Install

```bash
npm install @axme/axme
```

Requires Node.js 20+.

---

## Quick Start

```typescript
import { AxmeClient } from "@axme/axme";

const client = new AxmeClient({ apiKey: "axme_sa_..." });

// Send an intent - survives crashes, retries, timeouts
const intent = await client.createIntent(
  {
    intent_type: "order.fulfillment.v1",
    to_agent: "agent://myorg/production/fulfillment-service",
    payload: { order_id: "ord_123" },
  },
  { idempotencyKey: "fulfill-ord-123-001" }
);

// Wait for resolution
const result = await client.waitFor(intent.intent_id);
console.log(result.status);
```

---

## Connect an Agent

```typescript
for await (const delivery of client.listen("agent://myorg/production/my-agent")) {
  const intent = await client.getIntent(delivery.intent_id);
  const result = await process(intent.payload);
  await client.resumeIntent(delivery.intent_id, result);
}
```

---

## Human Approvals

```typescript
const intent = await client.createIntent({
  intent_type: "intent.budget.approval.v1",
  to_agent: "agent://myorg/prod/agent_core",
  payload: { amount: 32000 },
  human_task: {
    task_type: "approval",
    notify_email: "approver@example.com",
    allowed_outcomes: ["approved", "rejected"],
  },
});
const result = await client.waitFor(intent.intent_id);  // waits until human acts
```

8 task types: `approval`, `confirmation`, `review`, `assignment`, `form`, `clarification`, `manual_action`, `override`. Full reference: [axme-docs](https://github.com/AxmeAI/axme-docs).

---

## Observe Lifecycle Events

```typescript
for await (const event of client.observe(intent.intent_id)) {
  console.log(event.event_type, event.status);
  if (["RESOLVED", "CANCELLED", "EXPIRED"].includes(event.status)) break;
}
```

---

## Agent Mesh - Monitor and Govern

```typescript
// Start heartbeat - agent appears in dashboard with live health
client.mesh.startHeartbeat(); // background interval, every 30s

// Report metrics after each task
client.mesh.reportMetric({ success: true, latencyMs: 230, costUsd: 0.02 });

// List all agents with health status
const agents = await client.mesh.listAgents();

// Kill a misbehaving agent - blocks all intents instantly
await client.mesh.kill("addr_...");

// Resume it
await client.mesh.resume("addr_...");
```

Open the live dashboard at [mesh.axme.ai](https://mesh.axme.ai) or run `axme mesh dashboard` from the CLI.

Set action policies (allowlist/denylist intent types) and cost policies (intents/day, $/day limits) per agent via dashboard or API. [Agent Mesh overview](https://github.com/AxmeAI/axme#agent-mesh---see-and-control-your-agents).

---

## Examples

```bash
export AXME_API_KEY="axme_sa_..."
npx tsx examples/basic-submit.ts
```

More: [axme-examples](https://github.com/AxmeAI/axme-examples)

---

## Development

```bash
npm install
npm test
```

---

## Related

| | |
|---|---|
| [axme-docs](https://github.com/AxmeAI/axme-docs) | API reference and integration guides |
| [axme-examples](https://github.com/AxmeAI/axme-examples) | Runnable examples |
| [axp-spec](https://github.com/AxmeAI/axp-spec) | Protocol specification |
| [axme-cli](https://github.com/AxmeAI/axme-cli) | CLI tool |
| [axme-conformance](https://github.com/AxmeAI/axme-conformance) | Conformance suite |

---

[hello@axme.ai](mailto:hello@axme.ai) · [Security](SECURITY.md) · [License](LICENSE)
