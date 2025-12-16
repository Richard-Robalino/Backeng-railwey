import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/requireRole.js';
import { ROLES } from '../../constants/roles.js';
import { validateQuery } from '../../middlewares/validate.js';
import { summaryReports, revenueReport, stylistRevenueReport, downloadReportsPdf, stylistsReport, downloadStylistsReportPdf, 
// ✅ NUEVOS para estilista logueado
myStylistReport, downloadMyStylistReportPdf } from './reports.controller.js';
import { reportsRangeQuery } from './reports.schemas.js';
const router = Router();
// ✅ Todos deben estar autenticados
router.use(authenticate);
// ------------------- SOLO ADMIN / GERENTE -------------------
// Resumen completo (JSON)
router.get('/summary', requireRoles(ROLES.ADMIN, ROLES.GERENTE), validateQuery(reportsRangeQuery), summaryReports);
// Ingresos del local (JSON)
router.get('/revenue', requireRoles(ROLES.ADMIN, ROLES.GERENTE), validateQuery(reportsRangeQuery), revenueReport);
// Ingresos por estilista (JSON)
router.get('/stylists-revenue', requireRoles(ROLES.ADMIN, ROLES.GERENTE), validateQuery(reportsRangeQuery), stylistRevenueReport);
// PDF general del local
router.get('/pdf', requireRoles(ROLES.ADMIN, ROLES.GERENTE), validateQuery(reportsRangeQuery), downloadReportsPdf);
// ------------------- ADMIN/GERENTE + ESTILISTA (pero estilista solo ve el suyo) -------------------
// Reporte por estilistas (JSON)
router.get('/stylists', requireRoles(ROLES.ADMIN, ROLES.GERENTE, ROLES.ESTILISTA), validateQuery(reportsRangeQuery), stylistsReport);
// PDF por estilistas
router.get('/stylists/pdf', requireRoles(ROLES.ADMIN, ROLES.GERENTE, ROLES.ESTILISTA), validateQuery(reportsRangeQuery), downloadStylistsReportPdf);
// ------------------- SOLO ESTILISTA (más fácil de usar) -------------------
router.get('/my', requireRoles(ROLES.ESTILISTA), validateQuery(reportsRangeQuery), myStylistReport);
router.get('/my/pdf', requireRoles(ROLES.ESTILISTA), validateQuery(reportsRangeQuery), downloadMyStylistReportPdf);
export default router;
