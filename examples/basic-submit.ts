import { randomUUID } from "node:crypto";
import { AxmeClient } from "../src/client.ts";

const client = new AxmeClient({
  apiKey: process.env.AXME_API_KEY ?? "",
  baseUrl: process.env.AXME_BASE_URL ?? "https://api.cloud.axme.ai",
});

const created = await client.createIntent({
  intent_type: "intent.demo.v1",
  from_agent: "agent://basic/typescript/source",
  to_agent: "agent://basic/typescript/target",
  payload: { task: "hello-from-typescript" },
}, { correlationId: randomUUID() });

const current = await client.getIntent(String(created.intent_id));
const intent = (current.intent ?? {}) as Record<string, unknown>;
console.log(intent.status ?? intent.lifecycle_status ?? current.status);
