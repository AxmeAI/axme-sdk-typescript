import test from "node:test";
import assert from "node:assert/strict";

import { AxmeClient, AxmeHttpError } from "../src/index.js";

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
