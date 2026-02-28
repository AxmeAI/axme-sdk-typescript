import { AxmeHttpError } from "./errors.js";

export type AxmeClientConfig = {
  baseUrl: string;
  apiKey: string;
};

export type CreateIntentOptions = {
  correlationId: string;
  idempotencyKey?: string;
};

export type OwnerScopedOptions = {
  ownerAgent?: string;
};

export type ReplyInboxOptions = OwnerScopedOptions & {
  idempotencyKey?: string;
};

export class AxmeClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AxmeClientConfig, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.fetchImpl = fetchImpl;
  }

  async health(): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${this.baseUrl}/health`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    });
    return parseJsonResponse(response);
  }

  async createIntent(
    payload: Record<string, unknown>,
    options: CreateIntentOptions,
  ): Promise<Record<string, unknown>> {
    const payloadCorrelationId = payload["correlation_id"];
    if (typeof payloadCorrelationId === "string" && payloadCorrelationId !== options.correlationId) {
      throw new Error("payload correlation_id must match options.correlationId");
    }
    const requestPayload: Record<string, unknown> = {
      ...payload,
      correlation_id: options.correlationId,
    };
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    const response = await this.fetchImpl(`${this.baseUrl}/v1/intents`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestPayload),
    });
    return parseJsonResponse(response);
  }

  async listInbox(options: OwnerScopedOptions = {}): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(this.buildUrl("/v1/inbox", options), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    });
    return parseJsonResponse(response);
  }

  async getInboxThread(threadId: string, options: OwnerScopedOptions = {}): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(this.buildUrl(`/v1/inbox/${threadId}`, options), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    });
    return parseJsonResponse(response);
  }

  async replyInboxThread(
    threadId: string,
    message: string,
    options: ReplyInboxOptions = {},
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }
    const response = await this.fetchImpl(this.buildUrl(`/v1/inbox/${threadId}/reply`, options), {
      method: "POST",
      headers,
      body: JSON.stringify({ message }),
    });
    return parseJsonResponse(response);
  }

  private buildUrl(path: string, options: OwnerScopedOptions): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options.ownerAgent) {
      url.searchParams.set("owner_agent", options.ownerAgent);
    }
    return url.toString();
  }
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw new AxmeHttpError(response.status, await response.text());
  }
  return (await response.json()) as Record<string, unknown>;
}
