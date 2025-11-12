"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.notFoundHandler = void 0;
const crypto_1 = require("crypto");
const httpError_1 = require("../utils/httpError");
const httpErrors_1 = require("../utils/httpErrors");
const notFoundHandler = (req, _res, next) => {
    next(httpErrors_1.httpErrors.notFound('Resource not found', { method: req.method, path: req.originalUrl }));
};
exports.notFoundHandler = notFoundHandler;
const errorHandler = (err, req, res, _next) => {
    const httpError = (0, httpError_1.asHttpError)(err);
    const errorId = (0, crypto_1.randomUUID)();
    const status = httpError.statusCode ?? 500;
    console.error(`[${errorId}] ${req.method} ${req.originalUrl} -> ${status} ${httpError.message}`, {
        user: req.user,
        params: req.params,
        query: req.query,
        bodyKeys: Object.keys(req.body ?? {}),
        details: httpError.details,
        stack: httpError.stack,
    });
    res.status(status).json({
        error: httpError.message,
        detalle: httpError.details ?? null,
        errorId,
    });
};
exports.errorHandler = errorHandler;
//# sourceMappingURL=error.middleware.js.map