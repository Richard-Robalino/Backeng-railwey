import { StatusCodes, getReasonPhrase } from 'http-status-codes';
export class ApiError extends Error {
    constructor(statusCode, message, details) {
        super(message ?? getReasonPhrase(statusCode));
        this.statusCode = statusCode;
        this.details = details;
    }
}
export function notFoundHandler(_req, _res, next) {
    next(new ApiError(StatusCodes.NOT_FOUND, 'Recurso no encontrado'));
}
export function errorHandler(err, _req, res, _next) {
    const status = err.statusCode ?? StatusCodes.INTERNAL_SERVER_ERROR;
    const payload = {
        name: err.name,
        message: err.message ?? 'Error interno',
    };
    if (err.details)
        payload.details = err.details;
    if (process.env.NODE_ENV !== 'production' && err.stack)
        payload.stack = err.stack;
    res.status(status).json(payload);
}
