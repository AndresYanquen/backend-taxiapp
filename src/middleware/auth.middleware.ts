
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { httpErrors } from '../utils/httpErrors';

// Extendemos la interfaz Request de Express para añadir nuestra propia propiedad `user`
interface AuthenticatedRequest extends Request {
    user?: { id: string; role: string; };
}

// Creamos un middleware que puede proteger rutas y opcionalmente requerir roles específicos
export const protect = (roles?: ('user' | 'driver')[]) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        let token;

        // Buscamos el token en la cabecera de autorización
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            try {
                // Extraemos el token del formato "Bearer <TOKEN>"
                token = req.headers.authorization.split(' ')[1];

                // Verificamos y decodificamos el token
                const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { id: string; role: string; };

                // Comprobamos si el rol del token está permitido para esta ruta
                if (roles && !roles.includes(decoded.role as 'user' | 'driver')) {
                    next(
                        httpErrors.forbidden('No tienes permiso para realizar esta acción.', {
                            requiredRoles: roles,
                            currentRole: decoded.role,
                        })
                    );
                    return;
                }

                // Adjuntamos los datos del usuario a la petición para usarlo en las rutas
                req.user = decoded;
                next(); // El token es válido y el rol es correcto, continuamos

            } catch (error) {
                next(
                    httpErrors.unauthorized('Token no válido o expirado.', {
                        reason: error instanceof Error ? error.message : String(error),
                    })
                );
                return;
            }
        }

        if (!token) {
            next(httpErrors.unauthorized('No autorizado, no se encontró un token.'));
            return;
        }
    };
};
