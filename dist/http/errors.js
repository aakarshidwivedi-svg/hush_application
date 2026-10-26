import { ZodError } from 'zod';
export class AppError extends Error {
    status;
    code;
    details;
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
        this.name = 'AppError';
    }
}
export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);
export const forbidden = (code, message) => new AppError(403, code, message);
export const conflict = (code, message) => new AppError(409, code, message);
export const validation = (message, details) => new AppError(422, 'VALIDATION_ERROR', message, details);
/** Express 4 does not catch rejected promises; this wrapper forwards them to the error handler. */
export const asyncHandler = (fn) => (req, res, next) => {
    fn(req, res, next).catch(next);
};
export const notFoundHandler = (_req, _res, next) => next(notFound('Route not found'));
export function errorHandler(logger) {
    return (err, req, res, _next) => {
        const requestId = req.id;
        if (err instanceof AppError) {
            res.status(err.status).json({
                error: { code: err.code, message: err.message, details: err.details, requestId },
            });
            return;
        }
        if (err instanceof ZodError) {
            res.status(422).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Request validation failed',
                    details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
                    requestId,
                },
            });
            return;
        }
        const type = err?.type;
        if (type === 'entity.parse.failed') {
            res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON', requestId } });
            return;
        }
        if (type === 'entity.too.large') {
            res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large', requestId } });
            return;
        }
        // Log the failure without request bodies or headers; never leak internals to the client.
        const e = err;
        logger.error({ err: { name: e?.name, message: e?.message, code: e?.code, stack: e?.stack }, requestId, method: req.method, path: req.path }, 'unhandled error');
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId } });
    };
}
