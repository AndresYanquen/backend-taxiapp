import { HttpError } from './httpError';

type Details = unknown;

type ErrorFactory = (message: string, details?: Details, cause?: unknown) => HttpError;

const buildErrorFactory = (statusCode: number): ErrorFactory => {
  return (message, details, cause) => new HttpError(message, { statusCode, details, cause });
};

export const httpErrors = {
  badRequest: buildErrorFactory(400),
  unauthorized: buildErrorFactory(401),
  forbidden: buildErrorFactory(403),
  notFound: buildErrorFactory(404),
  conflict: buildErrorFactory(409),
  unprocessableEntity: buildErrorFactory(422),
  internal: buildErrorFactory(500),
  fromStatus: (statusCode: number) => buildErrorFactory(statusCode),
};

export type HttpErrorFactory = typeof httpErrors;
