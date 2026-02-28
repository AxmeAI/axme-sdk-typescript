import { AxmeHttpError } from "./errors.js";

export type AxmeClientConfig = {
  baseUrl: string;
  apiKey: string;
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

  async createIntent(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/intents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return parseJsonResponse(response);
  }
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw new AxmeHttpError(response.status, await response.text());
  }
  return (await response.json()) as Record<string, unknown>;
}
