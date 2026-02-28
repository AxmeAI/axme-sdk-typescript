export class AxmeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AxmeError";
  }
}

export class AxmeHttpError extends AxmeError {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(`HTTP ${statusCode}: ${message}`);
    this.name = "AxmeHttpError";
    this.statusCode = statusCode;
  }
}
