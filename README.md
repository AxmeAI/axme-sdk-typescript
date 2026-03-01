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
  maxRetries: 2,
  retryBackoffMs: 200,
});

console.log(await client.health({ traceId: "trace-quickstart-001" }));
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
console.log(await client.listInbox({ ownerAgent: "agent://example/receiver", traceId: "trace-inbox-001" }));
console.log(await client.listInboxChanges({ ownerAgent: "agent://example/receiver", limit: 50 }));
console.log(
  await client.replyInboxThread("11111111-1111-4111-8111-111111111111", "Acknowledged", {
    ownerAgent: "agent://example/receiver",
    idempotencyKey: "reply-001",
  }),
);
console.log(
  await client.decideApproval("55555555-5555-4555-8555-555555555555", "approve", {
    comment: "Looks good",
    idempotencyKey: "approval-001",
  }),
);
console.log(await client.getCapabilities());
const invite = await client.createInvite(
  {
    owner_agent: "agent://example/receiver",
    recipient_hint: "Partner A",
    ttl_seconds: 3600,
  },
  { idempotencyKey: "invite-create-001" },
);
console.log(invite.token);
console.log((await client.getInvite(invite.token as string)).status);
console.log(
  await client.acceptInvite(
    invite.token as string,
    { nick: "@PartnerA.User", display_name: "Partner A" },
    { idempotencyKey: "invite-accept-001" },
  ),
);
const mediaUpload = await client.createMediaUpload(
  {
    owner_agent: "agent://example/receiver",
    filename: "contract.pdf",
    mime_type: "application/pdf",
    size_bytes: 12345,
  },
  { idempotencyKey: "media-create-001" },
);
console.log(mediaUpload.upload_id);
console.log((await client.getMediaUpload(mediaUpload.upload_id as string)).upload);
console.log(
  await client.finalizeMediaUpload(
    { upload_id: mediaUpload.upload_id as string, size_bytes: 12345 },
    { idempotencyKey: "media-finalize-001" },
  ),
);
const schema = await client.upsertSchema(
  {
    semantic_type: "axme.calendar.schedule.v1",
    schema_json: { type: "object", required: ["date"], properties: { date: { type: "string" } } },
    compatibility_mode: "strict",
  },
  { idempotencyKey: "schema-upsert-001" },
);
console.log(schema.schema);
console.log(await client.getSchema("axme.calendar.schedule.v1"));
const registered = await client.registerNick(
  { nick: "@partner.user", display_name: "Partner User" },
  { idempotencyKey: "nick-register-001" },
);
console.log(registered.owner_agent);
console.log(await client.checkNick("@partner.user"));
console.log(
  await client.renameNick(
    { owner_agent: registered.owner_agent as string, nick: "@partner.new" },
    { idempotencyKey: "nick-rename-001" },
  ),
);
console.log(await client.getUserProfile(registered.owner_agent as string));
console.log(
  await client.updateUserProfile(
    { owner_agent: registered.owner_agent as string, display_name: "Partner User Updated" },
    { idempotencyKey: "profile-update-001" },
  ),
);
console.log(
  await client.upsertWebhookSubscription({
    callback_url: "https://integrator.example/webhooks/axme",
    event_types: ["inbox.thread_created"],
    active: true,
  }),
);
console.log(
  await client.publishWebhookEvent(
    { event_type: "inbox.thread_created", source: "sdk-example", payload: { thread_id: "t-1" } },
    { ownerAgent: "agent://example/receiver" },
  ),
);
```

## Development

```bash
npm install
npm test
```
