import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { HttpError, asHttpError } from '../utils/httpError';
import { httpErrors } from '../utils/httpErrors';

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction) => {
  next(httpErrors.notFound('Resource not found', { method: req.method, path: req.originalUrl }));
};

export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const httpError = asHttpError(err);
  const errorId = randomUUID();
  const status = httpError.statusCode ?? 500;

  console.error(
    `[${errorId}] ${req.method} ${req.originalUrl} -> ${status} ${httpError.message}`,
    {
      user: (req as Request & { user?: { id: string; role: string } }).user,
      params: req.params,
      query: req.query,
      bodyKeys: Object.keys(req.body ?? {}),
      details: httpError.details,
      stack: httpError.stack,
    }
  );

  res.status(status).json({
    error: httpError.message,
    errorId,
  });
};
