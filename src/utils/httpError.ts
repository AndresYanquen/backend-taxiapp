export interface HttpErrorOptions {
  statusCode?: number;
  details?: unknown;
  cause?: unknown;
}

/**
 * Lightweight HTTP error with consistent shape for centralized handling.
 */
export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly cause?: unknown;

  constructor(message: string, options: HttpErrorOptions = {}) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = options.statusCode ?? 500;
    this.details = options.details;
    this.cause = options.cause;

    Error.captureStackTrace?.(this, HttpError);
  }
}

export const asHttpError = (err: unknown): HttpError => {
  if (err instanceof HttpError) {
    return err;
  }

  if (err instanceof Error) {
    return new HttpError(err.message, { statusCode: 500, cause: err });
  }

  return new HttpError('Internal server error');
};
