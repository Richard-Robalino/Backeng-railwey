import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/requireRole.js';
import { ROLES } from '../../constants/roles.js';
import { requestTransferPayment, confirmTransferPayment, uploadTransferProof, getTransferProofByBooking, listTransferProofs, listMyTransferProofs } from './payments.controller.js';
import { uploadTransferProof as uploadMw } from '../../middlewares/uploadTransferProof.js';
const router = Router();
router.use(authenticate);
// Orden de pago transferencia
router.post('/booking/:id/transfer-request', requireRoles(ROLES.CLIENTE, ROLES.ADMIN, ROLES.GERENTE), requestTransferPayment);
// ✅ Subir comprobante (multipart/form-data, campo: file)
router.post('/booking/:id/transfer-proof', requireRoles(ROLES.CLIENTE, ROLES.ADMIN, ROLES.GERENTE), uploadMw.single('file'), uploadTransferProof);
// ✅ Ver comprobante por booking (cliente dueño o admin/gerente)
router.get('/booking/:id/transfer-proof', requireRoles(ROLES.CLIENTE, ROLES.ADMIN, ROLES.GERENTE), getTransferProofByBooking);
// ✅ Listar comprobantes por cliente (admin/gerente) + opcional clientId
router.get('/transfer-proofs', requireRoles(ROLES.ADMIN, ROLES.GERENTE), listTransferProofs);
// ✅ Listar mis comprobantes (cliente)
router.get('/transfer-proofs/me', requireRoles(ROLES.CLIENTE), listMyTransferProofs);
// Confirmar transferencia (obliga comprobante)
router.post('/booking/:id/confirm-transfer', requireRoles(ROLES.ADMIN, ROLES.GERENTE), confirmTransferPayment);
export default router;
