/**
 * Agent Mesh module - heartbeat, health monitoring, metrics reporting.
 */

import type { AxmeClient } from "./client.js";

export type MeshMetric = {
  success?: boolean;
  latencyMs?: number;
  costUsd?: number;
};

export type MeshAgent = {
  address_id: string;
  address: string;
  display_name: string;
  health_status: "healthy" | "degraded" | "unreachable" | "killed" | "unknown";
  last_heartbeat_at: string | null;
  created_at: string;
  intents_period: number;
  cost_period: number;
  metadata: Record<string, unknown> | null;
};

export type MeshAgentsResponse = {
  ok: boolean;
  agents: MeshAgent[];
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    unreachable: number;
    killed: number;
  };
};

export type MeshEvent = {
  event_id: string;
  address: string;
  event_type: string;
  details: Record<string, unknown> | null;
  actor_id: string | null;
  created_at: string;
};

export type ListAgentsOptions = {
  limit?: number;
  health?: string;
  window?: "day" | "week" | "month";
  traceId?: string;
};

export type ListEventsOptions = {
  limit?: number;
  eventType?: string;
  traceId?: string;
};

export class MeshClient {
  private client: AxmeClient;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private metricsBuffer: {
    intents_total: number;
    intents_succeeded: number;
    intents_failed: number;
    avg_latency_ms: number | null;
    cost_usd: number;
  } = { intents_total: 0, intents_succeeded: 0, intents_failed: 0, avg_latency_ms: null, cost_usd: 0 };

  constructor(client: AxmeClient) {
    this.client = client;
  }

  // ── Heartbeat ────────────────────────────────────────────────────

  async heartbeat(metrics?: Record<string, unknown>, options?: { traceId?: string }): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {};
    if (metrics) body.metrics = metrics;
    return this.client["requestJson"]("/v1/mesh/heartbeat", {
      method: "POST",
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
      retryable: true,
      traceId: options?.traceId,
    });
  }

  startHeartbeat(intervalMs: number = 30_000, includeMetrics: boolean = true): void {
    if (this.heartbeatTimer !== null) return;

    this.heartbeatTimer = setInterval(async () => {
      try {
        const metrics = includeMetrics ? this.flushMetrics() : undefined;
        await this.heartbeat(metrics ?? undefined);
      } catch {
        // Heartbeat failures are non-fatal
      }
    }, intervalMs);

    // Unref so timer doesn't prevent Node.js from exiting
    if (typeof this.heartbeatTimer === "object" && "unref" in this.heartbeatTimer) {
      this.heartbeatTimer.unref();
    }
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Metrics ──────────────────────────────────────────────────────

  reportMetric(metric: MeshMetric): void {
    const buf = this.metricsBuffer;
    buf.intents_total += 1;
    if (metric.success !== false) {
      buf.intents_succeeded += 1;
    } else {
      buf.intents_failed += 1;
    }
    if (metric.latencyMs !== undefined) {
      const count = buf.intents_total;
      const prevAvg = buf.avg_latency_ms ?? 0;
      buf.avg_latency_ms = prevAvg + (metric.latencyMs - prevAvg) / count;
    }
    if (metric.costUsd !== undefined) {
      buf.cost_usd += metric.costUsd;
    }
  }

  private flushMetrics(): Record<string, unknown> | null {
    const buf = this.metricsBuffer;
    if (buf.intents_total === 0) return null;
    const metrics = { ...buf };
    this.metricsBuffer = { intents_total: 0, intents_succeeded: 0, intents_failed: 0, avg_latency_ms: null, cost_usd: 0 };
    return metrics;
  }

  // ── Agent management ─────────────────────────────────────────────

  async listAgents(options: ListAgentsOptions = {}): Promise<MeshAgentsResponse> {
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", String(options.limit));
    if (options.health) params.set("health", options.health);
    if (options.window) params.set("window", options.window);
    const qs = params.toString();
    return this.client["requestJson"](`/v1/mesh/agents${qs ? `?${qs}` : ""}`, {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    }) as Promise<MeshAgentsResponse>;
  }

  async getAgent(addressId: string, options?: { traceId?: string }): Promise<Record<string, unknown>> {
    return this.client["requestJson"](`/v1/mesh/agents/${addressId}`, {
      method: "GET",
      retryable: true,
      traceId: options?.traceId,
    });
  }

  async kill(addressId: string, options?: { traceId?: string }): Promise<Record<string, unknown>> {
    return this.client["requestJson"](`/v1/mesh/agents/${addressId}/kill`, {
      method: "POST",
      retryable: false,
      traceId: options?.traceId,
    });
  }

  async resume(addressId: string, options?: { traceId?: string }): Promise<Record<string, unknown>> {
    return this.client["requestJson"](`/v1/mesh/agents/${addressId}/resume`, {
      method: "POST",
      retryable: false,
      traceId: options?.traceId,
    });
  }

  async listEvents(options: ListEventsOptions = {}): Promise<{ ok: boolean; events: MeshEvent[] }> {
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", String(options.limit));
    if (options.eventType) params.set("event_type", options.eventType);
    const qs = params.toString();
    return this.client["requestJson"](`/v1/mesh/events${qs ? `?${qs}` : ""}`, {
      method: "GET",
      retryable: true,
      traceId: options.traceId,
    }) as Promise<{ ok: boolean; events: MeshEvent[] }>;
  }
}
