"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.httpErrors = void 0;
const httpError_1 = require("./httpError");
const buildErrorFactory = (statusCode) => {
    return (message, details, cause) => new httpError_1.HttpError(message, { statusCode, details, cause });
};
exports.httpErrors = {
    badRequest: buildErrorFactory(400),
    unauthorized: buildErrorFactory(401),
    forbidden: buildErrorFactory(403),
    notFound: buildErrorFactory(404),
    conflict: buildErrorFactory(409),
    unprocessableEntity: buildErrorFactory(422),
    internal: buildErrorFactory(500),
    fromStatus: (statusCode) => buildErrorFactory(statusCode),
};
//# sourceMappingURL=httpErrors.js.map