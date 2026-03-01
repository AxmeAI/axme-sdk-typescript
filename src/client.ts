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
  defaultOwnerAgent?: string;
  mcpEndpointPath?: string;
  mcpProtocolVersion?: string;
  mcpObserver?: (event: McpObserverEvent) => void;
};

export type RequestOptions = {
  traceId?: string;
};

export type CreateIntentOptions = RequestOptions & {
  correlationId: string;
  idempotencyKey?: string;
};

export type SendIntentOptions = RequestOptions & {
  correlationId?: string;
  idempotencyKey?: string;
};

export type ListIntentEventsOptions = RequestOptions & {
  since?: number;
};

export type ResolveIntentOptions = RequestOptions & {
  idempotencyKey?: string;
};

export type ObserveIntentOptions = RequestOptions & {
  since?: number;
  waitSeconds?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

export type WaitForIntentOptions = ObserveIntentOptions;

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

export type InviteWriteOptions = RequestOptions & {
  idempotencyKey?: string;
};

export type MediaWriteOptions = RequestOptions & {
  idempotencyKey?: string;
};

export type SchemaWriteOptions = RequestOptions & {
  idempotencyKey?: string;
};

export type UserWriteOptions = RequestOptions & {
  idempotencyKey?: string;
};

export type McpObserverEvent = {
  phase: "request" | "response";
  method: string;
  rpcId: string;
  retryable: boolean;
  resultKeys?: string[];
};

export type McpCallToolOptions = RequestOptions & {
  arguments?: Record<string, unknown>;
  ownerAgent?: string;
  idempotencyKey?: string;
  validateInputSchema?: boolean;
  retryable?: boolean;
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
  private readonly defaultOwnerAgent?: string;
  private readonly mcpEndpointPath: string;
  private readonly mcpProtocolVersion: string;
  private readonly mcpObserver?: (event: McpObserverEvent) => void;
  private readonly mcpToolSchemas: Record<string, Record<string, unknown>>;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AxmeClientConfig, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.maxRetries = config.maxRetries ?? 2;
    this.retryBackoffMs = config.retryBackoffMs ?? 200;
    this.autoTraceId = config.autoTraceId ?? true;
    this.defaultOwnerAgent = config.defaultOwnerAgent;
    this.mcpEndpointPath = config.mcpEndpointPath ?? "/mcp";
    this.mcpProtocolVersion = config.mcpProtocolVersion ?? "2024-11-05";
    this.mcpObserver = config.mcpObserver;
    this.mcpToolSchemas = {};
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

  async getIntent(intentId: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/intents/${intentId}`, {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async sendIntent(payload: Record<string, unknown>, options: SendIntentOptions = {}): Promise<string> {
    const created = await this.createIntent(payload, {
      correlationId: options.correlationId ?? crypto.randomUUID(),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
    });
    const intentId = created.intent_id;
    if (typeof intentId !== "string" || intentId.length === 0) {
      throw new Error("createIntent response does not include string intent_id");
    }
    return intentId;
  }

  async listIntentEvents(intentId: string, options: ListIntentEventsOptions = {}): Promise<Record<string, unknown>> {
    if (typeof options.since === "number" && options.since < 0) {
      throw new Error("since must be >= 0");
    }
    const url = new URL(`${this.baseUrl}/v1/intents/${intentId}/events`);
    if (typeof options.since === "number") {
      url.searchParams.set("since", String(options.since));
    }
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async resolveIntent(
    intentId: string,
    payload: Record<string, unknown>,
    options: ResolveIntentOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/intents/${intentId}/resolve`, {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async *observe(
    intentId: string,
    options: ObserveIntentOptions = {},
  ): AsyncGenerator<Record<string, unknown>, void, void> {
    const since = options.since ?? 0;
    const waitSeconds = options.waitSeconds ?? 15;
    const pollIntervalMs = options.pollIntervalMs ?? 1000;
    if (since < 0) {
      throw new Error("since must be >= 0");
    }
    if (waitSeconds < 1) {
      throw new Error("waitSeconds must be >= 1");
    }
    if (pollIntervalMs < 0) {
      throw new Error("pollIntervalMs must be >= 0");
    }
    if (typeof options.timeoutMs === "number" && options.timeoutMs <= 0) {
      throw new Error("timeoutMs must be > 0 when provided");
    }

    const deadline = typeof options.timeoutMs === "number" ? Date.now() + options.timeoutMs : undefined;
    let nextSince = since;

    while (true) {
      if (typeof deadline === "number" && Date.now() >= deadline) {
        throw new Error(`timed out while observing intent ${intentId}`);
      }

      let streamWaitSeconds = waitSeconds;
      if (typeof deadline === "number") {
        const msLeft = Math.max(0, deadline - Date.now());
        if (msLeft <= 0) {
          throw new Error(`timed out while observing intent ${intentId}`);
        }
        streamWaitSeconds = Math.max(1, Math.min(waitSeconds, Math.floor(msLeft / 1000)));
      }

      try {
        const streamedEvents = await this.fetchIntentEventStream(intentId, {
          since: nextSince,
          waitSeconds: streamWaitSeconds,
          traceId: options.traceId,
        });
        for (const event of streamedEvents) {
          nextSince = maxSeenSeq(nextSince, event);
          yield event;
          if (isTerminalIntentEvent(event)) {
            return;
          }
        }
      } catch (error) {
        if (!(error instanceof AxmeHttpError) || ![404, 405, 501].includes(error.statusCode)) {
          throw error;
        }
      }

      const polled = await this.listIntentEvents(intentId, {
        since: nextSince > 0 ? nextSince : undefined,
        traceId: options.traceId,
      });
      const events = polled.events;
      if (!Array.isArray(events)) {
        throw new AxmeHttpError(502, "invalid intent events payload: events must be list", { body: polled });
      }
      if (events.length === 0) {
        if (typeof deadline === "number" && Date.now() >= deadline) {
          throw new Error(`timed out while observing intent ${intentId}`);
        }
        await delay(pollIntervalMs);
        continue;
      }

      for (const item of events) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const event = item as Record<string, unknown>;
        nextSince = maxSeenSeq(nextSince, event);
        yield event;
        if (isTerminalIntentEvent(event)) {
          return;
        }
      }
    }
  }

  async waitFor(intentId: string, options: WaitForIntentOptions = {}): Promise<Record<string, unknown>> {
    for await (const event of this.observe(intentId, options)) {
      if (isTerminalIntentEvent(event)) {
        return event;
      }
    }
    throw new Error(`intent observation finished without terminal event for ${intentId}`);
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

  async delegateInboxThread(
    threadId: string,
    payload: Record<string, unknown>,
    options: IdempotentOwnerScopedOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(this.buildUrl(`/v1/inbox/${threadId}/delegate`, options), {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async approveInboxThread(
    threadId: string,
    payload: Record<string, unknown>,
    options: IdempotentOwnerScopedOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(this.buildUrl(`/v1/inbox/${threadId}/approve`, options), {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async rejectInboxThread(
    threadId: string,
    payload: Record<string, unknown>,
    options: IdempotentOwnerScopedOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(this.buildUrl(`/v1/inbox/${threadId}/reject`, options), {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async deleteInboxMessages(
    threadId: string,
    payload: Record<string, unknown>,
    options: IdempotentOwnerScopedOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(this.buildUrl(`/v1/inbox/${threadId}/messages/delete`, options), {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
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

  async createInvite(
    payload: Record<string, unknown>,
    options: InviteWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/invites/create", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async getInvite(token: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/invites/${token}`, {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async acceptInvite(
    token: string,
    payload: Record<string, unknown>,
    options: InviteWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/invites/${token}/accept`, {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async createMediaUpload(
    payload: Record<string, unknown>,
    options: MediaWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/media/create-upload", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async getMediaUpload(uploadId: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/media/${uploadId}`, {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async finalizeMediaUpload(
    payload: Record<string, unknown>,
    options: MediaWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/media/finalize-upload", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async upsertSchema(
    payload: Record<string, unknown>,
    options: SchemaWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/schemas", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async getSchema(semanticType: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/schemas/${semanticType}`, {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async mcpInitialize(options: RequestOptions = {}): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "initialize",
      params: {
        protocolVersion: this.mcpProtocolVersion,
      },
    };
    return this.mcpRequest(payload, {
      traceId: options.traceId,
      retryable: true,
    });
  }

  async mcpListTools(options: RequestOptions = {}): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/list",
      params: {},
    };
    const result = await this.mcpRequest(payload, {
      traceId: options.traceId,
      retryable: true,
    });
    const tools = result.tools;
    if (Array.isArray(tools)) {
      for (const entry of tools) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        const asRecord = entry as Record<string, unknown>;
        const name = asRecord.name;
        const inputSchema = asRecord.inputSchema;
        if (typeof name === "string" && inputSchema && typeof inputSchema === "object") {
          this.mcpToolSchemas[name] = inputSchema as Record<string, unknown>;
        }
      }
    }
    return result;
  }

  async mcpCallTool(name: string, options: McpCallToolOptions = {}): Promise<Record<string, unknown>> {
    if (!name || !name.trim()) {
      throw new Error("tool name must be non-empty string");
    }
    const args: Record<string, unknown> = { ...(options.arguments ?? {}) };
    const ownerAgent = options.ownerAgent ?? this.defaultOwnerAgent;
    if (ownerAgent && typeof args.owner_agent !== "string") {
      args.owner_agent = ownerAgent;
    }
    if (options.idempotencyKey && typeof args.idempotency_key !== "string") {
      args.idempotency_key = options.idempotencyKey;
    }
    if (options.validateInputSchema ?? true) {
      this.validateMcpToolArguments(name.trim(), args);
    }
    const params: Record<string, unknown> = { name: name.trim(), arguments: args };
    if (ownerAgent) {
      params.owner_agent = ownerAgent;
    }
    const payload: Record<string, unknown> = {
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params,
    };
    const retryable = options.retryable ?? Boolean(options.idempotencyKey);
    return this.mcpRequest(payload, {
      traceId: options.traceId,
      retryable,
    });
  }

  async registerNick(
    payload: Record<string, unknown>,
    options: UserWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/users/register-nick", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async checkNick(nick: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/v1/users/check-nick`);
    url.searchParams.set("nick", nick);
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async renameNick(payload: Record<string, unknown>, options: UserWriteOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/users/rename-nick", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async getUserProfile(ownerAgent: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/v1/users/profile`);
    url.searchParams.set("owner_agent", ownerAgent);
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async updateUserProfile(
    payload: Record<string, unknown>,
    options: UserWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/users/profile/update", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
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

  private async fetchIntentEventStream(
    intentId: string,
    options: {
      since: number;
      waitSeconds: number;
      traceId?: string;
    },
  ): Promise<Array<Record<string, unknown>>> {
    const streamUrl = new URL(`${this.baseUrl}/v1/intents/${intentId}/events/stream`);
    streamUrl.searchParams.set("since", String(options.since));
    streamUrl.searchParams.set("wait_seconds", String(options.waitSeconds));

    const response = await this.fetchImpl(streamUrl.toString(), {
      method: "GET",
      headers: this.buildHeaders(undefined, options.traceId),
    });
    if (!response.ok) {
      throw await buildHttpError(response);
    }
    const body = await response.text();
    return parseIntentSseEvents(body);
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

  private async mcpRequest(
    payload: Record<string, unknown>,
    options: { traceId?: string; retryable: boolean },
  ): Promise<Record<string, unknown>> {
    const method = String(payload.method ?? "");
    const rpcId = String(payload.id ?? "");
    this.notifyMcpObserver({
      phase: "request",
      method,
      rpcId,
      retryable: options.retryable,
    });
    const response = await this.requestJson(this.mcpEndpointPath, {
      method: "POST",
      body: JSON.stringify(payload),
      traceId: options.traceId,
      retryable: options.retryable,
    });
    const rpcError = response.error;
    if (rpcError && typeof rpcError === "object") {
      throw this.buildMcpRpcError(rpcError as Record<string, unknown>);
    }
    const result = response.result;
    if (!result || typeof result !== "object") {
      throw new AxmeHttpError(502, "invalid MCP response: missing result object", { body: response });
    }
    this.notifyMcpObserver({
      phase: "response",
      method,
      rpcId,
      retryable: options.retryable,
      resultKeys: Object.keys(result as Record<string, unknown>).sort(),
    });
    return result as Record<string, unknown>;
  }

  private buildMcpRpcError(errorPayload: Record<string, unknown>): AxmeHttpError {
    const codeRaw = errorPayload.code;
    const messageRaw = errorPayload.message;
    const code = typeof codeRaw === "number" ? codeRaw : -32000;
    const message = typeof messageRaw === "string" && messageRaw.length > 0 ? messageRaw : "MCP RPC error";
    const options = {
      body: {
        code,
        message,
        data: errorPayload.data,
      },
    };
    if (code === -32004) {
      return new AxmeRateLimitError(429, message, options);
    }
    if (code === -32001 || code === -32003) {
      return new AxmeAuthError(403, message, options);
    }
    if (code === -32602) {
      return new AxmeValidationError(422, message, options);
    }
    if (code <= -32000) {
      return new AxmeServerError(502, message, options);
    }
    return new AxmeHttpError(400, message, options);
  }

  private validateMcpToolArguments(name: string, argumentsPayload: Record<string, unknown>): void {
    const schema = this.mcpToolSchemas[name];
    if (!schema || typeof schema !== "object") {
      return;
    }
    const requiredRaw = schema.required;
    if (Array.isArray(requiredRaw)) {
      const missing = requiredRaw.filter((entry) => typeof entry === "string" && !(entry in argumentsPayload)) as string[];
      if (missing.length > 0) {
        throw new Error(`missing required MCP tool arguments for ${name}: ${missing.sort().join(", ")}`);
      }
    }
    const properties = schema.properties;
    if (!properties || typeof properties !== "object") {
      return;
    }
    const propertiesRecord = properties as Record<string, unknown>;
    for (const [key, value] of Object.entries(argumentsPayload)) {
      const prop = propertiesRecord[key];
      if (!prop || typeof prop !== "object") {
        continue;
      }
      const propRecord = prop as Record<string, unknown>;
      const declaredType = propRecord.type;
      const acceptedTypes: string[] = Array.isArray(declaredType)
        ? declaredType.filter((item): item is string => typeof item === "string")
        : typeof declaredType === "string"
          ? [declaredType]
          : [];
      if (acceptedTypes.length > 0 && !matchesJsonType(value, acceptedTypes)) {
        throw new Error(`invalid MCP argument type for ${name}.${key}: expected ${acceptedTypes.join("|")}`);
      }
    }
  }

  private notifyMcpObserver(event: McpObserverEvent): void {
    if (!this.mcpObserver) {
      return;
    }
    this.mcpObserver(event);
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

function matchesJsonType(value: unknown, acceptedTypes: string[]): boolean {
  for (const typeName of acceptedTypes) {
    if (typeName === "null" && value === null) {
      return true;
    }
    if (typeName === "string" && typeof value === "string") {
      return true;
    }
    if (typeName === "boolean" && typeof value === "boolean") {
      return true;
    }
    if (typeName === "integer" && Number.isInteger(value)) {
      return true;
    }
    if (typeName === "number" && typeof value === "number") {
      return true;
    }
    if (typeName === "object" && value !== null && typeof value === "object" && !Array.isArray(value)) {
      return true;
    }
    if (typeName === "array" && Array.isArray(value)) {
      return true;
    }
  }
  return false;
}

function parseIntentSseEvents(body: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  const lines = body.split(/\r?\n/);
  let currentEvent: string | undefined;
  let dataLines: string[] = [];

  for (const line of lines) {
    if (line.length === 0) {
      if (currentEvent && currentEvent.startsWith("intent.") && dataLines.length > 0) {
        try {
          const parsed = JSON.parse(dataLines.join("\n"));
          if (parsed && typeof parsed === "object") {
            events.push(parsed as Record<string, unknown>);
          }
        } catch {
          // Ignore malformed stream event payloads and continue processing.
        }
      }
      currentEvent = undefined;
      dataLines = [];
      continue;
    }
    if (line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      currentEvent = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  return events;
}

function maxSeenSeq(nextSince: number, event: Record<string, unknown>): number {
  const seq = event.seq;
  if (typeof seq === "number" && Number.isInteger(seq) && seq >= 0) {
    return Math.max(nextSince, seq);
  }
  return nextSince;
}

function isTerminalIntentEvent(event: Record<string, unknown>): boolean {
  const status = event.status;
  if (typeof status === "string" && ["COMPLETED", "FAILED", "CANCELED"].includes(status)) {
    return true;
  }
  const eventType = event.event_type;
  return typeof eventType === "string" && ["intent.completed", "intent.failed", "intent.canceled"].includes(eventType);
}
