import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import mongoose from 'mongoose';

import { BookingModel } from '../../models/Booking.js';
import { PaymentModel } from '../../models/Payment.js';
import { ServiceModel } from '../../models/Service.js';
import { UserModel } from '../../models/User.js';
import { ApiError } from '../../middlewares/errorHandler.js';
import { ROLES } from '../../constants/roles.js';
import { BOOKING_STATUS } from '../../constants/statuses.js';
import { generateInvoicePdf } from './invoice.service.js';
import { sendEmailWithAttachment, sendEmail } from '../../utils/email.js';

import { BILLING_CONFIG } from '../../config/billing.config.js';
import { supabaseAdmin } from '../../utils/supabaseAdmin.js';

// ✅ FIX TYPESCRIPT PARA user.role
import { hasRole } from '../../utils/roles.js';

// ------------------ HELPERS ------------------

function generateTransferReference(bookingId: string) {
  const shortId = bookingId.slice(-6).toUpperCase();
  return `RES-${shortId}`;
}

function generateInvoiceNumber(bookingId: string) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const shortId = bookingId.slice(-6).toUpperCase();
  return `FCT-${y}${m}${d}-${shortId}`;
}

function formatEC(d: Date) {
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: BILLING_CONFIG.TZ,
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(d);
}

function ensureOwnerOrStaff(reqUser: any, booking: any) {
  // Cliente solo puede operar su propia reserva
  if (reqUser.role === ROLES.CLIENTE && booking.clienteId.toString() !== reqUser.id) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'No autorizado');
  }
}

function bankInfoForClient(reference: string) {
  return {
    bank: BILLING_CONFIG.PICHINCHA_BANK_NAME,
    accountType: BILLING_CONFIG.PICHINCHA_ACCOUNT_TYPE,
    accountNumber: BILLING_CONFIG.PICHINCHA_ACCOUNT_NUMBER,
    accountHolder: BILLING_CONFIG.PICHINCHA_ACCOUNT_HOLDER,
    reference
  };
}

async function uploadTransferProofToSupabase(args: {
  bookingId: string;
  paymentId: string;
  buffer: Buffer;
  mimetype: string;
}) {
  const { bookingId, paymentId, buffer, mimetype } = args;

  const ext =
    mimetype === 'image/png'
      ? 'png'
      : mimetype === 'image/webp'
        ? 'webp'
        : 'jpg';

  const path = `transfer-proofs/${bookingId}/${paymentId}-${Date.now()}.${ext}`;
  const bucket = BILLING_CONFIG.SUPABASE_BUCKET_SERVICES; // reutilizado

  const up = await supabaseAdmin.storage.from(bucket).upload(path, buffer, {
    contentType: mimetype,
    upsert: true
  });

  if (up.error) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      `Error subiendo comprobante: ${up.error.message}`
    );
  }

  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
  const publicUrl = data?.publicUrl;

  if (!publicUrl) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      'No se pudo obtener URL pública del comprobante'
    );
  }

  return { path, publicUrl, bucket };
}

// ======================================================
// 1) GENERAR ORDEN DE PAGO POR TRANSFERENCIA
// ======================================================
export async function requestTransferPayment(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const bookingId = req.params.id;

    if (!mongoose.isValidObjectId(bookingId)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'ID de reserva inválido');
    }

    const booking = await BookingModel.findById(bookingId);
    if (!booking) throw new ApiError(StatusCodes.NOT_FOUND, 'Reserva no encontrada');

    // ✅ Roles permitidos (FIX)
    if (!hasRole(user.role, [ROLES.CLIENTE, ROLES.ADMIN, ROLES.GERENTE])) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Rol no autorizado');
    }

    ensureOwnerOrStaff(user, booking);

    if (booking.paymentStatus === 'PAID') {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Esta reserva ya está pagada');
    }

    if (
      booking.estado === BOOKING_STATUS.CANCELLED ||
      booking.estado === BOOKING_STATUS.NO_SHOW
    ) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'No se puede generar orden de pago para reserva cancelada o no-show'
      );
    }

    const service = await ServiceModel.findById(booking.servicioId).lean();
    if (!service || !service.precio) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Servicio inválido o sin precio');
    }

    const amount = Number(service.precio);
    if (amount <= 0) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'El valor del servicio debe ser mayor a 0');
    }

    const reference = generateTransferReference(booking.id);

    let payment = await PaymentModel.findOne({
      bookingId: booking._id,
      method: 'TRANSFER_PICHINCHA',
      status: 'PENDING'
    });

    if (!payment) {
      payment = await PaymentModel.create({
        bookingId: booking._id,
        amount,
        currency: 'USD',
        method: 'TRANSFER_PICHINCHA',
        status: 'PENDING',
        transactionRef: reference,
        createdBy: new mongoose.Types.ObjectId(user.id)
      });
    }

    const bankInfo = bankInfoForClient(reference);

    // Email admin con PDF (opcional)
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      const [client, stylist] = await Promise.all([
        UserModel.findById(booking.clienteId).select('nombre apellido email'),
        UserModel.findById(booking.estilistaId).select('nombre apellido email')
      ]);

      const invoiceNumber = generateInvoiceNumber(booking.id);
      const issuedAt = new Date();

      const pdfBuffer = await generateInvoicePdf({
        booking,
        client: client || null,
        stylist: stylist || null,
        service: {
          nombre: service.nombre,
          duracionMin: service.duracionMin,
          precio: amount
        },
        payment: {
          invoiceNumber,
          method: 'TRANSFER_PICHINCHA',
          paidAt: issuedAt,
          amount
        }
      });

      const confirmUrl = `${BILLING_CONFIG.ADMIN_CONFIRM_URL_BASE}?bookingId=${booking.id}&paymentId=${payment.id}`;
      const clientName = client ? `${client.nombre} ${client.apellido || ''}`.trim() : 'Cliente';

      const htmlAdmin = `
        <p>Se ha generado una <b>nueva orden de pago por transferencia</b>.</p>
        <p><b>Cliente:</b> ${clientName}</p>
        <p><b>Servicio:</b> ${service.nombre}</p>
        <p><b>Fecha y hora de la cita:</b> ${formatEC(booking.inicio)}</p>
        <p><b>Monto:</b> $${amount.toFixed(2)}</p>
        <hr/>
        <p><b>Banco:</b> ${bankInfo.bank}</p>
        <p><b>Número de cuenta:</b> ${bankInfo.accountNumber}</p>
        <p><b>Titular:</b> ${bankInfo.accountHolder}</p>
        <p><b>Referencia:</b> ${bankInfo.reference}</p>
        <hr/>
        <p>Para confirmar pago, primero asegúrate que el cliente suba el comprobante.</p>
        <p>
          <a href="${confirmUrl}"
             style="display:inline-block;padding:10px 18px;background:#0d6efd;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">
            ✅ Ir a confirmar
          </a>
        </p>
      `;

      await sendEmailWithAttachment(
        adminEmail,
        'Nueva orden de pago por transferencia',
        htmlAdmin,
        pdfBuffer,
        `orden-pago-${invoiceNumber}.pdf`
      );
    }

    res.json({
      message: 'Generada solicitud de pago por transferencia',
      bookingId: booking.id,
      paymentId: payment.id,
      amount,
      bankInfo,
      uploadProofEndpoint: `/api/v1/payments/booking/${booking.id}/transfer-proof`
    });
  } catch (err) {
    next(err);
  }
}

// ======================================================
// 1.1) SUBIR COMPROBANTE (CLIENTE)
// ======================================================
export async function uploadTransferProof(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const bookingId = req.params.id;

    if (!mongoose.isValidObjectId(bookingId)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'ID de reserva inválido');
    }

    const booking = await BookingModel.findById(bookingId);
    if (!booking) throw new ApiError(StatusCodes.NOT_FOUND, 'Reserva no encontrada');

    // ✅ Roles permitidos (FIX)
    if (!hasRole(user.role, [ROLES.CLIENTE, ROLES.ADMIN, ROLES.GERENTE])) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Rol no autorizado');
    }

    ensureOwnerOrStaff(user, booking);

    if (booking.paymentStatus === 'PAID') {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'La reserva ya está pagada');
    }

    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Debes enviar un archivo en campo "file"');
    }

    if (!BILLING_CONFIG.UPLOAD_ALLOWED_MIME.includes(file.mimetype as any)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Tipo de imagen no permitido');
    }

    let payment = await PaymentModel.findOne({
      bookingId: booking._id,
      method: 'TRANSFER_PICHINCHA',
      status: 'PENDING'
    });

    if (!payment) {
      const service = await ServiceModel.findById(booking.servicioId).lean();
      if (!service || !service.precio) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Servicio inválido o sin precio');
      }

      payment = await PaymentModel.create({
        bookingId: booking._id,
        amount: Number(service.precio),
        currency: 'USD',
        method: 'TRANSFER_PICHINCHA',
        status: 'PENDING',
        transactionRef: generateTransferReference(booking.id),
        createdBy: new mongoose.Types.ObjectId(user.id)
      });
    }

    const { path, publicUrl } = await uploadTransferProofToSupabase({
      bookingId: booking.id,
      paymentId: payment.id,
      buffer: file.buffer,
      mimetype: file.mimetype
    });

    payment.transferProofPath = path;
    payment.transferProofUrl = publicUrl;
    payment.transferProofUploadedAt = new Date();
    payment.transferProofUploadedBy = new mongoose.Types.ObjectId(user.id);
    await payment.save();

    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      const confirmUrl = `${BILLING_CONFIG.ADMIN_CONFIRM_URL_BASE}?bookingId=${booking.id}&paymentId=${payment.id}`;
      const html = `
        <p>El cliente ha subido el <b>comprobante de transferencia</b>.</p>
        <p><b>Reserva:</b> ${booking.id}</p>
        <p><b>Comprobante:</b> <a href="${publicUrl}" target="_blank">Ver imagen</a></p>
        <p>
          <a href="${confirmUrl}"
             style="display:inline-block;padding:10px 18px;background:#0d6efd;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">
            ✅ Confirmar pago
          </a>
        </p>
      `;
      await sendEmail(adminEmail, 'Comprobante de transferencia subido', html);
    }

    res.json({
      message: 'Comprobante subido correctamente',
      bookingId: booking.id,
      paymentId: payment.id,
      transferProofUrl: publicUrl
    });
  } catch (err) {
    next(err);
  }
}

// ======================================================
// 1.2) VER COMPROBANTE DE UNA RESERVA
// ======================================================
export async function getTransferProofByBooking(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const bookingId = req.params.id;

    if (!mongoose.isValidObjectId(bookingId)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'ID de reserva inválido');
    }

    const booking = await BookingModel.findById(bookingId);
    if (!booking) throw new ApiError(StatusCodes.NOT_FOUND, 'Reserva no encontrada');

    // ✅ Roles permitidos (FIX)
    if (!hasRole(user.role, [ROLES.CLIENTE, ROLES.ADMIN, ROLES.GERENTE])) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Rol no autorizado');
    }

    ensureOwnerOrStaff(user, booking);

    const payment = await PaymentModel.findOne({
      bookingId: booking._id,
      method: 'TRANSFER_PICHINCHA'
    }).sort({ createdAt: -1 });

    if (!payment) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'No existe pago de transferencia para esta reserva');
    }

    res.json({
      bookingId: booking.id,
      paymentId: payment.id,
      status: payment.status,
      transferProofUrl: payment.transferProofUrl ?? null,
      transferProofUploadedAt: payment.transferProofUploadedAt ?? null
    });
  } catch (err) {
    next(err);
  }
}

// ======================================================
// 1.3) LISTAR COMPROBANTES POR CLIENTE (ADMIN/GERENTE)
// ======================================================
export async function listTransferProofs(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;

    // ✅ FIX
    if (!hasRole(user.role, [ROLES.ADMIN, ROLES.GERENTE])) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Solo ADMIN/GERENTE');
    }

    const { clientId } = req.query as any;

    const match: any = {
      method: 'TRANSFER_PICHINCHA',
      transferProofUrl: { $exists: true, $ne: null }
    };

    const pipeline: any[] = [
      { $match: match },
      { $lookup: { from: 'bookings', localField: 'bookingId', foreignField: '_id', as: 'booking' } },
      { $unwind: '$booking' }
    ];

    if (clientId) {
      if (!mongoose.isValidObjectId(String(clientId))) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'clientId inválido');
      }
      pipeline.push({
        $match: { 'booking.clienteId': new mongoose.Types.ObjectId(String(clientId)) }
      });
    }

    pipeline.push(
      { $lookup: { from: 'users', localField: 'booking.clienteId', foreignField: '_id', as: 'client' } },
      { $unwind: { path: '$client', preserveNullAndEmptyArrays: true } },
      { $sort: { transferProofUploadedAt: -1 } },
      {
        $project: {
          _id: 1,
          bookingId: '$booking._id',
          paymentStatus: '$status',
          transferProofUrl: 1,
          transferProofUploadedAt: 1,
          clientId: '$booking.clienteId',
          clientName: {
            $trim: {
              input: {
                $concat: ['$client.nombre', ' ', { $ifNull: ['$client.apellido', ''] }]
              }
            }
          }
        }
      }
    );

    const rows = await PaymentModel.aggregate(pipeline);

    res.json({ count: rows.length, data: rows });
  } catch (err) {
    next(err);
  }
}

// ======================================================
// 1.4) LISTAR MIS COMPROBANTES (CLIENTE)
// ======================================================
export async function listMyTransferProofs(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;

    // ✅ FIX
    if (!hasRole(user.role, [ROLES.CLIENTE])) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Solo CLIENTE');
    }

    const pipeline: any[] = [
      {
        $match: {
          method: 'TRANSFER_PICHINCHA',
          transferProofUrl: { $exists: true, $ne: null }
        }
      },
      { $lookup: { from: 'bookings', localField: 'bookingId', foreignField: '_id', as: 'booking' } },
      { $unwind: '$booking' },
      { $match: { 'booking.clienteId': new mongoose.Types.ObjectId(user.id) } },
      { $sort: { transferProofUploadedAt: -1 } },
      {
        $project: {
          _id: 1,
          bookingId: '$booking._id',
          paymentStatus: '$status',
          transferProofUrl: 1,
          transferProofUploadedAt: 1
        }
      }
    ];

    const rows = await PaymentModel.aggregate(pipeline);

    res.json({ count: rows.length, data: rows });
  } catch (err) {
    next(err);
  }
}

// ======================================================
// 2) CONFIRMAR TRANSFERENCIA (ADMIN/GERENTE) - SOLO 1 VEZ
// ======================================================
export async function confirmTransferPayment(req: Request, res: Response, next: NextFunction) {
  const session = await mongoose.startSession();

  try {
    const user = req.user!;
    const bookingId = req.params.id;

    if (!mongoose.isValidObjectId(bookingId)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'ID de reserva inválido');
    }

    // ✅ FIX
    if (!hasRole(user.role, [ROLES.ADMIN, ROLES.GERENTE])) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        'Solo ADMIN/GERENTE pueden confirmar transferencias'
      );
    }

    let updatedBooking: any = null;
    let updatedPayment: any = null;
    let serviceSnapshot: any = null;

    await session.withTransaction(async () => {
      const booking = await BookingModel.findById(bookingId).session(session);
      if (!booking) throw new ApiError(StatusCodes.NOT_FOUND, 'Reserva no encontrada');

      // ✅ SOLO UNA VEZ: si ya está pagada/confirmada, bloquear
      if (booking.paymentStatus === 'PAID' || booking.paidAt || booking.invoiceNumber) {
        throw new ApiError(StatusCodes.CONFLICT, 'Esta reserva ya fue confirmada anteriormente');
      }

      // (opcional) bloquear confirmación si la reserva no es válida
      if (
        booking.estado === BOOKING_STATUS.CANCELLED ||
        booking.estado === BOOKING_STATUS.NO_SHOW
      ) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          'No se puede confirmar transferencia para una reserva cancelada o no-show'
        );
      }

      const service = await ServiceModel.findById(booking.servicioId).lean().session(session);
      if (!service || !service.precio) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Servicio inválido o sin precio');
      }
      serviceSnapshot = service;

      const amount = Number(service.precio);
      const invoiceNumber = generateInvoiceNumber(booking.id);
      const paidAt = new Date();

      // ✅ ATÓMICO: solo pasa de PENDING -> PAID si existe comprobante
      updatedPayment = await PaymentModel.findOneAndUpdate(
        {
          bookingId: booking._id,
          method: 'TRANSFER_PICHINCHA',
          status: 'PENDING',
          transferProofUrl: { $exists: true, $ne: null }
        },
        {
          $set: {
            status: 'PAID',
            amount
          }
        },
        { new: true, session }
      );

      if (!updatedPayment) {
        // Puede ser: no hay PENDING, falta comprobante, o ya fue confirmado antes
        throw new ApiError(
          StatusCodes.CONFLICT,
          'No se puede confirmar: no existe un pago PENDING con comprobante (o ya fue confirmado)'
        );
      }

      // ✅ ATÓMICO: solo marca booking como PAID si aún no lo está (doble click / carrera)
      updatedBooking = await BookingModel.findOneAndUpdate(
        {
          _id: booking._id,
          paymentStatus: { $ne: 'PAID' },
          $or: [{ invoiceNumber: { $exists: false } }, { invoiceNumber: null }]
        },
        {
          $set: {
            precio: amount,
            paymentStatus: 'PAID',
            paymentMethod: 'TRANSFER_PICHINCHA',
            paidAt,
            invoiceNumber,
            estado: BOOKING_STATUS.CONFIRMED,
            actualizadoPor: new mongoose.Types.ObjectId(user.id)
          }
        },
        { new: true, session }
      );

      if (!updatedBooking) {
        throw new ApiError(StatusCodes.CONFLICT, 'Esta reserva ya fue confirmada por otro usuario');
      }
    });

    // 📩 Fuera de la transacción: PDF + correo (evita enviar 2 veces si algo falla dentro)
    const [client, stylist] = await Promise.all([
      UserModel.findById(updatedBooking.clienteId).select('nombre apellido email'),
      UserModel.findById(updatedBooking.estilistaId).select('nombre apellido email')
    ]);

    const amount = Number(updatedBooking.precio);
    const invoiceNumber = String(updatedBooking.invoiceNumber);
    const paidAt = updatedBooking.paidAt as Date;

    const pdfBuffer = await generateInvoicePdf({
      booking: updatedBooking,
      client: client || null,
      stylist: stylist || null,
      service: {
        nombre: serviceSnapshot?.nombre,
        duracionMin: serviceSnapshot?.duracionMin,
        precio: amount
      },
      payment: {
        invoiceNumber,
        method: 'TRANSFER_PICHINCHA',
        paidAt,
        amount
      }
    });

    if (client?.email) {
      const htmlCliente = `
        <p>Tu pago por transferencia ha sido <b>confirmado</b>.</p>
        <p><b>Servicio:</b> ${serviceSnapshot?.nombre}</p>
        <p><b>Fecha y hora:</b> ${formatEC(updatedBooking.inicio)}</p>
        <p><b>Total pagado:</b> $${amount.toFixed(2)}</p>
        <p><b>Factura:</b> ${invoiceNumber}</p>
        <p>Adjuntamos tu factura en PDF.</p>
      `;

      await sendEmailWithAttachment(
        client.email,
        'Pago confirmado y cita reservada',
        htmlCliente,
        pdfBuffer,
        `factura-${invoiceNumber}.pdf`
      );
    }

    res.json({
      message: 'Transferencia confirmada, pago registrado y cita confirmada',
      bookingId: updatedBooking.id,
      paymentId: updatedPayment.id,
      invoiceNumber,
      transferProofUrl: updatedPayment.transferProofUrl
    });
  } catch (err) {
    next(err);
  } finally {
    session.endSession();
  }
}
