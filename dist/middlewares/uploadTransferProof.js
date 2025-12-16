// src/middlewares/uploadTransferProof.ts
import multer from 'multer';
import { BILLING_CONFIG } from '../config/billing.config.js';
import { ApiError } from './errorHandler.js';
import { StatusCodes } from 'http-status-codes';
const maxBytes = BILLING_CONFIG.UPLOAD_MAX_MB * 1024 * 1024;
export const uploadTransferProof = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes },
    fileFilter: (_req, file, cb) => {
        if (!BILLING_CONFIG.UPLOAD_ALLOWED_MIME.includes(file.mimetype)) {
            return cb(new ApiError(StatusCodes.BAD_REQUEST, `Tipo inválido. Permitidos: ${BILLING_CONFIG.UPLOAD_ALLOWED_MIME.join(', ')}`));
        }
        cb(null, true);
    }
});
