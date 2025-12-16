import { ApiError } from './errorHandler.js';
import { StatusCodes } from 'http-status-codes';
export function validateBody(schema) {
    return (req, _res, next) => {
        const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
        if (error) {
            return next(new ApiError(StatusCodes.BAD_REQUEST, 'Datos inválidos', error.details));
        }
        req.body = value;
        next();
    };
}
export function validateQuery(schema) {
    return (req, _res, next) => {
        const { error, value } = schema.validate(req.query, { abortEarly: false, stripUnknown: true });
        if (error) {
            return next(new ApiError(StatusCodes.BAD_REQUEST, 'Parámetros inválidos', error.details));
        }
        req.query = value;
        next();
    };
}
