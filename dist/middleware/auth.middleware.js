"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.protect = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const httpErrors_1 = require("../utils/httpErrors");
// Creamos un middleware que puede proteger rutas y opcionalmente requerir roles específicos
const protect = (roles) => {
    return (req, res, next) => {
        let token;
        // Buscamos el token en la cabecera de autorización
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            try {
                // Extraemos el token del formato "Bearer <TOKEN>"
                token = req.headers.authorization.split(' ')[1];
                // Verificamos y decodificamos el token
                const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
                // Comprobamos si el rol del token está permitido para esta ruta
                if (roles && !roles.includes(decoded.role)) {
                    next(httpErrors_1.httpErrors.forbidden('No tienes permiso para realizar esta acción.', {
                        requiredRoles: roles,
                        currentRole: decoded.role,
                    }));
                    return;
                }
                // Adjuntamos los datos del usuario a la petición para usarlo en las rutas
                req.user = decoded;
                next(); // El token es válido y el rol es correcto, continuamos
            }
            catch (error) {
                next(httpErrors_1.httpErrors.unauthorized('Token no válido o expirado.', {
                    reason: error instanceof Error ? error.message : String(error),
                }));
                return;
            }
        }
        if (!token) {
            next(httpErrors_1.httpErrors.unauthorized('No autorizado, no se encontró un token.'));
            return;
        }
    };
};
exports.protect = protect;
//# sourceMappingURL=auth.middleware.js.map