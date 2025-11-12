"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asHttpError = exports.HttpError = void 0;
/**
 * Lightweight HTTP error with consistent shape for centralized handling.
 */
class HttpError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = 'HttpError';
        this.statusCode = options.statusCode ?? 500;
        this.details = options.details;
        this.cause = options.cause;
        Error.captureStackTrace?.(this, HttpError);
    }
}
exports.HttpError = HttpError;
const asHttpError = (err) => {
    if (err instanceof HttpError) {
        return err;
    }
    if (err instanceof Error) {
        return new HttpError(err.message, { statusCode: 500, cause: err });
    }
    return new HttpError('Internal server error');
};
exports.asHttpError = asHttpError;
//# sourceMappingURL=httpError.js.map