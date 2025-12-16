import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import PDFDocument from 'pdfkit';
import { StatusCodes } from 'http-status-codes';

import { BookingModel } from '../../models/Booking.js';
import { RatingModel } from '../../models/Rating.js';
import { PaymentModel } from '../../models/Payment.js';
import { ApiError } from '../../middlewares/errorHandler.js';
import { BOOKING_STATUS } from '../../constants/statuses.js';
import { ROLES } from '../../constants/roles.js';
import { dayjs } from '../../utils/time.js';

// ================== FECHAS ECUADOR ==================
const TZ = 'America/Guayaquil';

function isDateOnly(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseEcStart(input: string): Date {
  const v = String(input);
  if (isDateOnly(v)) return dayjs.tz(v, 'YYYY-MM-DD', TZ).startOf('day').toDate();
  const d = dayjs(v);
  if (!d.isValid()) return new Date(''); // inválida
  return d.tz(TZ).toDate();
}

function parseEcEnd(input: string): Date {
  const v = String(input);
  if (isDateOnly(v)) return dayjs.tz(v, 'YYYY-MM-DD', TZ).endOf('day').toDate();
  const d = dayjs(v);
  if (!d.isValid()) return new Date('');
  return d.tz(TZ).toDate();
}

function normalizeFromTo(from: string, to: string) {
  const start = parseEcStart(from);
  const end = parseEcEnd(to);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'from/to inválidos. Usa YYYY-MM-DD');
  }
  if (end < start) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'to no puede ser menor que from');
  }

  const label = `${dayjs(start).tz(TZ).format('YYYY-MM-DD')} - ${dayjs(end).tz(TZ).format('YYYY-MM-DD')}`;
  return { start, end, label };
}

function formatNowEC() {
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: TZ,
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date());
}

// ================== AGREGACIONES BASE (LOCAL) ==================

// Ingresos del local agrupados por día (dentro del rango)
async function aggregateRevenueByDay(start: Date, end: Date) {
  const pipeline: any[] = [
    {
      $addFields: {
        reportDate: { $ifNull: ['$fecha', '$createdAt'] },
        reportAmount: { $ifNull: ['$amount', '$monto'] }
      }
    },
    { $match: { status: 'PAID', reportDate: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$reportDate', timezone: TZ }
        },
        total: { $sum: '$reportAmount' },
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ];

  const rows = await PaymentModel.aggregate(pipeline);
  return rows.map(r => ({ day: r._id, total: r.total, count: r.count }));
}

// Ingresos por estilista (pagos PAID) en rango
async function aggregateRevenueByStylist(start: Date, end: Date) {
  const pipeline: any[] = [
    {
      $addFields: {
        reportDate: { $ifNull: ['$fecha', '$createdAt'] },
        reportAmount: { $ifNull: ['$amount', '$monto'] }
      }
    },
    { $match: { status: 'PAID', reportDate: { $gte: start, $lte: end } } },
    { $lookup: { from: 'bookings', localField: 'bookingId', foreignField: '_id', as: 'booking' } },
    { $unwind: '$booking' },
    { $lookup: { from: 'users', localField: 'booking.estilistaId', foreignField: '_id', as: 'stylist' } },
    { $unwind: '$stylist' },
    {
      $group: {
        _id: '$stylist._id',
        stylistName: {
          $first: {
            $trim: {
              input: {
                $concat: ['$stylist.nombre', ' ', { $ifNull: ['$stylist.apellido', ''] }]
              }
            }
          }
        },
        totalRevenue: { $sum: '$reportAmount' },
        bookingsCount: { $sum: 1 }
      }
    },
    { $sort: { totalRevenue: -1 } }
  ];

  return PaymentModel.aggregate(pipeline);
}

// Top servicios más vendidos por ingresos (rango)
async function aggregateTopServices(start: Date, end: Date) {
  const pipeline: any[] = [
    {
      $addFields: {
        reportDate: { $ifNull: ['$fecha', '$createdAt'] },
        reportAmount: { $ifNull: ['$amount', '$monto'] }
      }
    },
    { $match: { status: 'PAID', reportDate: { $gte: start, $lte: end } } },
    { $lookup: { from: 'bookings', localField: 'bookingId', foreignField: '_id', as: 'booking' } },
    { $unwind: '$booking' },
    { $lookup: { from: 'services', localField: 'booking.servicioId', foreignField: '_id', as: 'service' } },
    { $unwind: '$service' },
    {
      $group: {
        _id: '$service._id',
        serviceName: { $first: '$service.nombre' },
        totalRevenue: { $sum: '$reportAmount' },
        bookingsCount: { $sum: 1 }
      }
    },
    { $sort: { totalRevenue: -1 } },
    { $limit: 10 }
  ];

  return PaymentModel.aggregate(pipeline);
}

// Citas por estado en rango
async function aggregateBookingsByStatus(start: Date, end: Date) {
  const pipeline: any[] = [
    { $match: { inicio: { $gte: start, $lte: end } } },
    { $group: { _id: '$estado', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ];
  return BookingModel.aggregate(pipeline);
}

// Rating por estilista (promedio) en rango
async function aggregateRatingsByStylist(start: Date, end: Date) {
  const pipeline: any[] = [
    { $match: { createdAt: { $gte: start, $lte: end } } },
    { $lookup: { from: 'users', localField: 'estilistaId', foreignField: '_id', as: 'stylist' } },
    { $unwind: '$stylist' },
    {
      $group: {
        _id: '$stylist._id',
        stylistName: {
          $first: {
            $trim: { input: { $concat: ['$stylist.nombre', ' ', { $ifNull: ['$stylist.apellido', ''] }] } }
          }
        },
        avgRating: { $avg: '$estrellas' },
        ratingsCount: { $sum: 1 }
      }
    },
    { $sort: { avgRating: -1 } }
  ];
  return RatingModel.aggregate(pipeline);
}

// ================== AGREGACIONES POR ESTILISTA (DETALLE) ==================

async function aggregatePaidRevenueForStylist(stylistId: string, start: Date, end: Date) {
  const sid = new Types.ObjectId(stylistId);

  const pipeline: any[] = [
    {
      $addFields: {
        reportDate: { $ifNull: ['$fecha', '$createdAt'] },
        reportAmount: { $ifNull: ['$amount', '$monto'] }
      }
    },
    { $match: { status: 'PAID', reportDate: { $gte: start, $lte: end } } },
    { $lookup: { from: 'bookings', localField: 'bookingId', foreignField: '_id', as: 'booking' } },
    { $unwind: '$booking' },
    { $match: { 'booking.estilistaId': sid } },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$reportAmount' },
        paidBookings: { $sum: 1 }
      }
    }
  ];

  const rows = await PaymentModel.aggregate(pipeline);
  return {
    totalRevenue: rows?.[0]?.totalRevenue ?? 0,
    paidBookings: rows?.[0]?.paidBookings ?? 0
  };
}

async function aggregateBookingStatsForStylist(stylistId: string, start: Date, end: Date) {
  const match: any = { estilistaId: new Types.ObjectId(stylistId), inicio: { $gte: start, $lte: end } };

  const pipeline: any[] = [
    { $match: match },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$estado', count: { $sum: 1 } } }],
        uniqueClients: [{ $group: { _id: '$clienteId' } }, { $count: 'count' }]
      }
    }
  ];

  const [row] = await BookingModel.aggregate(pipeline);
  return {
    byStatus: row?.byStatus ?? [],
    uniqueClients: row?.uniqueClients?.[0]?.count ?? 0
  };
}

async function aggregateRatingsDetailForStylist(stylistId: string, start: Date, end: Date) {
  const match: any = { estilistaId: new Types.ObjectId(stylistId), createdAt: { $gte: start, $lte: end } };

  const [summary] = await RatingModel.aggregate([
    { $match: match },
    { $group: { _id: null, avgRating: { $avg: '$estrellas' }, ratingsCount: { $sum: 1 } } }
  ]);

  const dist = await RatingModel.aggregate([
    { $match: match },
    { $group: { _id: '$estrellas', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);

  const comments = await RatingModel.aggregate([
    { $match: match },
    { $addFields: { commentText: { $ifNull: ['$comentario', { $ifNull: ['$comment', ''] }] } } },
    { $match: { commentText: { $type: 'string', $ne: '' } } },
    { $sort: { createdAt: -1 } },
    { $limit: 10 },
    { $lookup: { from: 'users', localField: 'clienteId', foreignField: '_id', as: 'client' } },
    { $unwind: { path: '$client', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        estrellas: 1,
        commentText: 1,
        createdAt: 1,
        clientName: {
          $trim: { input: { $concat: ['$client.nombre', ' ', { $ifNull: ['$client.apellido', ''] }] } }
        }
      }
    }
  ]);

  return {
    avgRating: summary?.avgRating ?? 0,
    ratingsCount: summary?.ratingsCount ?? 0,
    distribution: dist.map((d: any) => ({ stars: d._id, count: d.count })),
    latestComments: comments
  };
}

async function aggregateTopServicesForStylist(stylistId: string, start: Date, end: Date) {
  const sid = new Types.ObjectId(stylistId);

  const pipeline: any[] = [
    {
      $addFields: {
        reportDate: { $ifNull: ['$fecha', '$createdAt'] },
        reportAmount: { $ifNull: ['$amount', '$monto'] }
      }
    },
    { $match: { status: 'PAID', reportDate: { $gte: start, $lte: end } } },
    { $lookup: { from: 'bookings', localField: 'bookingId', foreignField: '_id', as: 'booking' } },
    { $unwind: '$booking' },
    { $match: { 'booking.estilistaId': sid } },
    { $lookup: { from: 'services', localField: 'booking.servicioId', foreignField: '_id', as: 'service' } },
    { $unwind: '$service' },
    {
      $group: {
        _id: '$service._id',
        serviceName: { $first: '$service.nombre' },
        totalRevenue: { $sum: '$reportAmount' },
        bookingsCount: { $sum: 1 }
      }
    },
    { $sort: { totalRevenue: -1 } },
    { $limit: 10 }
  ];

  return PaymentModel.aggregate(pipeline);
}

// “Comentarios de citas”: notas recientes en bookings del estilista
async function findLatestBookingNotesForStylist(stylistId: string, start: Date, end: Date) {
  const match: any = {
    estilistaId: new Types.ObjectId(stylistId),
    inicio: { $gte: start, $lte: end },
    notas: { $exists: true, $type: 'string', $ne: '' }
  };

  const rows = await BookingModel.find(match)
    .sort({ inicio: -1 })
    .limit(10)
    .populate('clienteId', 'nombre apellido')
    .populate('servicioId', 'nombre')
    .select('inicio estado notas clienteId servicioId');

  return rows.map((b: any) => ({
    date: b.inicio,
    estado: b.estado,
    servicio: b.servicioId?.nombre ?? 'Servicio',
    cliente: b.clienteId ? `${b.clienteId.nombre} ${b.clienteId.apellido ?? ''}`.trim() : 'Cliente',
    notas: b.notas
  }));
}

// EXTRA “algo más”: hora pico y día pico
async function aggregatePeakForStylist(stylistId: string, start: Date, end: Date) {
  const sid = new Types.ObjectId(stylistId);

  const [row] = await BookingModel.aggregate([
    { $match: { estilistaId: sid, inicio: { $gte: start, $lte: end } } },
    {
      $facet: {
        byHour: [
          { $project: { h: { $hour: { date: '$inicio', timezone: TZ } } } },
          { $group: { _id: '$h', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 1 }
        ],
        byDow: [
          { $project: { d: { $dayOfWeek: { date: '$inicio', timezone: TZ } } } }, // 1..7
          { $group: { _id: '$d', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 1 }
        ]
      }
    }
  ]);

  const WEEKDAYS = ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'];

  const peakHour = row?.byHour?.[0]?._id;
  const peakDow = row?.byDow?.[0]?._id; // 1..7 (1=Dom)
  return {
    peakHour: typeof peakHour === 'number' ? `${String(peakHour).padStart(2, '0')}:00` : null,
    peakWeekday: typeof peakDow === 'number' ? WEEKDAYS[peakDow - 1] : null
  };
}

// ================== ENDPOINTS JSON ==================

export async function summaryReports(req: Request, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query as any;
    const { start, end, label } = normalizeFromTo(String(from), String(to));

    const [
      revenueByDay,
      revenueByStylist,
      topServices,
      bookingsByStatus,
      ratingsByStylist
    ] = await Promise.all([
      aggregateRevenueByDay(start, end),
      aggregateRevenueByStylist(start, end),
      aggregateTopServices(start, end),
      aggregateBookingsByStatus(start, end),
      aggregateRatingsByStylist(start, end)
    ]);

    const totalRevenue = revenueByDay.reduce((acc, r) => acc + (r.total || 0), 0);
    const totalPaidBookings = revenueByStylist.reduce((acc, r: any) => acc + (r.bookingsCount || 0), 0);

    res.json({
      range: { from: start, to: end, label },
      totals: {
        totalRevenue,
        totalPaidBookings
      },
      revenueByDay,
      revenueByStylist,
      topServices,
      bookingsByStatus,
      ratingsByStylist
    });
  } catch (err) { next(err); }
}

export async function revenueReport(req: Request, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query as any;
    const { start, end, label } = normalizeFromTo(String(from), String(to));

    const revenueByDay = await aggregateRevenueByDay(start, end);
    res.json({ range: { from: start, to: end, label }, revenueByDay });
  } catch (err) { next(err); }
}

export async function stylistRevenueReport(req: Request, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query as any;
    const { start, end, label } = normalizeFromTo(String(from), String(to));

    const revenueByStylist = await aggregateRevenueByStylist(start, end);
    res.json({ range: { from: start, to: end, label }, revenueByStylist });
  } catch (err) { next(err); }
}

// ✅ NUEVO: Reporte por estilistas (1 o todos)
export async function stylistsReport(req: Request, res: Response, next: NextFunction) {
  try {
    const { from, to, stylistId } = req.query as any;
    const { start, end, label } = normalizeFromTo(String(from), String(to));

    const userFilter: any = { role: ROLES.ESTILISTA };
    if (stylistId) userFilter._id = new Types.ObjectId(String(stylistId));

    // OJO: tu proyecto ya tiene UserModel, pero aquí usamos lookup con colección users en agregaciones
    // Para el listado, si no quieres traer UserModel, puedes quitar esto y hacerlo por agregaciones.
    const stylists = await (await import('../../models/User.js')).UserModel
      .find(userFilter)
      .select('nombre apellido email isActive')
      .lean();

    if (stylistId && !stylists.length) throw new ApiError(StatusCodes.NOT_FOUND, 'Estilista no encontrado');

    const reports = await Promise.all(
      stylists.map(async (s: any) => {
        const id = String(s._id);

        const [paid, stats, ratings, topServices, notes, peak] = await Promise.all([
          aggregatePaidRevenueForStylist(id, start, end),
          aggregateBookingStatsForStylist(id, start, end),
          aggregateRatingsDetailForStylist(id, start, end),
          aggregateTopServicesForStylist(id, start, end),
          findLatestBookingNotesForStylist(id, start, end),
          aggregatePeakForStylist(id, start, end)
        ]);

        const byStatus = stats.byStatus as any[];
        const totalBookings = byStatus.reduce((a, r) => a + (r.count || 0), 0);

        const cancelled = (byStatus.find(r => r._id === BOOKING_STATUS.CANCELLED)?.count ?? 0);
        const noShow = (byStatus.find(r => r._id === BOOKING_STATUS.NO_SHOW)?.count ?? 0);
        const completed = (byStatus.find(r => r._id === BOOKING_STATUS.COMPLETED)?.count ?? 0);

        const avgTicket = paid.paidBookings > 0 ? paid.totalRevenue / paid.paidBookings : 0;
        const cancelRate = totalBookings > 0 ? ((cancelled + noShow) / totalBookings) * 100 : 0;
        const completionRate = totalBookings > 0 ? (completed / totalBookings) * 100 : 0;

        return {
          stylist: {
            id,
            name: `${s.nombre} ${s.apellido ?? ''}`.trim(),
            email: s.email ?? null,
            isActive: s.isActive ?? true
          },
          earnings: {
            totalRevenue: paid.totalRevenue,
            paidBookings: paid.paidBookings,
            avgTicket
          },
          ratings: {
            avgRating: ratings.avgRating,
            ratingsCount: ratings.ratingsCount,
            distribution: ratings.distribution,
            latestComments: ratings.latestComments
          },
          appointmentsNotes: notes,
          topServices,
          bookingsByStatus: byStatus,
          extra: {
            totalBookings,
            uniqueClients: stats.uniqueClients,
            cancelRatePct: cancelRate,
            completionRatePct: completionRate,
            peakHour: peak.peakHour,
            peakWeekday: peak.peakWeekday
          }
        };
      })
    );

    res.json({
      range: { from: start, to: end, label },
      count: reports.length,
      reports
    });
  } catch (err) { next(err); }
}

// ================== PDF HELPERS ==================

function drawBarChart(
  doc: any,
  title: string,
  data: { label: string; value: number }[],
  maxBars: number = 8
) {
  if (!data.length) {
    doc.fontSize(12).text(`${title}: sin datos`, { underline: true });
    doc.moveDown();
    return;
  }

  const sliced = data.slice(0, maxBars);

  doc.addPage();
  doc.fontSize(16).text(title, { underline: true });
  doc.moveDown();

  const chartLeft = 60;
  const chartTop = doc.y + 10;
  const chartWidth = 480;
  const chartHeight = 200;

  const maxValue = Math.max(...sliced.map(d => d.value), 1);
  const barWidth = chartWidth / sliced.length - 10;

  doc.moveTo(chartLeft, chartTop)
    .lineTo(chartLeft, chartTop + chartHeight)
    .stroke();

  doc.moveTo(chartLeft, chartTop + chartHeight)
    .lineTo(chartLeft + chartWidth, chartTop + chartHeight)
    .stroke();

  sliced.forEach((item, index) => {
    const barHeight = (item.value / maxValue) * chartHeight;
    const x = chartLeft + index * (barWidth + 10);
    const y = chartTop + chartHeight - barHeight;

    doc.rect(x, y, barWidth, barHeight).fillOpacity(0.4).fill();
    doc.fillOpacity(1);

    doc.fontSize(8).text(item.label, x, chartTop + chartHeight + 2, {
      width: barWidth,
      align: 'center'
    });

    doc.fontSize(9).text(item.value.toFixed(2), x, y - 12, {
      width: barWidth,
      align: 'center'
    });
  });

  doc.moveDown(4);
}

function drawPieLikeSummary(doc: any, title: string, data: { label: string; value: number }[]) {
  doc.addPage();
  doc.fontSize(16).text(title, { underline: true });
  doc.moveDown();

  const total = data.reduce((acc, d) => acc + d.value, 0) || 1;

  data.forEach(d => {
    const pct = (d.value / total) * 100;
    doc.fontSize(12).text(`• ${d.label}: ${d.value} (${pct.toFixed(1)}%)`);
  });

  doc.moveDown(2);
}

// ================== PDF GENERAL (LOCAL) ==================

export async function downloadReportsPdf(req: Request, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query as any;
    const { start, end, label } = normalizeFromTo(String(from), String(to));

    const [
      revenueByDay,
      revenueByStylist,
      topServices,
      bookingsByStatus,
      ratingsByStylist
    ] = await Promise.all([
      aggregateRevenueByDay(start, end),
      aggregateRevenueByStylist(start, end),
      aggregateTopServices(start, end),
      aggregateBookingsByStatus(start, end),
      aggregateRatingsByStylist(start, end)
    ]);

    const totalRevenue = revenueByDay.reduce((acc, r) => acc + (r.total || 0), 0);
    const totalPaidBookings = revenueByStylist.reduce((acc, r: any) => acc + (r.bookingsCount || 0), 0);

    const filename = `reporte-local-${Date.now()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);

    const shopName = process.env.INVOICE_SHOP_NAME || 'Mi Peluquería';

    doc.fontSize(22).text(`Reporte del local - ${shopName}`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text(`Rango: ${label}`, { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(12).text(`Generado: ${formatNowEC()}`, { align: 'center' });

    doc.addPage();
    doc.fontSize(18).text('Resumen general', { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(`Ingresos totales: $${totalRevenue.toFixed(2)}`);
    doc.fontSize(12).text(`Citas pagadas (según pagos): ${totalPaidBookings}`);
    doc.moveDown(2);

    doc.fontSize(14).text('Ingresos por día', { underline: true });
    doc.moveDown(0.5);
    revenueByDay.forEach(r => {
      doc.fontSize(11).text(`${r.day}: $${(r.total || 0).toFixed(2)} en ${r.count} pago(s)`);
    });

    doc.moveDown(2);
    doc.fontSize(14).text('Ingresos por estilista', { underline: true });
    doc.moveDown(0.5);
    (revenueByStylist as any[]).forEach(r => {
      doc.fontSize(11).text(`${r.stylistName}: $${(r.totalRevenue || 0).toFixed(2)} en ${r.bookingsCount} cita(s)`);
    });

    doc.moveDown(2);
    doc.fontSize(14).text('Top servicios por ingresos', { underline: true });
    doc.moveDown(0.5);
    (topServices as any[]).forEach(r => {
      doc.fontSize(11).text(`${r.serviceName}: $${(r.totalRevenue || 0).toFixed(2)} en ${r.bookingsCount} cita(s)`);
    });

    // Gráficos
    drawBarChart(
      doc,
      'Gráfico - Ingresos por día',
      revenueByDay.map(r => ({ label: String(r.day).slice(5), value: Number(r.total || 0) })),
      10
    );

    drawBarChart(
      doc,
      'Gráfico - Ingresos por estilista (Top 8)',
      (revenueByStylist as any[]).map(r => ({ label: r.stylistName, value: Number(r.totalRevenue || 0) })),
      8
    );

    drawPieLikeSummary(
      doc,
      'Distribución de citas por estado',
      (bookingsByStatus as any[]).map(r => ({ label: r._id || 'SIN_ESTADO', value: r.count }))
    );

    doc.addPage();
    doc.fontSize(16).text('Rating promedio por estilista', { underline: true });
    doc.moveDown();
    (ratingsByStylist as any[]).forEach(r => {
      doc.fontSize(11).text(`${r.stylistName}: ${Number(r.avgRating || 0).toFixed(2)} ⭐ (${r.ratingsCount} reseña(s))`);
    });

    doc.end();
  } catch (err) { next(err); }
}

// ================== PDF POR ESTILISTAS ==================

export async function downloadStylistsReportPdf(req: Request, res: Response, next: NextFunction) {
  try {
    const { from, to, stylistId } = req.query as any;
    const { start, end, label } = normalizeFromTo(String(from), String(to));

    const UserModel = (await import('../../models/User.js')).UserModel;

    const userFilter: any = { role: ROLES.ESTILISTA };
    if (stylistId) userFilter._id = new Types.ObjectId(String(stylistId));

    const stylists = await UserModel.find(userFilter).select('nombre apellido email isActive').lean();
    if (stylistId && !stylists.length) throw new ApiError(StatusCodes.NOT_FOUND, 'Estilista no encontrado');

    const reports = await Promise.all(
      stylists.map(async (s: any) => {
        const id = String(s._id);

        const [paid, stats, ratings, topServices, notes, peak] = await Promise.all([
          aggregatePaidRevenueForStylist(id, start, end),
          aggregateBookingStatsForStylist(id, start, end),
          aggregateRatingsDetailForStylist(id, start, end),
          aggregateTopServicesForStylist(id, start, end),
          findLatestBookingNotesForStylist(id, start, end),
          aggregatePeakForStylist(id, start, end)
        ]);

        const byStatus = stats.byStatus as any[];
        const totalBookings = byStatus.reduce((a, r) => a + (r.count || 0), 0);
        const cancelled = (byStatus.find(r => r._id === BOOKING_STATUS.CANCELLED)?.count ?? 0);
        const noShow = (byStatus.find(r => r._id === BOOKING_STATUS.NO_SHOW)?.count ?? 0);

        const avgTicket = paid.paidBookings > 0 ? paid.totalRevenue / paid.paidBookings : 0;
        const cancelRate = totalBookings > 0 ? ((cancelled + noShow) / totalBookings) * 100 : 0;

        return {
          stylist: {
            id,
            name: `${s.nombre} ${s.apellido ?? ''}`.trim(),
            email: s.email ?? null,
            isActive: s.isActive ?? true
          },
          paid,
          avgTicket,
          ratings,
          topServices,
          notes,
          byStatus,
          extra: {
            totalBookings,
            uniqueClients: stats.uniqueClients,
            cancelRatePct: cancelRate,
            peakHour: peak.peakHour,
            peakWeekday: peak.peakWeekday
          }
        };
      })
    );

    const filename = `reporte-estilistas-${Date.now()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);

    const shopName = process.env.INVOICE_SHOP_NAME || 'Mi Peluquería';

    // Portada
    doc.fontSize(22).text(`Reporte de estilistas - ${shopName}`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text(`Rango: ${label}`, { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(12).text(`Generado: ${formatNowEC()}`, { align: 'center' });

    // Página resumen
    doc.addPage();
    doc.fontSize(18).text('Resumen por estilista', { underline: true });
    doc.moveDown();

    const sorted = reports
      .slice()
      .sort((a, b) => (b.paid.totalRevenue || 0) - (a.paid.totalRevenue || 0));

    doc.fontSize(10).text(
      'Estilista | Ingresos | Citas pagadas | Ticket prom. | Rating | Reseñas | Clientes únicos | Cancelación% | Pico',
      { underline: true }
    );
    doc.moveDown(0.5);

    sorted.forEach(r => {
      doc.fontSize(10).text(
        `${r.stylist.name} | $${r.paid.totalRevenue.toFixed(2)} | ${r.paid.paidBookings} | $${r.avgTicket.toFixed(2)} | ` +
        `${r.ratings.avgRating.toFixed(2)}⭐ | ${r.ratings.ratingsCount} | ${r.extra.uniqueClients} | ` +
        `${r.extra.cancelRatePct.toFixed(1)}% | ${r.extra.peakWeekday ?? '-'} ${r.extra.peakHour ?? ''}`
      );
    });

    // Gráfico top ingresos
    drawBarChart(
      doc,
      'Top ingresos por estilista (Top 8)',
      sorted.slice(0, 8).map(r => ({ label: r.stylist.name, value: Number(r.paid.totalRevenue || 0) })),
      8
    );

    // Si es 1 estilista o pocos, incluye detalle con comentarios y top servicios
    const includeDetails = Boolean(stylistId) || reports.length <= 5;
    if (includeDetails) {
      for (const r of sorted) {
        doc.addPage();
        doc.fontSize(16).text(`Detalle: ${r.stylist.name}`, { underline: true });
        doc.moveDown();

        doc.fontSize(12).text(`Ingresos: $${r.paid.totalRevenue.toFixed(2)}`);
        doc.fontSize(12).text(`Citas pagadas: ${r.paid.paidBookings}`);
        doc.fontSize(12).text(`Ticket promedio: $${r.avgTicket.toFixed(2)}`);
        doc.fontSize(12).text(`Clientes únicos: ${r.extra.uniqueClients}`);
        doc.fontSize(12).text(`Cancelación/No-show: ${r.extra.cancelRatePct.toFixed(1)}%`);
        doc.fontSize(12).text(`Pico: ${r.extra.peakWeekday ?? '-'} ${r.extra.peakHour ?? ''}`);
        doc.moveDown();

        doc.fontSize(13).text('Rating', { underline: true });
        doc.fontSize(11).text(`Promedio: ${r.ratings.avgRating.toFixed(2)} ⭐`);
        doc.fontSize(11).text(`Reseñas: ${r.ratings.ratingsCount}`);
        doc.moveDown(0.5);

        doc.fontSize(11).text('Distribución de estrellas:', { underline: true });
        (r.ratings.distribution as any[]).forEach(d => {
          doc.fontSize(10).text(`• ${d.stars} ⭐: ${d.count}`);
        });
        doc.moveDown();

        doc.fontSize(13).text('Últimos comentarios (ratings)', { underline: true });
        if (!r.ratings.latestComments.length) {
          doc.fontSize(10).text('Sin comentarios en este rango.');
        } else {
          (r.ratings.latestComments as any[]).forEach(c => {
            const when = dayjs(c.createdAt).tz(TZ).format('YYYY-MM-DD HH:mm');
            doc.fontSize(10).text(`• ${c.clientName || 'Cliente'} (${c.estrellas}⭐) - ${when}: ${c.commentText}`);
          });
        }
        doc.moveDown();

        doc.fontSize(13).text('Top servicios', { underline: true });
        if (!r.topServices.length) {
          doc.fontSize(10).text('Sin servicios pagados en este rango.');
        } else {
          (r.topServices as any[]).forEach(s => {
            doc.fontSize(10).text(`• ${s.serviceName}: $${Number(s.totalRevenue || 0).toFixed(2)} (${s.bookingsCount} cita(s))`);
          });
        }
        doc.moveDown();

        doc.fontSize(13).text('Notas de citas (bookings)', { underline: true });
        if (!r.notes.length) {
          doc.fontSize(10).text('Sin notas registradas en este rango.');
        } else {
          (r.notes as any[]).forEach(n => {
            const when = dayjs(n.date).tz(TZ).format('YYYY-MM-DD HH:mm');
            doc.fontSize(10).text(`• ${when} | ${n.servicio} | ${n.cliente} | ${n.estado}: ${n.notas}`);
          });
        }
      }
    }

    doc.end();
  } catch (err) { next(err); }
}

function enforceStylistScope(req: any) {
  if (req.user?.role === ROLES.ESTILISTA) {
    const requested = req.query?.stylistId ? String(req.query.stylistId) : null;
    const mine = String(req.user.id);

    if (requested && requested !== mine) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'No puedes ver reportes de otro estilista');
    }

    // Forzamos el id del estilista logueado
    req.query.stylistId = mine;
  }
}

// ✅ Wrapper JSON “mi reporte”
export async function myStylistReport(req: any, res: any, next: any) {
  try {
    req.query.stylistId = String(req.user.id);
    return stylistsReport(req, res, next); // reutiliza tu endpoint existente
  } catch (err) { next(err); }
}

// ✅ Wrapper PDF “mi reporte”
export async function downloadMyStylistReportPdf(req: any, res: any, next: any) {
  try {
    req.query.stylistId = String(req.user.id);
    return downloadStylistsReportPdf(req, res, next);
  } catch (err) { next(err); }
}