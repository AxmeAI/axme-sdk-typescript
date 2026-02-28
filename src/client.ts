import {
  AxmeAuthError,
  AxmeHttpError,
  AxmeRateLimitError,
  AxmeServerError,
  AxmeValidationError,
} from "./errors.js";

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

export type InboxChangesOptions = OwnerScopedOptions & {
  cursor?: string;
  limit?: number;
};

export type WebhookSubscriptionUpsertOptions = {
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

  async listInboxChanges(options: InboxChangesOptions = {}): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(this.buildUrl("/v1/inbox/changes", options), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    });
    return parseJsonResponse(response);
  }

  async upsertWebhookSubscription(
    payload: Record<string, unknown>,
    options: WebhookSubscriptionUpsertOptions = {},
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }
    const response = await this.fetchImpl(`${this.baseUrl}/v1/webhooks/subscriptions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    return parseJsonResponse(response);
  }

  async listWebhookSubscriptions(options: OwnerScopedOptions = {}): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(this.buildUrl("/v1/webhooks/subscriptions", options), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    });
    return parseJsonResponse(response);
  }

  async deleteWebhookSubscription(subscriptionId: string, options: OwnerScopedOptions = {}): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(this.buildUrl(`/v1/webhooks/subscriptions/${subscriptionId}`, options), {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    });
    return parseJsonResponse(response);
  }

  async publishWebhookEvent(payload: Record<string, unknown>, options: OwnerScopedOptions = {}): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(this.buildUrl("/v1/webhooks/events", options), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return parseJsonResponse(response);
  }

  async replayWebhookEvent(eventId: string, options: OwnerScopedOptions = {}): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(this.buildUrl(`/v1/webhooks/events/${eventId}/replay`, options), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    });
    return parseJsonResponse(response);
  }

  private buildUrl(path: string, options: OwnerScopedOptions & { cursor?: string; limit?: number }): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options.ownerAgent) {
      url.searchParams.set("owner_agent", options.ownerAgent);
    }
    if (typeof options.cursor === "string") {
      url.searchParams.set("cursor", options.cursor);
    }
    if (typeof options.limit === "number") {
      url.searchParams.set("limit", String(options.limit));
    }
    return url.toString();
  }
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw await buildHttpError(response);
  }
  return (await response.json()) as Record<string, unknown>;
}

async function buildHttpError(response: Response): Promise<AxmeHttpError> {
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    body = undefined;
  }

  const text = await response.text();
  const message = extractErrorMessage(body, text);
  const options = {
    body,
    requestId: response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? undefined,
    traceId: response.headers.get("x-trace-id") ?? response.headers.get("trace-id") ?? undefined,
    retryAfter: parseRetryAfter(response.headers.get("retry-after")),
  };
  if (response.status === 401 || response.status === 403) {
    return new AxmeAuthError(response.status, message, options);
  }
  if ([400, 409, 413, 422].includes(response.status)) {
    return new AxmeValidationError(response.status, message, options);
  }
  if (response.status === 429) {
    return new AxmeRateLimitError(response.status, message, options);
  }
  if (response.status >= 500) {
    return new AxmeServerError(response.status, message, options);
  }
  return new AxmeHttpError(response.status, message, options);
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.length > 0) {
    return body;
  }
  if (body && typeof body === "object") {
    const asRecord = body as Record<string, unknown>;
    const errorValue = asRecord.error;
    if (typeof errorValue === "string" && errorValue.length > 0) {
      return errorValue;
    }
    if (errorValue && typeof errorValue === "object" && typeof (errorValue as Record<string, unknown>).message === "string") {
      return (errorValue as Record<string, string>).message;
    }
    if (typeof asRecord.message === "string" && asRecord.message.length > 0) {
      return asRecord.message;
    }
  }
  return fallback;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return parsed;
}
