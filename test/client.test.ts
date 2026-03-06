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
      assert.equal(init?.headers && (init.headers as Record<string, string>)["x-api-key"], "token");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  );

  assert.deepEqual(await client.health(), { ok: true });
});

test("health includes actor token authorization when configured", async () => {
  const client = new AxmeClient(
    {
      baseUrl: "https://api.axme.test",
      apiKey: "platform-key",
      actorToken: "actor-token",
    },
    async (_input, init) => {
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["x-api-key"], "platform-key");
      assert.equal(headers.Authorization, "Bearer actor-token");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  );

  assert.deepEqual(await client.health(), { ok: true });
});

test("constructor rejects conflicting actor token aliases", () => {
  assert.throws(
    () =>
      new AxmeClient({
        baseUrl: "https://api.axme.test",
        apiKey: "platform-key",
        actorToken: "actor-a",
        bearerToken: "actor-b",
      }),
    /actorToken and config\.bearerToken must match/,
  );
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
      assert.equal(headers["x-api-key"], "token");
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

test("getIntent fetches intent by id", async () => {
  const intentId = "22222222-2222-4222-8222-222222222222";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), `https://api.axme.test/v1/intents/${intentId}`);
      assert.equal(init?.method, "GET");
      return new Response(
        JSON.stringify({
          ok: true,
          intent: {
            intent_id: intentId,
            status: "DELIVERED",
            created_at: "2026-02-28T00:00:00Z",
            intent_type: "notify.message.v1",
            correlation_id: "11111111-1111-1111-1111-111111111111",
            from_agent: "agent://self",
            to_agent: "agent://target",
            payload: { text: "hello" },
          },
        }),
        { status: 200 },
      );
    },
  );

  const response = await client.getIntent(intentId);
  const intent = response.intent as Record<string, unknown>;
  assert.equal(intent.intent_id, intentId);
});

test("sendIntent returns intent_id", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), "https://api.axme.test/v1/intents");
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({ intent_id: "33333333-3333-4333-8333-333333333333" }), { status: 200 });
    },
  );

  const intentId = await client.sendIntent(
    {
      intent_type: "notify.message.v1",
      from_agent: "agent://self",
      to_agent: "agent://target",
      payload: { text: "hello" },
    },
    { idempotencyKey: "send-1" },
  );
  assert.equal(intentId, "33333333-3333-4333-8333-333333333333");
});

test("sendIntent requires response intent_id", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  await assert.rejects(async () => client.sendIntent({ intent_type: "notify.message.v1", from_agent: "agent://self", to_agent: "agent://target", payload: {} }));
});

test("listIntentEvents requests events with since", async () => {
  const intentId = "22222222-2222-4222-8222-222222222222";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), `https://api.axme.test/v1/intents/${intentId}/events?since=2`);
      assert.equal(init?.method, "GET");
      return new Response(
        JSON.stringify({
          ok: true,
          events: [{ intent_id: intentId, seq: 3, event_type: "intent.completed", status: "COMPLETED", at: "2026-02-28T00:00:10Z" }],
        }),
        { status: 200 },
      );
    },
  );
  const eventsResponse = await client.listIntentEvents(intentId, { since: 2 });
  const events = eventsResponse.events as Array<Record<string, unknown>>;
  assert.equal(events[0].seq, 3);
});

test("resolveIntent posts terminal payload", async () => {
  const intentId = "22222222-2222-4222-8222-222222222222";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), `https://api.axme.test/v1/intents/${intentId}/resolve`);
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.status, "COMPLETED");
      return new Response(
        JSON.stringify({
          ok: true,
          intent: { intent_id: intentId, status: "COMPLETED" },
          event: { intent_id: intentId, seq: 3, event_type: "intent.completed", status: "COMPLETED" },
          completion_delivery: { delivered: false, reason: "reply_to_not_set" },
        }),
        { status: 200 },
      );
    },
  );
  const response = await client.resolveIntent(intentId, { status: "COMPLETED", result: { answer: "done" } });
  assert.equal((response.event as Record<string, unknown>).event_type, "intent.completed");
});

test("resolveIntent supports owner scope and control headers", async () => {
  const intentId = "22222222-2222-4222-8222-222222222222";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token", autoTraceId: false },
    async (input, init) => {
      assert.equal(input.toString(), `https://api.axme.test/v1/intents/${intentId}/resolve?owner_agent=agent%3A%2F%2Fowner`);
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["x-owner-agent"], "agent://owner");
      assert.equal(headers.authorization, "Bearer scoped-token");
      assert.equal(headers["X-Trace-Id"], "trace-1");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.expected_policy_generation, 3);
      return new Response(JSON.stringify({ ok: true, applied: false, reason: "stale_policy_generation", policy_generation: 4 }), {
        status: 200,
      });
    },
  );
  const response = await client.resolveIntent(
    intentId,
    { status: "COMPLETED", expected_policy_generation: 3 },
    { ownerAgent: "agent://owner", xOwnerAgent: "agent://owner", authorization: "Bearer scoped-token", traceId: "trace-1" },
  );
  assert.equal(response.ok, true);
  assert.equal(response.applied, false);
});

test("resumeIntent posts resume payload", async () => {
  const intentId = "22222222-2222-4222-8222-222222222222";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), `https://api.axme.test/v1/intents/${intentId}/resume?owner_agent=agent%3A%2F%2Fowner`);
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], "resume-1");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.approve_current_step, true);
      return new Response(JSON.stringify({ ok: true, applied: true, intent: { intent_id: intentId } }), { status: 200 });
    },
  );
  const response = await client.resumeIntent(
    intentId,
    { approve_current_step: true, expected_policy_generation: 2 },
    { ownerAgent: "agent://owner", idempotencyKey: "resume-1" },
  );
  assert.equal(response.ok, true);
  assert.equal(response.applied, true);
});

test("updateIntentControls posts controls patch payload", async () => {
  const intentId = "22222222-2222-4222-8222-222222222222";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), `https://api.axme.test/v1/intents/${intentId}/controls`);
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const controlsPatch = body.controls_patch as Record<string, unknown>;
      assert.equal(controlsPatch.timeout_seconds, 120);
      return new Response(JSON.stringify({ ok: true, applied: true, policy_generation: 5 }), { status: 200 });
    },
  );
  const response = await client.updateIntentControls(intentId, {
    controls_patch: { timeout_seconds: 120 },
    expected_policy_generation: 5,
  });
  assert.equal(response.ok, true);
  assert.equal(response.policy_generation, 5);
});

test("updateIntentPolicy posts grants and envelope patch payload", async () => {
  const intentId = "22222222-2222-4222-8222-222222222222";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), `https://api.axme.test/v1/intents/${intentId}/policy?owner_agent=agent%3A%2F%2Fcreator`);
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const grantsPatch = body.grants_patch as Record<string, unknown>;
      const delegate = grantsPatch["delegate:agent://ops"] as Record<string, unknown>;
      assert.deepEqual(delegate.allow, ["resume", "update_controls"]);
      const envelopePatch = body.envelope_patch as Record<string, unknown>;
      assert.equal(envelopePatch.max_retry_count, 10);
      return new Response(JSON.stringify({ ok: true, applied: true, policy_generation: 6 }), { status: 200 });
    },
  );
  const response = await client.updateIntentPolicy(
    intentId,
    {
      grants_patch: { "delegate:agent://ops": { allow: ["resume", "update_controls"] } },
      envelope_patch: { max_retry_count: 10 },
      expected_policy_generation: 5,
    },
    { ownerAgent: "agent://creator" },
  );
  assert.equal(response.ok, true);
  assert.equal(response.policy_generation, 6);
});

test("observe prefers stream and yields terminal lifecycle", async () => {
  const intentId = "22222222-2222-4222-8222-222222222222";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), `https://api.axme.test/v1/intents/${intentId}/events/stream?since=1&wait_seconds=5`);
      assert.equal(init?.method, "GET");
      const body = [
        "id: 2",
        "event: intent.submitted",
        "data: {\"intent_id\":\"22222222-2222-4222-8222-222222222222\",\"seq\":2,\"event_type\":\"intent.submitted\",\"status\":\"SUBMITTED\",\"at\":\"2026-02-28T00:00:01Z\"}",
        "",
        "id: 3",
        "event: intent.completed",
        "data: {\"intent_id\":\"22222222-2222-4222-8222-222222222222\",\"seq\":3,\"event_type\":\"intent.completed\",\"status\":\"COMPLETED\",\"at\":\"2026-02-28T00:00:10Z\"}",
        "",
      ].join("\n");
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  );

  const observed: Array<Record<string, unknown>> = [];
  for await (const event of client.observe(intentId, { since: 1, waitSeconds: 5, pollIntervalMs: 0 })) {
    observed.push(event);
  }
  assert.deepEqual(observed.map((event) => event.event_type), ["intent.submitted", "intent.completed"]);
});

test("observe falls back to polling when stream unavailable", async () => {
  const intentId = "22222222-2222-4222-8222-222222222222";
  let streamCalls = 0;
  let pollCalls = 0;
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input) => {
      const url = input.toString();
      if (url.includes("/events/stream")) {
        streamCalls += 1;
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      pollCalls += 1;
      return new Response(
        JSON.stringify({
          ok: true,
          events: [
            { intent_id: intentId, seq: 1, event_type: "intent.created", status: "CREATED", at: "2026-02-28T00:00:00Z" },
            { intent_id: intentId, seq: 2, event_type: "intent.completed", status: "COMPLETED", at: "2026-02-28T00:00:10Z" },
          ],
        }),
        { status: 200 },
      );
    },
  );
  const observed: Array<Record<string, unknown>> = [];
  for await (const event of client.observe(intentId, { pollIntervalMs: 0 })) {
    observed.push(event);
  }
  assert.deepEqual(observed.map((event) => event.event_type), ["intent.created", "intent.completed"]);
  assert.equal(streamCalls, 1);
  assert.equal(pollCalls, 1);
});

test("waitFor rejects when timeout is exceeded", async () => {
  const intentId = "22222222-2222-4222-8222-222222222222";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input) => {
      const url = input.toString();
      if (url.includes("/events/stream")) {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      return new Response(JSON.stringify({ ok: true, events: [] }), { status: 200 });
    },
  );
  await assert.rejects(async () => client.waitFor(intentId, { timeoutMs: 10, pollIntervalMs: 0 }));
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

test("delegateInboxThread sends payload with owner scope", async () => {
  const threadId = "11111111-1111-4111-8111-111111111111";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(
        input.toString(),
        "https://api.axme.test/v1/inbox/11111111-1111-4111-8111-111111111111/delegate?owner_agent=agent%3A%2F%2Fowner",
      );
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], "delegate-1");
      assert.equal(init?.body, JSON.stringify({ delegate_to: "agent://example/delegate", note: "handoff" }));
      return new Response(JSON.stringify({ ok: true, thread: THREAD_PAYLOAD }), { status: 200 });
    },
  );

  assert.deepEqual(
    await client.delegateInboxThread(threadId, { delegate_to: "agent://example/delegate", note: "handoff" }, {
      ownerAgent: "agent://owner",
      idempotencyKey: "delegate-1",
    }),
    { ok: true, thread: THREAD_PAYLOAD },
  );
});

test("approveInboxThread sends decision payload", async () => {
  const threadId = "11111111-1111-4111-8111-111111111111";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(
        input.toString(),
        "https://api.axme.test/v1/inbox/11111111-1111-4111-8111-111111111111/approve?owner_agent=agent%3A%2F%2Fowner",
      );
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], "approve-1");
      assert.equal(init?.body, JSON.stringify({ comment: "approved" }));
      return new Response(JSON.stringify({ ok: true, thread: THREAD_PAYLOAD }), { status: 200 });
    },
  );

  assert.deepEqual(
    await client.approveInboxThread(threadId, { comment: "approved" }, { ownerAgent: "agent://owner", idempotencyKey: "approve-1" }),
    { ok: true, thread: THREAD_PAYLOAD },
  );
});

test("rejectInboxThread sends decision payload", async () => {
  const threadId = "11111111-1111-4111-8111-111111111111";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(
        input.toString(),
        "https://api.axme.test/v1/inbox/11111111-1111-4111-8111-111111111111/reject?owner_agent=agent%3A%2F%2Fowner",
      );
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], "reject-1");
      assert.equal(init?.body, JSON.stringify({ comment: "rejected" }));
      return new Response(JSON.stringify({ ok: true, thread: THREAD_PAYLOAD }), { status: 200 });
    },
  );

  assert.deepEqual(
    await client.rejectInboxThread(threadId, { comment: "rejected" }, { ownerAgent: "agent://owner", idempotencyKey: "reject-1" }),
    { ok: true, thread: THREAD_PAYLOAD },
  );
});

test("deleteInboxMessages sends delete payload", async () => {
  const threadId = "11111111-1111-4111-8111-111111111111";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(
        input.toString(),
        "https://api.axme.test/v1/inbox/11111111-1111-4111-8111-111111111111/messages/delete?owner_agent=agent%3A%2F%2Fowner",
      );
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], "delete-1");
      assert.equal(init?.body, JSON.stringify({ mode: "self", limit: 1 }));
      return new Response(
        JSON.stringify({ ok: true, thread: THREAD_PAYLOAD, mode: "self", deleted_count: 1, message_ids: ["msg-1"] }),
        { status: 200 },
      );
    },
  );

  assert.deepEqual(
    await client.deleteInboxMessages(threadId, { mode: "self", limit: 1 }, { ownerAgent: "agent://owner", idempotencyKey: "delete-1" }),
    { ok: true, thread: THREAD_PAYLOAD, mode: "self", deleted_count: 1, message_ids: ["msg-1"] },
  );
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

test("createMediaUpload sends payload with idempotency header", async () => {
  const uploadId = "77777777-7777-4777-8777-777777777777";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), "https://api.axme.test/v1/media/create-upload");
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], "media-create-1");
      assert.equal(
        init?.body,
        JSON.stringify({
          owner_agent: "agent://owner",
          filename: "contract.pdf",
          mime_type: "application/pdf",
          size_bytes: 12345,
        }),
      );
      return new Response(
        JSON.stringify({
          ok: true,
          upload_id: uploadId,
          owner_agent: "agent://owner",
          bucket: "axme-media",
          object_path: "agent-owner/contract.pdf",
          upload_url: "https://upload.example/media/1",
          status: "pending",
          expires_at: "2026-03-01T00:00:00Z",
          max_size_bytes: 10485760,
        }),
        { status: 200 },
      );
    },
  );

  assert.equal(
    (
      await client.createMediaUpload(
        {
          owner_agent: "agent://owner",
          filename: "contract.pdf",
          mime_type: "application/pdf",
          size_bytes: 12345,
        },
        { idempotencyKey: "media-create-1" },
      )
    ).upload_id,
    uploadId,
  );
});

test("getMediaUpload fetches media upload details", async () => {
  const uploadId = "77777777-7777-4777-8777-777777777777";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), `https://api.axme.test/v1/media/${uploadId}`);
      assert.equal(init?.method, "GET");
      return new Response(
        JSON.stringify({
          ok: true,
          upload: {
            upload_id: uploadId,
            owner_agent: "agent://owner",
            bucket: "axme-media",
            object_path: "agent-owner/contract.pdf",
            mime_type: "application/pdf",
            filename: "contract.pdf",
            size_bytes: 12345,
            sha256: null,
            status: "pending",
            created_at: "2026-02-28T00:00:00Z",
            expires_at: "2026-03-01T00:00:00Z",
            finalized_at: null,
            download_url: null,
            preview_url: null,
          },
        }),
        { status: 200 },
      );
    },
  );

  const mediaGetResponse = await client.getMediaUpload(uploadId);
  const upload = mediaGetResponse.upload as Record<string, unknown>;
  assert.equal(upload.status, "pending");
});

test("finalizeMediaUpload sends payload and returns ready status", async () => {
  const uploadId = "77777777-7777-4777-8777-777777777777";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), "https://api.axme.test/v1/media/finalize-upload");
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], "media-finalize-1");
      assert.equal(init?.body, JSON.stringify({ upload_id: uploadId, size_bytes: 12345 }));
      return new Response(
        JSON.stringify({
          ok: true,
          upload_id: uploadId,
          owner_agent: "agent://owner",
          bucket: "axme-media",
          object_path: "agent-owner/contract.pdf",
          mime_type: "application/pdf",
          size_bytes: 12345,
          sha256: null,
          status: "ready",
          finalized_at: "2026-02-28T00:00:10Z",
        }),
        { status: 200 },
      );
    },
  );

  assert.equal(
    (
      await client.finalizeMediaUpload(
        {
          upload_id: uploadId,
          size_bytes: 12345,
        },
        { idempotencyKey: "media-finalize-1" },
      )
    ).status,
    "ready",
  );
});

test("upsertSchema sends payload and returns schema metadata", async () => {
  const semanticType = "axme.calendar.schedule.v1";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), "https://api.axme.test/v1/schemas");
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], "schema-upsert-1");
      assert.equal(
        init?.body,
        JSON.stringify({
          semantic_type: semanticType,
          schema_json: { type: "object", required: ["date"], properties: { date: { type: "string" } } },
          compatibility_mode: "strict",
        }),
      );
      return new Response(
        JSON.stringify({
          ok: true,
          schema: {
            semantic_type: semanticType,
            schema_ref: `schema://${semanticType}`,
            schema_hash: "a".repeat(64),
            compatibility_mode: "strict",
            scope: "tenant",
            owner_agent: "agent://owner",
            active: true,
            created_at: "2026-02-28T00:00:00Z",
            updated_at: "2026-02-28T00:00:01Z",
          },
        }),
        { status: 200 },
      );
    },
  );

  const response = await client.upsertSchema(
    {
      semantic_type: semanticType,
      schema_json: { type: "object", required: ["date"], properties: { date: { type: "string" } } },
      compatibility_mode: "strict",
    },
    { idempotencyKey: "schema-upsert-1" },
  );
  const schema = response.schema as Record<string, unknown>;
  assert.equal(schema.semantic_type, semanticType);
});

test("getSchema fetches schema details by semantic type", async () => {
  const semanticType = "axme.calendar.schedule.v1";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), `https://api.axme.test/v1/schemas/${semanticType}`);
      assert.equal(init?.method, "GET");
      return new Response(
        JSON.stringify({
          ok: true,
          schema: {
            semantic_type: semanticType,
            schema_ref: `schema://${semanticType}`,
            schema_hash: "b".repeat(64),
            compatibility_mode: "strict",
            scope: "tenant",
            owner_agent: "agent://owner",
            active: true,
            schema_json: { type: "object", properties: { date: { type: "string" } } },
            created_at: "2026-02-28T00:00:00Z",
            updated_at: "2026-02-28T00:00:01Z",
          },
        }),
        { status: 200 },
      );
    },
  );

  const response = await client.getSchema(semanticType);
  const schema = response.schema as Record<string, unknown>;
  assert.equal(schema.semantic_type, semanticType);
});

test("registerNick sends payload with idempotency header", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), "https://api.axme.test/v1/users/register-nick");
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], "nick-register-1");
      assert.equal(init?.body, JSON.stringify({ nick: "@partner.user", display_name: "Partner User" }));
      return new Response(
        JSON.stringify({
          ok: true,
          user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          owner_agent: "agent://user/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          nick: "@partner.user",
          public_address: "partner.user@ax",
          display_name: "Partner User",
          phone: null,
          email: null,
          created_at: "2026-02-28T00:00:00Z",
        }),
        { status: 200 },
      );
    },
  );

  const response = await client.registerNick(
    { nick: "@partner.user", display_name: "Partner User" },
    { idempotencyKey: "nick-register-1" },
  );
  assert.equal(response.owner_agent, "agent://user/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
});

test("checkNick sends query parameter and returns availability", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), "https://api.axme.test/v1/users/check-nick?nick=%40partner.user");
      assert.equal(init?.method, "GET");
      return new Response(
        JSON.stringify({
          ok: true,
          nick: "@partner.user",
          normalized_nick: "partner.user",
          public_address: "partner.user@ax",
          available: true,
        }),
        { status: 200 },
      );
    },
  );

  const response = await client.checkNick("@partner.user");
  assert.equal(response.available, true);
});

test("renameNick sends payload with idempotency header", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), "https://api.axme.test/v1/users/rename-nick");
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], "nick-rename-1");
      assert.equal(
        init?.body,
        JSON.stringify({ owner_agent: "agent://user/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nick: "@partner.new" }),
      );
      return new Response(
        JSON.stringify({
          ok: true,
          user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          owner_agent: "agent://user/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          nick: "@partner.new",
          public_address: "partner.new@ax",
          display_name: "Partner User",
          phone: null,
          email: null,
          renamed_at: "2026-02-28T00:00:01Z",
        }),
        { status: 200 },
      );
    },
  );

  const response = await client.renameNick(
    { owner_agent: "agent://user/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nick: "@partner.new" },
    { idempotencyKey: "nick-rename-1" },
  );
  assert.equal(response.nick, "@partner.new");
});

test("getUserProfile sends owner_agent query parameter", async () => {
  const ownerAgent = "agent://user/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), "https://api.axme.test/v1/users/profile?owner_agent=agent%3A%2F%2Fuser%2Faaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      assert.equal(init?.method, "GET");
      return new Response(
        JSON.stringify({
          ok: true,
          user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          owner_agent: ownerAgent,
          nick: "@partner.new",
          normalized_nick: "partner.new",
          public_address: "partner.new@ax",
          display_name: "Partner User",
          phone: null,
          email: null,
          updated_at: "2026-02-28T00:00:02Z",
        }),
        { status: 200 },
      );
    },
  );

  const response = await client.getUserProfile(ownerAgent);
  assert.equal(response.owner_agent, ownerAgent);
});

test("updateUserProfile sends payload with idempotency header", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), "https://api.axme.test/v1/users/profile/update");
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Idempotency-Key"], "profile-update-1");
      assert.equal(
        init?.body,
        JSON.stringify({
          owner_agent: "agent://user/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          display_name: "Partner Updated",
        }),
      );
      return new Response(
        JSON.stringify({
          ok: true,
          user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          owner_agent: "agent://user/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          nick: "@partner.new",
          normalized_nick: "partner.new",
          public_address: "partner.new@ax",
          display_name: "Partner Updated",
          phone: null,
          email: null,
          updated_at: "2026-02-28T00:00:03Z",
        }),
        { status: 200 },
      );
    },
  );

  const response = await client.updateUserProfile(
    {
      owner_agent: "agent://user/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      display_name: "Partner Updated",
    },
    { idempotencyKey: "profile-update-1" },
  );
  assert.equal(response.display_name, "Partner Updated");
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

test("createServiceAccount sends payload", async () => {
  const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const workspaceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), "https://api.axme.test/v1/service-accounts");
      assert.equal(init?.method, "POST");
      return new Response(
        JSON.stringify({
          ok: true,
          service_account: {
            service_account_id: "sa_123",
            org_id: orgId,
            workspace_id: workspaceId,
          },
        }),
        { status: 200 },
      );
    },
  );

  const response = await client.createServiceAccount({
    org_id: orgId,
    workspace_id: workspaceId,
    name: "sdk-runner",
    created_by_actor_id: "actor_sdk",
  });
  assert.equal((response.service_account as Record<string, unknown>).service_account_id, "sa_123");
});

test("listServiceAccounts and getServiceAccount use enterprise endpoints", async () => {
  const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const workspaceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const serviceAccountId = "sa_abc";
  let call = 0;
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      call += 1;
      assert.equal(init?.method, "GET");
      if (call === 1) {
        assert.equal(
          input.toString(),
          `https://api.axme.test/v1/service-accounts?org_id=${encodeURIComponent(orgId)}&workspace_id=${encodeURIComponent(workspaceId)}`,
        );
        return new Response(JSON.stringify({ ok: true, service_accounts: [{ service_account_id: serviceAccountId }] }), { status: 200 });
      }
      assert.equal(input.toString(), `https://api.axme.test/v1/service-accounts/${serviceAccountId}`);
      return new Response(JSON.stringify({ ok: true, service_account: { service_account_id: serviceAccountId } }), { status: 200 });
    },
  );

  const listed = await client.listServiceAccounts({ orgId, workspaceId });
  assert.equal(((listed.service_accounts as Array<Record<string, unknown>>)[0]).service_account_id, serviceAccountId);
  const fetched = await client.getServiceAccount(serviceAccountId);
  assert.equal((fetched.service_account as Record<string, unknown>).service_account_id, serviceAccountId);
});

test("createServiceAccountKey and revokeServiceAccountKey hit key lifecycle endpoints", async () => {
  const serviceAccountId = "sa_abc";
  const keyId = "sak_abc";
  let call = 0;
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      call += 1;
      assert.equal(init?.method, "POST");
      if (call === 1) {
        assert.equal(input.toString(), `https://api.axme.test/v1/service-accounts/${serviceAccountId}/keys`);
        return new Response(JSON.stringify({ ok: true, key: { key_id: keyId, status: "active" } }), { status: 200 });
      }
      assert.equal(input.toString(), `https://api.axme.test/v1/service-accounts/${serviceAccountId}/keys/${keyId}/revoke`);
      return new Response(JSON.stringify({ ok: true, key: { key_id: keyId, status: "revoked" } }), { status: 200 });
    },
  );

  const keyCreated = await client.createServiceAccountKey(serviceAccountId, { created_by_actor_id: "actor_sdk" });
  assert.equal((keyCreated.key as Record<string, unknown>).key_id, keyId);
  const keyRevoked = await client.revokeServiceAccountKey(serviceAccountId, keyId);
  assert.equal((keyRevoked.key as Record<string, unknown>).status, "revoked");
});

test("enterprise Track F family methods are exposed by SDK", async () => {
  const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const workspaceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const memberId = "mem_123";
  const accessRequestId = "ar_123";
  const principalId = "prn_123";
  const aliasId = "als_123";
  const routeId = "rte_123";
  const bindingId = "bnd_123";
  const deliveryId = "dlv_123";
  const invoiceId = "inv_123";
  const calls: Array<string> = [];

  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      const method = String(init?.method ?? "GET");
      const path = new URL(input.toString()).pathname;
      calls.push(`${method} ${path}`);
      if (method === "POST" && path === "/v1/organizations") return new Response(JSON.stringify({ ok: true, organization: { org_id: orgId } }), { status: 200 });
      if (method === "GET" && path === `/v1/organizations/${orgId}`) return new Response(JSON.stringify({ ok: true, organization: { org_id: orgId } }), { status: 200 });
      if (method === "PATCH" && path === `/v1/organizations/${orgId}`) return new Response(JSON.stringify({ ok: true, organization: { org_id: orgId } }), { status: 200 });
      if (method === "POST" && path === `/v1/organizations/${orgId}/workspaces`) return new Response(JSON.stringify({ ok: true, workspace: { workspace_id: workspaceId } }), { status: 200 });
      if (method === "GET" && path === `/v1/organizations/${orgId}/workspaces`) return new Response(JSON.stringify({ ok: true, workspaces: [{ workspace_id: workspaceId }] }), { status: 200 });
      if (method === "PATCH" && path === `/v1/organizations/${orgId}/workspaces/${workspaceId}`) return new Response(JSON.stringify({ ok: true, workspace: { workspace_id: workspaceId } }), { status: 200 });
      if (method === "GET" && path === `/v1/organizations/${orgId}/members`) return new Response(JSON.stringify({ ok: true, members: [{ member_id: memberId }] }), { status: 200 });
      if (method === "POST" && path === `/v1/organizations/${orgId}/members`) return new Response(JSON.stringify({ ok: true, member: { member_id: memberId } }), { status: 200 });
      if (method === "PATCH" && path === `/v1/organizations/${orgId}/members/${memberId}`) return new Response(JSON.stringify({ ok: true, member: { member_id: memberId } }), { status: 200 });
      if (method === "DELETE" && path === `/v1/organizations/${orgId}/members/${memberId}`) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (method === "POST" && path === "/v1/access-requests") return new Response(JSON.stringify({ ok: true, access_request: { access_request_id: accessRequestId } }), { status: 200 });
      if (method === "GET" && path === "/v1/access-requests") return new Response(JSON.stringify({ ok: true, access_requests: [{ access_request_id: accessRequestId }] }), { status: 200 });
      if (method === "GET" && path === `/v1/access-requests/${accessRequestId}`) return new Response(JSON.stringify({ ok: true, access_request: { access_request_id: accessRequestId } }), { status: 200 });
      if (method === "POST" && path === `/v1/access-requests/${accessRequestId}/review`) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (method === "PATCH" && path === "/v1/quotas") return new Response(JSON.stringify({ ok: true, quota_policy: { org_id: orgId } }), { status: 200 });
      if (method === "GET" && path === "/v1/quotas") return new Response(JSON.stringify({ ok: true, quota_policy: { org_id: orgId } }), { status: 200 });
      if (method === "GET" && path === "/v1/usage/summary") return new Response(JSON.stringify({ ok: true, summary: { org_id: orgId } }), { status: 200 });
      if (method === "GET" && path === "/v1/usage/timeseries") return new Response(JSON.stringify({ ok: true, series: { org_id: orgId } }), { status: 200 });
      if (method === "POST" && path === "/v1/principals") return new Response(JSON.stringify({ ok: true, principal: { principal_id: principalId } }), { status: 200 });
      if (method === "GET" && path === `/v1/principals/${principalId}`) return new Response(JSON.stringify({ ok: true, principal: { principal_id: principalId } }), { status: 200 });
      if (method === "POST" && path === "/v1/aliases") return new Response(JSON.stringify({ ok: true, alias: { alias_id: aliasId } }), { status: 200 });
      if (method === "GET" && path === "/v1/aliases") return new Response(JSON.stringify({ ok: true, aliases: [{ alias_id: aliasId }] }), { status: 200 });
      if (method === "GET" && path === "/v1/aliases/resolve") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (method === "POST" && path === `/v1/aliases/${aliasId}/revoke`) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (method === "POST" && path === "/v1/routing/endpoints") return new Response(JSON.stringify({ ok: true, route: { route_id: routeId } }), { status: 200 });
      if (method === "GET" && path === "/v1/routing/endpoints") return new Response(JSON.stringify({ ok: true, routes: [{ route_id: routeId }] }), { status: 200 });
      if (method === "PATCH" && path === `/v1/routing/endpoints/${routeId}`) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (method === "DELETE" && path === `/v1/routing/endpoints/${routeId}`) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (method === "POST" && path === "/v1/routing/resolve") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (method === "POST" && path === "/v1/transports/bindings") return new Response(JSON.stringify({ ok: true, binding: { binding_id: bindingId } }), { status: 200 });
      if (method === "GET" && path === "/v1/transports/bindings") return new Response(JSON.stringify({ ok: true, bindings: [{ binding_id: bindingId }] }), { status: 200 });
      if (method === "DELETE" && path === `/v1/transports/bindings/${bindingId}`) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (method === "POST" && path === "/v1/deliveries") return new Response(JSON.stringify({ ok: true, delivery: { delivery_id: deliveryId } }), { status: 200 });
      if (method === "GET" && path === "/v1/deliveries") return new Response(JSON.stringify({ ok: true, deliveries: [{ delivery_id: deliveryId }] }), { status: 200 });
      if (method === "GET" && path === `/v1/deliveries/${deliveryId}`) return new Response(JSON.stringify({ ok: true, delivery: { delivery_id: deliveryId } }), { status: 200 });
      if (method === "POST" && path === `/v1/deliveries/${deliveryId}/replay`) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (method === "PATCH" && path === "/v1/billing/plan") return new Response(JSON.stringify({ ok: true, billing_plan: { org_id: orgId } }), { status: 200 });
      if (method === "GET" && path === "/v1/billing/plan") return new Response(JSON.stringify({ ok: true, billing_plan: { org_id: orgId } }), { status: 200 });
      if (method === "GET" && path === "/v1/billing/invoices") return new Response(JSON.stringify({ ok: true, invoices: [{ invoice_id: invoiceId }] }), { status: 200 });
      if (method === "GET" && path === `/v1/billing/invoices/${invoiceId}`) return new Response(JSON.stringify({ ok: true, invoice: { invoice_id: invoiceId } }), { status: 200 });
      throw new Error(`unexpected request ${method} ${path}`);
    },
  );

  assert.equal((await client.createOrganization({ org_id: orgId, name: "Acme" })).ok, true);
  assert.equal((await client.getOrganization(orgId)).ok, true);
  assert.equal((await client.updateOrganization(orgId, { name: "Acme Updated" })).ok, true);
  assert.equal((await client.createWorkspace(orgId, { workspace_id: workspaceId, name: "Prod", environment: "production" })).ok, true);
  assert.equal((await client.listWorkspaces(orgId)).ok, true);
  assert.equal((await client.updateWorkspace(orgId, workspaceId, { name: "Production" })).ok, true);
  assert.equal((await client.listOrganizationMembers(orgId, { workspaceId })).ok, true);
  assert.equal((await client.addOrganizationMember(orgId, { actor_id: "actor_member", role: "member", workspace_id: workspaceId })).ok, true);
  assert.equal((await client.updateOrganizationMember(orgId, memberId, { status: "suspended" })).ok, true);
  assert.equal((await client.removeOrganizationMember(orgId, memberId)).ok, true);
  assert.equal((await client.createAccessRequest({ request_type: "workspace_join", requester_actor_id: "actor_member" })).ok, true);
  assert.equal((await client.listAccessRequests({ orgId, workspaceId, state: "pending" })).ok, true);
  assert.equal((await client.getAccessRequest(accessRequestId)).ok, true);
  assert.equal((await client.reviewAccessRequest(accessRequestId, { decision: "approve", reviewer_actor_id: "actor_admin" })).ok, true);
  assert.equal((await client.updateQuota({ org_id: orgId, workspace_id: workspaceId, dimensions: {}, overage_mode: "block", updated_by_actor_id: "actor_admin" })).ok, true);
  assert.equal((await client.getQuota(orgId, workspaceId)).ok, true);
  assert.equal((await client.getUsageSummary(orgId, workspaceId)).ok, true);
  assert.equal((await client.getUsageTimeseries(orgId, workspaceId)).ok, true);
  assert.equal((await client.createPrincipal({ org_id: orgId, workspace_id: workspaceId, principal_type: "service_agent" })).ok, true);
  assert.equal((await client.getPrincipal(principalId)).ok, true);
  assert.equal((await client.bindAlias({ principal_id: principalId, alias: "agent://acme/billing", alias_type: "service" })).ok, true);
  assert.equal((await client.listAliases(orgId, workspaceId)).ok, true);
  assert.equal((await client.resolveAlias(orgId, workspaceId, "agent://acme/billing")).ok, true);
  assert.equal((await client.revokeAlias(aliasId)).ok, true);
  assert.equal((await client.registerRoutingEndpoint({ principal_id: principalId, transport_type: "http", endpoint_url: "https://example", auth_mode: "jwt" })).ok, true);
  assert.equal((await client.listRoutingEndpoints(orgId, workspaceId)).ok, true);
  assert.equal((await client.updateRoutingEndpoint(routeId, { priority: 1 })).ok, true);
  assert.equal((await client.removeRoutingEndpoint(routeId)).ok, true);
  assert.equal((await client.resolveRouting({ org_id: orgId, workspace_id: workspaceId, principal_id: principalId })).ok, true);
  assert.equal((await client.upsertTransportBinding({ principal_id: principalId, transport_type: "http", transport_handle: "https://example" })).ok, true);
  assert.equal((await client.listTransportBindings(orgId, workspaceId)).ok, true);
  assert.equal((await client.removeTransportBinding(bindingId)).ok, true);
  assert.equal((await client.submitDelivery({ org_id: orgId, workspace_id: workspaceId, principal_id: principalId, payload: { event: "test" } })).ok, true);
  assert.equal((await client.listDeliveries(orgId, workspaceId)).ok, true);
  assert.equal((await client.getDelivery(deliveryId)).ok, true);
  assert.equal((await client.replayDelivery(deliveryId)).ok, true);
  assert.equal((await client.updateBillingPlan({ org_id: orgId, workspace_id: workspaceId, plan_code: "enterprise", currency: "USD", monthly_commit_minor: 100, overage_unit_price_minor: 1, updated_by_actor_id: "actor_admin" })).ok, true);
  assert.equal((await client.getBillingPlan(orgId, workspaceId)).ok, true);
  assert.equal((await client.listBillingInvoices(orgId, workspaceId)).ok, true);
  assert.equal((await client.getBillingInvoice(invoiceId)).ok, true);
  assert.equal(calls.length, 40);
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

test("mcpInitialize sends initialize request and returns result", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (input, init) => {
      assert.equal(input.toString(), "https://api.axme.test/mcp");
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.jsonrpc, "2.0");
      assert.equal(body.method, "initialize");
      const params = body.params as Record<string, unknown>;
      assert.equal(params.protocolVersion, "2024-11-05");
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { protocolVersion: "2024-11-05", capabilities: { tools: { listChanged: false } } },
        }),
        { status: 200 },
      );
    },
  );

  const result = await client.mcpInitialize();
  assert.equal(result.protocolVersion, "2024-11-05");
});

test("mcpListTools caches schema and mcpCallTool propagates owner/idempotency", async () => {
  const observerEvents: Array<Record<string, unknown>> = [];
  const client = new AxmeClient(
    {
      baseUrl: "https://api.axme.test",
      apiKey: "token",
      defaultOwnerAgent: "agent://owner/default",
      mcpObserver: (event) => observerEvents.push(event as unknown as Record<string, unknown>),
    },
    async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.method === "tools/list") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                {
                  name: "axme.send",
                  inputSchema: {
                    type: "object",
                    required: ["to"],
                    properties: {
                      to: { type: "string" },
                      text: { type: "string" },
                      owner_agent: { type: "string" },
                      idempotency_key: { type: "string" },
                    },
                  },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      const params = body.params as Record<string, unknown>;
      assert.equal(body.method, "tools/call");
      assert.equal(params.name, "axme.send");
      assert.equal(params.owner_agent, "agent://owner/default");
      const args = params.arguments as Record<string, unknown>;
      assert.equal(args.owner_agent, "agent://owner/default");
      assert.equal(args.idempotency_key, "mcp-idem-1");
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { ok: true, tool: "axme.send", status: "completed" },
        }),
        { status: 200 },
      );
    },
  );

  const listed = await client.mcpListTools();
  const tools = listed.tools as unknown[];
  assert.equal(Array.isArray(tools), true);
  const called = await client.mcpCallTool("axme.send", {
    arguments: { to: "agent://bob", text: "hello" },
    idempotencyKey: "mcp-idem-1",
  });
  assert.equal(called.ok, true);
  assert.ok(observerEvents.some((event) => event.phase === "request"));
  assert.ok(observerEvents.some((event) => event.phase === "response"));
});

test("mcpCallTool validates required arguments from input schema", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.method === "tools/list") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                {
                  name: "axme.reply",
                  inputSchema: {
                    type: "object",
                    required: ["thread_id", "message"],
                    properties: {
                      thread_id: { type: "string" },
                      message: { type: "string" },
                    },
                  },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    },
  );

  await client.mcpListTools();
  await assert.rejects(async () => client.mcpCallTool("axme.reply", { arguments: { thread_id: "t-1" } }), /missing required MCP tool arguments/);
});

test("mcpCallTool maps RPC error to AxmeValidationError", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token" },
    async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32602, message: "invalid params" },
        }),
        { status: 200 },
      );
    },
  );

  await assert.rejects(
    async () => client.mcpCallTool("axme.send", { arguments: { to: "agent://bob" } }),
    (error: unknown) => {
      assert.ok(error instanceof AxmeValidationError);
      assert.equal(error.statusCode, 422);
      return true;
    },
  );
});

test("mcpCallTool retries on transient HTTP failures when retryable", async () => {
  let attempts = 0;
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "token", retryBackoffMs: 0 },
    async (_input, init) => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: "temporary" }), { status: 500 });
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { ok: true, tool: "axme.send", status: "completed" },
        }),
        { status: 200 },
      );
    },
  );

  const result = await client.mcpCallTool("axme.send", {
    arguments: { to: "agent://bob", text: "hello" },
    idempotencyKey: "idem-1",
  });
  assert.equal(result.ok, true);
  assert.equal(attempts, 2);
});
