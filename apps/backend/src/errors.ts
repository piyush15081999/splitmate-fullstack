export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly retryAfter = 900) { super(message); }
}
