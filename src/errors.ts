export class AxmeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AxmeError";
  }
}

export class AxmeHttpError extends AxmeError {
  readonly statusCode: number;
  readonly body?: unknown;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly retryAfter?: number;

  constructor(
    statusCode: number,
    message: string,
    options: {
      body?: unknown;
      requestId?: string;
      traceId?: string;
      retryAfter?: number;
    } = {},
  ) {
    super(`HTTP ${statusCode}: ${message}`);
    this.name = "AxmeHttpError";
    this.statusCode = statusCode;
    this.body = options.body;
    this.requestId = options.requestId;
    this.traceId = options.traceId;
    this.retryAfter = options.retryAfter;
  }
}

export class AxmeAuthError extends AxmeHttpError {
  constructor(statusCode: number, message: string, options: ConstructorParameters<typeof AxmeHttpError>[2] = {}) {
    super(statusCode, message, options);
    this.name = "AxmeAuthError";
  }
}

export class AxmeValidationError extends AxmeHttpError {
  constructor(statusCode: number, message: string, options: ConstructorParameters<typeof AxmeHttpError>[2] = {}) {
    super(statusCode, message, options);
    this.name = "AxmeValidationError";
  }
}

export class AxmeRateLimitError extends AxmeHttpError {
  constructor(statusCode: number, message: string, options: ConstructorParameters<typeof AxmeHttpError>[2] = {}) {
    super(statusCode, message, options);
    this.name = "AxmeRateLimitError";
  }
}

export class AxmeServerError extends AxmeHttpError {
  constructor(statusCode: number, message: string, options: ConstructorParameters<typeof AxmeHttpError>[2] = {}) {
    super(statusCode, message, options);
    this.name = "AxmeServerError";
  }
}
