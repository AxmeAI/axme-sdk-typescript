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
  maxRetries?: number;
  retryBackoffMs?: number;
  autoTraceId?: boolean;
};

export type RequestOptions = {
  traceId?: string;
};

export type CreateIntentOptions = RequestOptions & {
  correlationId: string;
  idempotencyKey?: string;
};

export type OwnerScopedOptions = RequestOptions & {
  ownerAgent?: string;
};

export type ReplyInboxOptions = OwnerScopedOptions & {
  idempotencyKey?: string;
};

export type InboxChangesOptions = OwnerScopedOptions & {
  cursor?: string;
  limit?: number;
};

export type WebhookSubscriptionUpsertOptions = RequestOptions & {
  idempotencyKey?: string;
};

export type DecideApprovalOptions = RequestOptions & {
  comment?: string;
  idempotencyKey?: string;
};

export type IdempotentOwnerScopedOptions = OwnerScopedOptions & {
  idempotencyKey?: string;
};

export class AxmeClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;
  private readonly autoTraceId: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AxmeClientConfig, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.maxRetries = config.maxRetries ?? 2;
    this.retryBackoffMs = config.retryBackoffMs ?? 200;
    this.autoTraceId = config.autoTraceId ?? true;
    this.fetchImpl = fetchImpl;
  }

  async health(options: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson("/health", {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
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
    return this.requestJson("/v1/intents", {
      method: "POST",
      body: JSON.stringify(requestPayload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async listInbox(options: OwnerScopedOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(this.buildUrl("/v1/inbox", options), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async getInboxThread(threadId: string, options: OwnerScopedOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(this.buildUrl(`/v1/inbox/${threadId}`, options), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async replyInboxThread(
    threadId: string,
    message: string,
    options: ReplyInboxOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(this.buildUrl(`/v1/inbox/${threadId}/reply`, options), {
      method: "POST",
      body: JSON.stringify({ message }),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async listInboxChanges(options: InboxChangesOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(this.buildUrl("/v1/inbox/changes", options), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async decideApproval(
    approvalId: string,
    decision: "approve" | "reject",
    options: DecideApprovalOptions = {},
  ): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = { decision };
    if (typeof options.comment === "string") {
      payload.comment = options.comment;
    }
    return this.requestJson(`/v1/approvals/${approvalId}/decision`, {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async getCapabilities(options: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/capabilities", {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async upsertWebhookSubscription(
    payload: Record<string, unknown>,
    options: WebhookSubscriptionUpsertOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/webhooks/subscriptions", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async listWebhookSubscriptions(options: OwnerScopedOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(this.buildUrl("/v1/webhooks/subscriptions", options), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async deleteWebhookSubscription(subscriptionId: string, options: OwnerScopedOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(this.buildUrl(`/v1/webhooks/subscriptions/${subscriptionId}`, options), {
      method: "DELETE",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async publishWebhookEvent(
    payload: Record<string, unknown>,
    options: IdempotentOwnerScopedOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(this.buildUrl("/v1/webhooks/events", options), {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async replayWebhookEvent(
    eventId: string,
    options: IdempotentOwnerScopedOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(this.buildUrl(`/v1/webhooks/events/${eventId}/replay`, options), {
      method: "POST",
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  private async requestJson(
    pathOrUrl: string,
    options: {
      method: string;
      body?: string;
      idempotencyKey?: string;
      traceId?: string;
      retryable: boolean;
    },
  ): Promise<Record<string, unknown>> {
    const attempts = 1 + (options.retryable ? this.maxRetries : 0);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(this.toAbsoluteUrl(pathOrUrl), {
          method: options.method,
          headers: this.buildHeaders(options.idempotencyKey, options.traceId),
          body: options.body,
        });
      } catch (error) {
        if (attempt >= attempts - 1) {
          throw error;
        }
        await delay(this.retryBackoffMs * 2 ** attempt);
        continue;
      }

      if (options.retryable && attempt < attempts - 1 && isRetryableStatus(response.status)) {
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        if (typeof retryAfter === "number") {
          await delay(Math.max(retryAfter, 0) * 1000);
        } else {
          await delay(this.retryBackoffMs * 2 ** attempt);
        }
        continue;
      }
      return parseJsonResponse(response);
    }
    throw new Error("unreachable retry loop state");
  }

  private buildHeaders(idempotencyKey?: string, traceId?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }
    const normalizedTraceId = this.resolveTraceId(traceId);
    if (normalizedTraceId) {
      headers["X-Trace-Id"] = normalizedTraceId;
    }
    return headers;
  }

  private resolveTraceId(traceId?: string): string | undefined {
    if (traceId && traceId.length > 0) {
      return traceId;
    }
    if (!this.autoTraceId) {
      return undefined;
    }
    return crypto.randomUUID();
  }

  private toAbsoluteUrl(pathOrUrl: string): string {
    if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
      return pathOrUrl;
    }
    return `${this.baseUrl}${pathOrUrl}`;
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

function isRetryableStatus(statusCode: number): boolean {
  return statusCode === 429 || statusCode >= 500;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
