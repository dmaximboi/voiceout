export class HttpError extends Error {
  statusCode: number;
  extra: Record<string, unknown>;

  constructor(statusCode: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.statusCode = statusCode;
    this.extra = extra;
  }
}

export function httpError(statusCode: number, message: string, extra: Record<string, unknown> = {}) {
  return new HttpError(statusCode, message, extra);
}
