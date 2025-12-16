import { ApiError } from './errorHandler.js';
import { StatusCodes } from 'http-status-codes';
export function requireRoles(...roles) {
    return (req, _res, next) => {
        const user = req.user;
        if (!user)
            return next(new ApiError(StatusCodes.UNAUTHORIZED, 'No autenticado'));
        if (!roles.includes(user.role)) {
            return next(new ApiError(StatusCodes.FORBIDDEN, 'No autorizado'));
        }
        next();
    };
}
