import test from "node:test";
import assert from "node:assert/strict";

import { AxmeClient, AxmeHttpError } from "../src/index.js";

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
