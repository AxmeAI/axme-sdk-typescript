import {
  AxmeAuthError,
  AxmeHttpError,
  AxmeRateLimitError,
  AxmeServerError,
  AxmeValidationError,
} from "./errors.js";
import { MeshClient } from "./mesh.js";
import { SDK_VERSION } from "./version.js";

export type AxmeClientConfig = {
  baseUrl?: string;
  apiKey: string;
  actorToken?: string;
  bearerToken?: string;
  maxRetries?: number;
  retryBackoffMs?: number;
  autoTraceId?: boolean;
  defaultOwnerAgent?: string;
  mcpEndpointPath?: string;
  mcpProtocolVersion?: string;
  mcpObserver?: (event: McpObserverEvent) => void;
};

const DEFAULT_BASE_URL = "https://api.cloud.axme.ai";

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
  ownerAgent?: string;
  xOwnerAgent?: string;
  authorization?: string;
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

export type ServiceAccountWriteOptions = RequestOptions & {
  idempotencyKey?: string;
};

export type CreateSessionOptions = RequestOptions & {
  type?: string;
  projectId?: string;
  parentSessionId?: string;
  dependsOn?: string[];
  metadata?: Record<string, unknown>;
};

export type ListSessionsOptions = RequestOptions & {
  status?: string;
  parentSessionId?: string;
  limit?: number;
};

export type PostSessionMessageOptions = RequestOptions & {
  contentType?: string;
};

export type ListSessionMessagesOptions = RequestOptions & {
  since?: number;
  limit?: number;
};

export type GetSessionFeedOptions = RequestOptions & {
  limit?: number;
};

export type ListenSessionOptions = RequestOptions & {
  since?: number;
  waitSeconds?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

export type CompleteSessionOptions = RequestOptions & {
  result?: Record<string, unknown>;
};

export type ServiceAccountsListOptions = RequestOptions & {
  orgId: string;
  workspaceId?: string;
};

export type ApplyScenarioOptions = RequestOptions & {
  idempotencyKey?: string;
};

export type AgentsListOptions = RequestOptions & {
  orgId: string;
  workspaceId: string;
  limit?: number;
};

export type ListenOptions = RequestOptions & {
  since?: number;
  waitSeconds?: number;
  timeoutMs?: number;
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
  private readonly actorToken?: string;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;
  private readonly autoTraceId: boolean;
  private readonly defaultOwnerAgent?: string;
  private readonly mcpEndpointPath: string;
  private readonly mcpProtocolVersion: string;
  private readonly mcpObserver?: (event: McpObserverEvent) => void;
  private readonly mcpToolSchemas: Record<string, Record<string, unknown>>;
  private readonly fetchImpl: typeof fetch;
  private _mesh: MeshClient | null = null;

  /** Access Agent Mesh operations (heartbeat, health, kill switch). */
  get mesh(): MeshClient {
    if (this._mesh === null) {
      this._mesh = new MeshClient(this);
    }
    return this._mesh;
  }

  constructor(config: AxmeClientConfig, fetchImpl: typeof fetch = fetch) {
    if (config.actorToken && config.bearerToken && config.actorToken !== config.bearerToken) {
      throw new Error("config.actorToken and config.bearerToken must match when both are provided");
    }
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    if (!config.apiKey || config.apiKey.trim().length === 0) {
      throw new Error("config.apiKey is required");
    }
    this.apiKey = config.apiKey;
    this.actorToken = config.actorToken ?? config.bearerToken;
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

  /**
   * Submit a ScenarioBundle to POST /v1/scenarios/apply.
   *
   * The server provisions missing agents, compiles the workflow, and creates the intent in one
   * atomic operation.  Returns the full bundle response including `intent_id`, `compile_id`,
   * and `agents_provisioned`.
   */
  async applyScenario(
    bundle: Record<string, unknown>,
    options: ApplyScenarioOptions = {},
  ): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = { ...bundle };
    if (options.idempotencyKey != null) {
      payload["idempotency_key"] ??= options.idempotencyKey;
    }
    return this.requestJson("/v1/scenarios/apply", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  /**
   * Dry-run validate a ScenarioBundle without creating any resources.
   *
   * Returns `{ valid: boolean, errors: string[], warnings: string[] }`.
   */
  async validateScenario(
    bundle: Record<string, unknown>,
    options: RequestOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/scenarios/validate", {
      method: "POST",
      body: JSON.stringify(bundle),
      traceId: options.traceId,
      retryable: true,
    });
  }


  async resolveIntent(
    intentId: string,
    payload: Record<string, unknown>,
    options: ResolveIntentOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(this.buildUrl(`/v1/intents/${intentId}/resolve`, options), {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      headers: this.buildIntentControlHeaders(options),
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async resumeIntent(
    intentId: string,
    payload: Record<string, unknown>,
    options: ResolveIntentOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(this.buildUrl(`/v1/intents/${intentId}/resume`, options), {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      headers: this.buildIntentControlHeaders(options),
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async updateIntentControls(
    intentId: string,
    payload: Record<string, unknown>,
    options: ResolveIntentOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(this.buildUrl(`/v1/intents/${intentId}/controls`, options), {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      headers: this.buildIntentControlHeaders(options),
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async updateIntentPolicy(
    intentId: string,
    payload: Record<string, unknown>,
    options: ResolveIntentOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(this.buildUrl(`/v1/intents/${intentId}/policy`, options), {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      headers: this.buildIntentControlHeaders(options),
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

  async createServiceAccount(
    payload: Record<string, unknown>,
    options: ServiceAccountWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/service-accounts", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async listServiceAccounts(options: ServiceAccountsListOptions): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/v1/service-accounts`);
    url.searchParams.set("org_id", options.orgId);
    if (options.workspaceId) {
      url.searchParams.set("workspace_id", options.workspaceId);
    }
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async getServiceAccount(serviceAccountId: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/service-accounts/${serviceAccountId}`, {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async createServiceAccountKey(
    serviceAccountId: string,
    payload: Record<string, unknown>,
    options: ServiceAccountWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/service-accounts/${serviceAccountId}/keys`, {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async revokeServiceAccountKey(
    serviceAccountId: string,
    keyId: string,
    options: ServiceAccountWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/service-accounts/${serviceAccountId}/keys/${keyId}/revoke`, {
      method: "POST",
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async listAgents(options: AgentsListOptions): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/v1/agents`);
    url.searchParams.set("org_id", options.orgId);
    url.searchParams.set("workspace_id", options.workspaceId);
    if (typeof options.limit === "number") {
      url.searchParams.set("limit", String(options.limit));
    }
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async getAgent(address: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    if (!address || !address.trim()) {
      throw new Error("address must be a non-empty string");
    }
    let pathPart = address.trim();
    if (pathPart.startsWith("agent://")) {
      pathPart = pathPart.slice("agent://".length);
    }
    return this.requestJson(`/v1/agents/${pathPart}`, {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  /**
   * Stream incoming intents for an agent address via SSE.
   *
   * Connects to `GET /v1/agents/{address}/intents/stream` and yields each intent payload
   * as it arrives.  The server sends a `stream.timeout` keepalive when there are no new
   * intents within `waitSeconds`, at which point the client automatically reconnects until
   * `timeoutMs` elapses (or indefinitely when `timeoutMs` is not set).
   *
   * The `since` cursor is advanced automatically — reconnects replay from the last seen
   * sequence number so no events are skipped.
   *
   * @example
   * ```ts
   * for await (const intent of client.listen("agent://acme/main/validator")) {
   *   const result = await process(intent.payload);
   *   await client.resumeIntent(intent.intent_id as string, { outcome: "success", result });
   * }
   * ```
   */
  async *listen(
    address: string,
    options: ListenOptions = {},
  ): AsyncGenerator<Record<string, unknown>, void, void> {
    if (!address || !address.trim()) {
      throw new Error("address must be a non-empty string");
    }
    const since = options.since ?? 0;
    const waitSeconds = options.waitSeconds ?? 15;
    if (since < 0) {
      throw new Error("since must be >= 0");
    }
    if (waitSeconds < 1) {
      throw new Error("waitSeconds must be >= 1");
    }
    if (typeof options.timeoutMs === "number" && options.timeoutMs <= 0) {
      throw new Error("timeoutMs must be > 0 when provided");
    }

    let pathPart = address.trim();
    if (pathPart.startsWith("agent://")) {
      pathPart = pathPart.slice("agent://".length);
    }

    const deadline = typeof options.timeoutMs === "number" ? Date.now() + options.timeoutMs : undefined;
    let nextSince = since;

    while (true) {
      if (typeof deadline === "number" && Date.now() >= deadline) {
        throw new Error(`timed out while listening on ${address}`);
      }

      let streamWaitSeconds = waitSeconds;
      if (typeof deadline === "number") {
        const msLeft = Math.max(0, deadline - Date.now());
        if (msLeft <= 0) {
          throw new Error(`timed out while listening on ${address}`);
        }
        streamWaitSeconds = Math.max(1, Math.min(waitSeconds, Math.floor(msLeft / 1000)));
      }

      const events = await this.fetchAgentIntentStream(pathPart, {
        since: nextSince,
        waitSeconds: streamWaitSeconds,
        traceId: options.traceId,
      });
      for (const event of events) {
        nextSince = maxSeenSeq(nextSince, event);
        yield event;
      }
    }
  }

  async createOrganization(
    payload: Record<string, unknown>,
    options: ServiceAccountWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/organizations", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async getOrganization(orgId: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/organizations/${orgId}`, {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async updateOrganization(
    orgId: string,
    payload: Record<string, unknown>,
    options: ServiceAccountWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/organizations/${orgId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async createWorkspace(
    orgId: string,
    payload: Record<string, unknown>,
    options: ServiceAccountWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/organizations/${orgId}/workspaces`, {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async listWorkspaces(orgId: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/organizations/${orgId}/workspaces`, {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async updateWorkspace(
    orgId: string,
    workspaceId: string,
    payload: Record<string, unknown>,
    options: ServiceAccountWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/organizations/${orgId}/workspaces/${workspaceId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async listOrganizationMembers(
    orgId: string,
    options: RequestOptions & { workspaceId?: string } = {},
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/v1/organizations/${orgId}/members`);
    if (options.workspaceId) {
      url.searchParams.set("workspace_id", options.workspaceId);
    }
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async addOrganizationMember(
    orgId: string,
    payload: Record<string, unknown>,
    options: ServiceAccountWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/organizations/${orgId}/members`, {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async updateOrganizationMember(
    orgId: string,
    memberId: string,
    payload: Record<string, unknown>,
    options: ServiceAccountWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/organizations/${orgId}/members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async removeOrganizationMember(orgId: string, memberId: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/organizations/${orgId}/members/${memberId}`, {
      method: "DELETE",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async createAccessRequest(
    payload: Record<string, unknown>,
    options: ServiceAccountWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/access-requests", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async listAccessRequests(
    options: RequestOptions & { orgId?: string; workspaceId?: string; state?: string } = {},
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/v1/access-requests`);
    if (options.orgId) {
      url.searchParams.set("org_id", options.orgId);
    }
    if (options.workspaceId) {
      url.searchParams.set("workspace_id", options.workspaceId);
    }
    if (options.state) {
      url.searchParams.set("state", options.state);
    }
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async getAccessRequest(accessRequestId: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/access-requests/${accessRequestId}`, {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async reviewAccessRequest(
    accessRequestId: string,
    payload: Record<string, unknown>,
    options: ServiceAccountWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/access-requests/${accessRequestId}/review`, {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async updateQuota(
    payload: Record<string, unknown>,
    options: ServiceAccountWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/quotas", {
      method: "PATCH",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async getQuota(orgId: string, workspaceId: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/v1/quotas`);
    url.searchParams.set("org_id", orgId);
    url.searchParams.set("workspace_id", workspaceId);
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async getUsageSummary(
    orgId: string,
    workspaceId: string,
    options: RequestOptions & { window?: string } = {},
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/v1/usage/summary`);
    url.searchParams.set("org_id", orgId);
    url.searchParams.set("workspace_id", workspaceId);
    if (options.window) {
      url.searchParams.set("window", options.window);
    }
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async getUsageTimeseries(
    orgId: string,
    workspaceId: string,
    options: RequestOptions & { windowDays?: number } = {},
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/v1/usage/timeseries`);
    url.searchParams.set("org_id", orgId);
    url.searchParams.set("workspace_id", workspaceId);
    if (typeof options.windowDays === "number") {
      url.searchParams.set("window_days", String(options.windowDays));
    }
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async createPrincipal(
    payload: Record<string, unknown>,
    options: ServiceAccountWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/principals", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async getPrincipal(principalId: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/principals/${principalId}`, {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async bindAlias(payload: Record<string, unknown>, options: ServiceAccountWriteOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/aliases", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async listAliases(orgId: string, workspaceId: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/v1/aliases`);
    url.searchParams.set("org_id", orgId);
    url.searchParams.set("workspace_id", workspaceId);
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async resolveAlias(
    orgId: string,
    workspaceId: string,
    alias: string,
    options: RequestOptions = {},
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/v1/aliases/resolve`);
    url.searchParams.set("org_id", orgId);
    url.searchParams.set("workspace_id", workspaceId);
    url.searchParams.set("alias", alias);
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async revokeAlias(aliasId: string, options: ServiceAccountWriteOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/aliases/${aliasId}/revoke`, {
      method: "POST",
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async registerRoutingEndpoint(
    payload: Record<string, unknown>,
    options: ServiceAccountWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/routing/endpoints", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async listRoutingEndpoints(orgId: string, workspaceId: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/v1/routing/endpoints`);
    url.searchParams.set("org_id", orgId);
    url.searchParams.set("workspace_id", workspaceId);
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async updateRoutingEndpoint(
    routeId: string,
    payload: Record<string, unknown>,
    options: ServiceAccountWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/routing/endpoints/${routeId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async removeRoutingEndpoint(routeId: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/routing/endpoints/${routeId}`, {
      method: "DELETE",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async resolveRouting(
    payload: Record<string, unknown>,
    options: ServiceAccountWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/routing/resolve", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async upsertTransportBinding(
    payload: Record<string, unknown>,
    options: ServiceAccountWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/transports/bindings", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async listTransportBindings(orgId: string, workspaceId: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/v1/transports/bindings`);
    url.searchParams.set("org_id", orgId);
    url.searchParams.set("workspace_id", workspaceId);
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async removeTransportBinding(bindingId: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/transports/bindings/${bindingId}`, {
      method: "DELETE",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async submitDelivery(
    payload: Record<string, unknown>,
    options: ServiceAccountWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/deliveries", {
      method: "POST",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async listDeliveries(
    orgId: string,
    workspaceId: string,
    options: RequestOptions & { principalId?: string; status?: string } = {},
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/v1/deliveries`);
    url.searchParams.set("org_id", orgId);
    url.searchParams.set("workspace_id", workspaceId);
    if (options.principalId) {
      url.searchParams.set("principal_id", options.principalId);
    }
    if (options.status) {
      url.searchParams.set("status", options.status);
    }
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async getDelivery(deliveryId: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/deliveries/${deliveryId}`, {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async replayDelivery(deliveryId: string, options: ServiceAccountWriteOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/deliveries/${deliveryId}/replay`, {
      method: "POST",
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async updateBillingPlan(
    payload: Record<string, unknown>,
    options: ServiceAccountWriteOptions = {},
  ): Promise<Record<string, unknown>> {
    return this.requestJson("/v1/billing/plan", {
      method: "PATCH",
      body: JSON.stringify(payload),
      idempotencyKey: options.idempotencyKey,
      traceId: options.traceId,
      retryable: Boolean(options.idempotencyKey),
    });
  }

  async getBillingPlan(orgId: string, workspaceId: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/v1/billing/plan`);
    url.searchParams.set("org_id", orgId);
    url.searchParams.set("workspace_id", workspaceId);
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async listBillingInvoices(
    orgId: string,
    workspaceId: string,
    options: RequestOptions & { status?: string } = {},
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/v1/billing/invoices`);
    url.searchParams.set("org_id", orgId);
    url.searchParams.set("workspace_id", workspaceId);
    if (options.status) {
      url.searchParams.set("status", options.status);
    }
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async getBillingInvoice(invoiceId: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/billing/invoices/${invoiceId}`, {
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

  // --- Session API ---

  async createSession(options: CreateSessionOptions = {}): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {};
    if (options.type) payload.type = options.type;
    if (options.projectId) payload.project_id = options.projectId;
    if (options.parentSessionId) payload.parent_session_id = options.parentSessionId;
    if (options.dependsOn) payload.depends_on = options.dependsOn;
    if (options.metadata) payload.metadata = options.metadata;
    return this.requestJson("/v1/sessions", {
      method: "POST",
      body: JSON.stringify(payload),
      traceId: options.traceId,
      retryable: false,
    });
  }

  async getSession(sessionId: string, options: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.requestJson(`/v1/sessions/${sessionId}`, {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async listSessions(options: ListSessionsOptions = {}): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/v1/sessions`);
    if (options.status) url.searchParams.set("status", options.status);
    if (options.parentSessionId) url.searchParams.set("parent_session_id", options.parentSessionId);
    if (typeof options.limit === "number") url.searchParams.set("limit", String(options.limit));
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async postSessionMessage(
    sessionId: string,
    role: string,
    content: unknown,
    options: PostSessionMessageOptions = {},
  ): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = { role, content };
    if (options.contentType) payload.content_type = options.contentType;
    return this.requestJson(`/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
      traceId: options.traceId,
      retryable: false,
    });
  }

  async listSessionMessages(
    sessionId: string,
    options: ListSessionMessagesOptions = {},
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/v1/sessions/${sessionId}/messages`);
    if (typeof options.since === "number") url.searchParams.set("since", String(options.since));
    if (typeof options.limit === "number") url.searchParams.set("limit", String(options.limit));
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async getSessionFeed(
    sessionId: string,
    options: GetSessionFeedOptions = {},
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/v1/sessions/${sessionId}/feed`);
    if (typeof options.limit === "number") url.searchParams.set("limit", String(options.limit));
    return this.requestJson(url.toString(), {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    });
  }

  async *listenSession(
    sessionId: string,
    options: ListenSessionOptions = {},
  ): AsyncGenerator<Record<string, unknown>, void, void> {
    const since = options.since ?? 0;
    const waitSeconds = options.waitSeconds ?? 30;
    const pollIntervalMs = options.pollIntervalMs ?? 1000;
    const deadline = typeof options.timeoutMs === "number" ? Date.now() + options.timeoutMs : undefined;
    let nextSince = since;

    while (true) {
      if (typeof deadline === "number" && Date.now() >= deadline) {
        return;
      }

      let streamWaitSeconds = waitSeconds;
      if (typeof deadline === "number") {
        const msLeft = Math.max(0, deadline - Date.now());
        if (msLeft <= 0) return;
        streamWaitSeconds = Math.max(1, Math.min(waitSeconds, Math.floor(msLeft / 1000)));
      }

      try {
        const streamedEvents = await this.fetchSessionFeedStream(sessionId, {
          since: nextSince,
          waitSeconds: streamWaitSeconds,
          traceId: options.traceId,
        });
        for (const event of streamedEvents) {
          const seq = typeof event.seq === "number" ? event.seq : 0;
          if (seq > nextSince) nextSince = seq;
          yield event;
          if (event.type === "session.completed" || (typeof event.event === "string" && event.event === "session.completed")) {
            return;
          }
        }
      } catch (error) {
        if (!(error instanceof AxmeHttpError) || ![404, 405, 501].includes(error.statusCode)) {
          throw error;
        }
      }

      // Fallback to polling if SSE not supported
      const polled = await this.listSessionMessages(sessionId, {
        since: nextSince > 0 ? nextSince : undefined,
        traceId: options.traceId,
      });
      const messages = polled.messages;
      if (!Array.isArray(messages) || messages.length === 0) {
        if (typeof deadline === "number" && Date.now() >= deadline) return;
        await delay(pollIntervalMs);
        continue;
      }
      for (const msg of messages) {
        if (!msg || typeof msg !== "object") continue;
        const message = msg as Record<string, unknown>;
        const seq = typeof message.seq === "number" ? message.seq : 0;
        if (seq > nextSince) nextSince = seq;
        yield { type: "session.message", ...message };
      }
    }
  }

  async completeSession(
    sessionId: string,
    options: CompleteSessionOptions = {},
  ): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {};
    if (options.result) payload.result = options.result;
    return this.requestJson(`/v1/sessions/${sessionId}/complete`, {
      method: "POST",
      body: JSON.stringify(payload),
      traceId: options.traceId,
      retryable: false,
    });
  }

  private async fetchSessionFeedStream(
    sessionId: string,
    options: {
      since: number;
      waitSeconds: number;
      traceId?: string;
    },
  ): Promise<Array<Record<string, unknown>>> {
    const streamUrl = new URL(`${this.baseUrl}/v1/sessions/${sessionId}/feed/stream`);
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
    return parseSessionSseEvents(body);
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

  private async fetchAgentIntentStream(
    pathPart: string,
    options: {
      since: number;
      waitSeconds: number;
      traceId?: string;
    },
  ): Promise<Array<Record<string, unknown>>> {
    const streamUrl = new URL(`${this.baseUrl}/v1/agents/${pathPart}/intents/stream`);
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
    return parseAgentSseEvents(body);
  }

  private async requestJson(
    pathOrUrl: string,
    options: {
      method: string;
      body?: string;
      idempotencyKey?: string;
      traceId?: string;
      headers?: Record<string, string>;
      retryable: boolean;
    },
  ): Promise<Record<string, unknown>> {
    const attempts = 1 + (options.retryable ? this.maxRetries : 0);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(this.toAbsoluteUrl(pathOrUrl), {
          method: options.method,
          headers: this.buildHeaders(options.idempotencyKey, options.traceId, options.headers),
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

  private buildHeaders(
    idempotencyKey?: string,
    traceId?: string,
    additionalHeaders?: Record<string, string>,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "x-api-key": this.apiKey,
      "Content-Type": "application/json",
      "X-Axme-Client": `axme-sdk-typescript/${SDK_VERSION}`,
    };
    if (this.actorToken) {
      headers.Authorization = `Bearer ${this.actorToken}`;
    }
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }
    const normalizedTraceId = this.resolveTraceId(traceId);
    if (normalizedTraceId) {
      headers["X-Trace-Id"] = normalizedTraceId;
    }
    if (additionalHeaders) {
      for (const [key, value] of Object.entries(additionalHeaders)) {
        headers[key] = value;
      }
    }
    return headers;
  }

  private buildIntentControlHeaders(options: ResolveIntentOptions): Record<string, string> | undefined {
    const headers: Record<string, string> = {};
    if (options.xOwnerAgent) {
      headers["x-owner-agent"] = options.xOwnerAgent;
    }
    if (options.authorization) {
      headers.authorization = options.authorization;
    }
    return Object.keys(headers).length > 0 ? headers : undefined;
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
  return parseSseEvents(body, (eventType) => eventType.startsWith("intent."));
}

function parseAgentSseEvents(body: string): Array<Record<string, unknown>> {
  return parseSseEvents(body, (eventType) => eventType.startsWith("intent."));
}

function parseSessionSseEvents(body: string): Array<Record<string, unknown>> {
  return parseSseEvents(body, (eventType) => eventType.startsWith("session.") || eventType.startsWith("stream."));
}

function parseSseEvents(
  body: string,
  includeEvent: (eventType: string) => boolean,
): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  const lines = body.split(/\r?\n/);
  let currentEvent: string | undefined;
  let dataLines: string[] = [];

  for (const line of lines) {
    if (line.length === 0) {
      if (currentEvent && includeEvent(currentEvent) && dataLines.length > 0) {
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
  if (typeof status === "string" && ["COMPLETED", "FAILED", "CANCELED", "TIMED_OUT"].includes(status)) {
    return true;
  }
  const eventType = event.event_type;
  return (
    typeof eventType === "string" &&
    ["intent.completed", "intent.failed", "intent.canceled", "intent.timed_out"].includes(eventType)
  );
}
