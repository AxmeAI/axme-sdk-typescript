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
      assert.equal(init?.body, JSON.stringify({ intent_type: "notify" }));
      return new Response(JSON.stringify({ intent_id: "it_123" }), { status: 200 });
    },
  );

  assert.deepEqual(await client.createIntent({ intent_type: "notify" }), { intent_id: "it_123" });
});

test("createIntent throws AxmeHttpError on non-2xx", async () => {
  const client = new AxmeClient(
    { baseUrl: "https://api.axme.test", apiKey: "bad-token" },
    async () => new Response("unauthorized", { status: 401 }),
  );

  await assert.rejects(
    async () => client.createIntent({ intent_type: "notify" }),
    (error: unknown) => {
      assert.ok(error instanceof AxmeHttpError);
      assert.equal(error.statusCode, 401);
      return true;
    },
  );
});
