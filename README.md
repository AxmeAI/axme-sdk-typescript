# axme-sdk-typescript

Official TypeScript SDK for Axme APIs and workflows.

## Status

Initial v1 skeleton in progress.

## Quickstart

```ts
import { AxmeClient } from "@axme/sdk";

const client = new AxmeClient({
  baseUrl: "https://gateway.example.com",
  apiKey: "YOUR_API_KEY",
});

console.log(await client.health());
console.log(
  await client.createIntent(
    {
      intent_type: "notify.message.v1",
      from_agent: "agent://example/sender",
      to_agent: "agent://example/receiver",
      payload: { text: "hello" },
    },
    {
      correlationId: "11111111-1111-1111-1111-111111111111",
      idempotencyKey: "create-intent-001",
    },
  ),
);
console.log(await client.listInbox({ ownerAgent: "agent://example/receiver" }));
console.log(
  await client.replyInboxThread("11111111-1111-4111-8111-111111111111", "Acknowledged", {
    ownerAgent: "agent://example/receiver",
    idempotencyKey: "reply-001",
  }),
);
```

## Development

```bash
npm install
npm test
```
