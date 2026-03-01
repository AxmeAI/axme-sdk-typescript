import test from "node:test";
import assert from "node:assert/strict";

import { AxmeAuthError, AxmeClient, AxmeHttpError, AxmeRateLimitError, AxmeValidationError } from "../src/index.js";

const THREAD_PAYLOAD = {
  thread_id: "11111111-1111-4111-8111-111111111111",
  intent_id: "22222222-2222-4222-8222-222222222222",
  status: "active",
  owner_agent: "agent://owner",
  from_agent: "agent://from",
  to_agent: "agent://to",
  created_at: "2026-02-28T00:00:00Z",
  updated_at: "2026-02-28T00:00:01Z",
  timeline: [
    {
      event_id: "33333333-3333-4333-8333-333333333333",
      event_type: "message.sent",
      actor: "gateway",
      at: "2026-02-28T00:00:01Z",
      details: { message: "hello" },
    },
  ],
};

const WEBHOOK_SUBSCRIPTION = {
  subscription_id: "44444444-4444-4444-8444-444444444444",
  owner_agent: "agent://owner",
  callback_url: "https://integrator.example/webhooks/axme",
  event_types: ["inbox.thread_created"],
  active: true,
  description: "sdk-test",
  created_at: "2026-02-28T00:00:00Z",
  updated_at: "2026-02-28T00:00:01Z",
  revoked_at: null,
  secret_hint: "****hint",
};

test("health returns parsed payload", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), "https://api.axme.test/health");
      assert.equal(init?.method, "GET");
      assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, "Bearer token");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  );

  assert.deepEqual(await client.health(), { ok: true });
});

test("health propagates provided trace id", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token", autoTraceId: false },
    async (_input, init) => {
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["X-Trace-Id"], "trace-123");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  );

  assert.deepEqual(await client.health({ traceId: "trace-123" }), { ok: true });
});

test("createIntent sends json and returns payload", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test/", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), "https://api.axme.test/v1/intents");
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers.Authorization, "Bearer token");
      assert.equal(headers["Idempotency-Key"], "idem-1");
      assert.equal(
        init?.body,
        JSON.stringify({
          intent_type: "notify.message.v1",
          from_agent: "agent://self",
          to_agent: "agent://target",
          payload: { text: "hello" },
          correlation_id: "11111111-1111-1111-1111-111111111111",
        }),
      );
      return new Response(JSON.stringify({ intent_id: "it_123" }), { status: 200 });
    },
  );

  assert.deepEqual(
    await client.createIntent(
      {
        intent_type: "notify.message.v1",
        from_agent: "agent://self",
        to_agent: "agent://target",
        payload: { text: "hello" },
      },
      {
        correlationId: "11111111-1111-1111-1111-111111111111",
        idempotencyKey: "idem-1",
      },
    ),
    { intent_id: "it_123" },
  );
});

test("createIntent throws AxmeHttpError on non-2xx", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "bad-token" },
    async () => new Response("unauthorized", { status: 401 }),
  );

  await assert.rejects(
    async () =>
      client.createIntent(
        {
          intent_type: "notify.message.v1",
          from_agent: "agent://self",
          to_agent: "agent://target",
          payload: {},
        },
        { correlationId: "11111111-1111-1111-1111-111111111111" },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AxmeHttpError);
      assert.ok(error instanceof AxmeAuthError);
      assert.equal(error.statusCode, 401);
      return true;
    },
  );
});

test("createIntent throws when payload correlation_id mismatches option", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async () => new Response(JSON.stringify({ intent_id: "it_123" }), { status: 200 }),
  );

  await assert.rejects(
    async () =>
      client.createIntent(
        {
          intent_type: "notify.message.v1",
          from_agent: "agent://self",
          to_agent: "agent://target",
          payload: {},
          correlation_id: "22222222-2222-2222-2222-222222222222",
        },
        { correlationId: "11111111-1111-1111-1111-111111111111" },
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /payload correlation_id/);
      return true;
    },
  );
});

test("listInbox sends owner_agent query and returns payload", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), "https://api.axme.test/v1/inbox?owner_agent=agent%3A%2F%2Fowner");
      assert.equal(init?.method, "GET");
      return new Response(JSON.stringify({ ok: true, threads: [THREAD_PAYLOAD] }), { status: 200 });
    },
  );

  assert.deepEqual(await client.listInbox({ ownerAgent: "agent://owner" }), { ok: true, threads: [THREAD_PAYLOAD] });
});

test("getInboxThread sends owner_agent query and returns thread", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(
        input.toString(),
        "https://api.axme.test/v1/inbox/11111111-1111-4111-8111-111111111111?owner_agent=agent%3A%2F%2Fowner",
      );
      assert.equal(init?.method, "GET");
      return new Response(JSON.stringify({ ok: true, thread: THREAD_PAYLOAD }), { status: 200 });
    },
  );

  assert.deepEqual(
    await client.getInboxThread("11111111-1111-4111-8111-111111111111", { ownerAgent: "agent://owner" }),
    { ok: true, thread: THREAD_PAYLOAD },
  );
});

test("replyInboxThread sends message body and idempotency header", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(
        input.toString(),
        "https://api.axme.test/v1/inbox/11111111-1111-4111-8111-111111111111/reply?owner_agent=agent%3A%2F%2Fowner",
      );
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], "reply-1");
      assert.equal(init?.body, JSON.stringify({ message: "ack" }));
      return new Response(JSON.stringify({ ok: true, thread: THREAD_PAYLOAD }), { status: 200 });
    },
  );

  assert.deepEqual(
    await client.replyInboxThread("11111111-1111-4111-8111-111111111111", "ack", {
      ownerAgent: "agent://owner",
      idempotencyKey: "reply-1",
    }),
    { ok: true, thread: THREAD_PAYLOAD },
  );
});

test("listInboxChanges sends pagination query params", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(
        input.toString(),
        "https://api.axme.test/v1/inbox/changes?owner_agent=agent%3A%2F%2Fowner&cursor=cur-1&limit=50",
      );
      assert.equal(init?.method, "GET");
      return new Response(JSON.stringify({ ok: true, changes: [], next_cursor: null, has_more: false }), { status: 200 });
    },
  );

  assert.deepEqual(await client.listInboxChanges({ ownerAgent: "agent://owner", cursor: "cur-1", limit: 50 }), {
    ok: true,
    changes: [],
    next_cursor: null,
    has_more: false,
  });
});

test("decideApproval sends decision payload and idempotency header", async () => {
  const approvalId = "55555555-5555-4555-8555-555555555555";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), `https://api.axme.test/v1/approvals/${approvalId}/decision`);
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], "approval-1");
      assert.equal(init?.body, JSON.stringify({ decision: "approve", comment: "approved" }));
      return new Response(
        JSON.stringify({
          ok: true,
          approval: {
            approval_id: approvalId,
            decision: "approve",
            comment: "approved",
            decided_at: "2026-02-28T00:00:01Z",
          },
        }),
        { status: 200 },
      );
    },
  );

  assert.equal(
    (await client.decideApproval(approvalId, "approve", { comment: "approved", idempotencyKey: "approval-1" })).ok,
    true,
  );
});

test("getCapabilities returns capabilities payload", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), "https://api.axme.test/v1/capabilities");
      assert.equal(init?.method, "GET");
      return new Response(
        JSON.stringify({
          ok: true,
          capabilities: ["inbox", "intents"],
          supported_intent_types: ["intent.ask.v1", "intent.notify.v1"],
        }),
        { status: 200 },
      );
    },
  );

  assert.equal((await client.getCapabilities()).ok, true);
});

test("createInvite sends payload with idempotency header", async () => {
  const inviteToken = "invite-token-0001";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), "https://api.axme.test/v1/invites/create");
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], "invite-create-1");
      assert.equal(
        init?.body,
        JSON.stringify({ owner_agent: "agent://owner", recipient_hint: "receiver", ttl_seconds: 3600 }),
      );
      return new Response(
        JSON.stringify({
          ok: true,
          token: inviteToken,
          invite_url: `https://invite.example/${inviteToken}`,
          owner_agent: "agent://owner",
          recipient_hint: "receiver",
          status: "pending",
          created_at: "2026-02-28T00:00:00Z",
          expires_at: "2026-03-01T00:00:00Z",
        }),
        { status: 200 },
      );
    },
  );

  assert.equal(
    (
      await client.createInvite(
        { owner_agent: "agent://owner", recipient_hint: "receiver", ttl_seconds: 3600 },
        { idempotencyKey: "invite-create-1" },
      )
    ).token,
    inviteToken,
  );
});

test("getInvite fetches invite details by token", async () => {
  const inviteToken = "invite-token-0002";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), `https://api.axme.test/v1/invites/${inviteToken}`);
      assert.equal(init?.method, "GET");
      return new Response(
        JSON.stringify({
          ok: true,
          token: inviteToken,
          owner_agent: "agent://owner",
          recipient_hint: "receiver",
          status: "pending",
          created_at: "2026-02-28T00:00:00Z",
          expires_at: "2026-03-01T00:00:00Z",
          accepted_at: null,
          accepted_owner_agent: null,
          nick: null,
          public_address: null,
        }),
        { status: 200 },
      );
    },
  );

  assert.equal((await client.getInvite(inviteToken)).status, "pending");
});

test("acceptInvite sends payload and returns accepted status", async () => {
  const inviteToken = "invite-token-0003";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), `https://api.axme.test/v1/invites/${inviteToken}/accept`);
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], "invite-accept-1");
      assert.equal(init?.body, JSON.stringify({ nick: "@Invite.User", display_name: "Invite User" }));
      return new Response(
        JSON.stringify({
          ok: true,
          token: inviteToken,
          status: "accepted",
          invite_owner_agent: "agent://owner",
          user_id: "66666666-6666-4666-8666-666666666666",
          owner_agent: "agent://accepted",
          nick: "@Invite.User",
          public_address: "invite.user@ax",
          display_name: "Invite User",
          accepted_at: "2026-02-28T00:00:10Z",
          registry_bind_status: "propagated",
        }),
        { status: 200 },
      );
    },
  );

  assert.equal(
    (
      await client.acceptInvite(
        inviteToken,
        { nick: "@Invite.User", display_name: "Invite User" },
        { idempotencyKey: "invite-accept-1" },
      )
    ).status,
    "accepted",
  );
});

test("createIntent maps 422 to AxmeValidationError", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async () => new Response(JSON.stringify({ message: "invalid payload" }), { status: 422 }),
  );

  await assert.rejects(
    async () =>
      client.createIntent(
        {
          intent_type: "notify.message.v1",
          from_agent: "agent://self",
          to_agent: "agent://target",
          payload: {},
        },
        { correlationId: "11111111-1111-1111-1111-111111111111" },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AxmeValidationError);
      assert.equal(error.statusCode, 422);
      return true;
    },
  );
});

test("listInbox maps 429 to AxmeRateLimitError and parses retry-after", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token", maxRetries: 0 },
    async () => new Response(JSON.stringify({ message: "slow down" }), { status: 429, headers: { "Retry-After": "20" } }),
  );

  await assert.rejects(
    async () => client.listInbox(),
    (error: unknown) => {
      assert.ok(error instanceof AxmeRateLimitError);
      assert.equal(error.statusCode, 429);
      assert.equal(error.retryAfter, 20);
      return true;
    },
  );
});

test("upsertWebhookSubscription sends payload with idempotency header", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), "https://api.axme.test/v1/webhooks/subscriptions");
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], "wh-1");
      assert.equal(
        init?.body,
        JSON.stringify({
          callback_url: "https://integrator.example/webhooks/axme",
          event_types: ["inbox.thread_created"],
          active: true,
        }),
      );
      return new Response(JSON.stringify({ ok: true, subscription: WEBHOOK_SUBSCRIPTION }), { status: 200 });
    },
  );

  assert.deepEqual(
    await client.upsertWebhookSubscription(
      {
        callback_url: "https://integrator.example/webhooks/axme",
        event_types: ["inbox.thread_created"],
        active: true,
      },
      { idempotencyKey: "wh-1" },
    ),
    { ok: true, subscription: WEBHOOK_SUBSCRIPTION },
  );
});

test("listWebhookSubscriptions sends owner_agent query", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), "https://api.axme.test/v1/webhooks/subscriptions?owner_agent=agent%3A%2F%2Fowner");
      assert.equal(init?.method, "GET");
      return new Response(JSON.stringify({ ok: true, subscriptions: [WEBHOOK_SUBSCRIPTION] }), { status: 200 });
    },
  );

  assert.deepEqual(await client.listWebhookSubscriptions({ ownerAgent: "agent://owner" }), {
    ok: true,
    subscriptions: [WEBHOOK_SUBSCRIPTION],
  });
});

test("deleteWebhookSubscription sends owner_agent query", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(
        input.toString(),
        "https://api.axme.test/v1/webhooks/subscriptions/44444444-4444-4444-8444-444444444444?owner_agent=agent%3A%2F%2Fowner",
      );
      assert.equal(init?.method, "DELETE");
      return new Response(
        JSON.stringify({
          ok: true,
          subscription_id: "44444444-4444-4444-8444-444444444444",
          revoked_at: "2026-02-28T00:00:03Z",
        }),
        { status: 200 },
      );
    },
  );

  assert.deepEqual(
    await client.deleteWebhookSubscription("44444444-4444-4444-8444-444444444444", { ownerAgent: "agent://owner" }),
    {
      ok: true,
      subscription_id: "44444444-4444-4444-8444-444444444444",
      revoked_at: "2026-02-28T00:00:03Z",
    },
  );
});

test("publishWebhookEvent sends owner_agent query and payload", async () => {
  const eventId = "33333333-3333-4333-8333-333333333333";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), "https://api.axme.test/v1/webhooks/events?owner_agent=agent%3A%2F%2Fowner");
      assert.equal(init?.method, "POST");
      return new Response(
        JSON.stringify({
          ok: true,
          accepted_at: "2026-02-28T00:00:01Z",
          event_type: "inbox.thread_created",
          source: "sdk-test",
          owner_agent: "agent://owner",
          event_id: eventId,
          queued_deliveries: 1,
          processed_deliveries: 1,
          delivered: 1,
          pending: 0,
          dead_lettered: 0,
        }),
        { status: 200 },
      );
    },
  );

  assert.equal(
    (
      await client.publishWebhookEvent(
        { event_type: "inbox.thread_created", source: "sdk-test", payload: { thread_id: "t-1" } },
        { ownerAgent: "agent://owner" },
      )
    ).event_id,
    eventId,
  );
});

test("replayWebhookEvent sends owner_agent query", async () => {
  const eventId = "33333333-3333-4333-8333-333333333333";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(
        input.toString(),
        "https://api.axme.test/v1/webhooks/events/33333333-3333-4333-8333-333333333333/replay?owner_agent=agent%3A%2F%2Fowner",
      );
      assert.equal(init?.method, "POST");
      return new Response(
        JSON.stringify({
          ok: true,
          event_id: eventId,
          owner_agent: "agent://owner",
          event_type: "inbox.thread_created",
          queued_deliveries: 1,
          processed_deliveries: 1,
          delivered: 1,
          pending: 0,
          dead_lettered: 0,
          replayed_at: "2026-02-28T00:00:02Z",
        }),
        { status: 200 },
      );
    },
  );

  assert.equal((await client.replayWebhookEvent(eventId, { ownerAgent: "agent://owner" })).event_id, eventId);
});

test("retries transient GET failures", async () => {
  let attempts = 0;
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token", retryBackoffMs: 0 },
    async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: "temporary" }), { status: 500 });
      }
      return new Response(JSON.stringify({ ok: true, threads: [] }), { status: 200 });
    },
  );

  assert.deepEqual(await client.listInbox(), { ok: true, threads: [] });
  assert.equal(attempts, 2);
});

test("retries idempotent POST when idempotency key exists", async () => {
  let attempts = 0;
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token", retryBackoffMs: 0 },
    async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: "temporary" }), { status: 500 });
      }
      return new Response(JSON.stringify({ intent_id: "it_123" }), { status: 200 });
    },
  );

  assert.deepEqual(
    await client.createIntent(
      {
        intent_type: "notify.message.v1",
        from_agent: "agent://self",
        to_agent: "agent://target",
        payload: {},
      },
      { correlationId: "11111111-1111-1111-1111-111111111111", idempotencyKey: "idem-retry" },
    ),
    { intent_id: "it_123" },
  );
  assert.equal(attempts, 2);
});

test("does not retry non-idempotent POST by default", async () => {
  let attempts = 0;
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token", retryBackoffMs: 0 },
    async () => {
      attempts += 1;
      return new Response(JSON.stringify({ error: "temporary" }), { status: 500 });
    },
  );

  await assert.rejects(
    async () =>
      client.createIntent(
        {
          intent_type: "notify.message.v1",
          from_agent: "agent://self",
          to_agent: "agent://target",
          payload: {},
        },
        { correlationId: "11111111-1111-1111-1111-111111111111" },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AxmeHttpError);
      assert.equal(error.statusCode, 500);
      return true;
    },
  );
  assert.equal(attempts, 1);
});
