import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import mongoose from 'mongoose';

import { BookingModel } from '../../models/Booking.js';
import { ServiceModel } from '../../models/Service.js';
import { ServiceSlotModel } from '../../models/ServiceSlot.js';
import { AppointmentModel } from '../../models/Appointment.js';
import { ApiError } from '../../middlewares/errorHandler.js';

import {
  dayjs,
  dayStart,
  buildDateTimeForSlot,
  parseDateTime,
  formatEC
} from '../../utils/time.js';

import { BOOKING_STATUS } from '../../constants/statuses.js';
import { computeAvailability } from './availability.service.js';
import { UserModel } from '../../models/User.js';
import { ROLES } from '../../constants/roles.js';
import { sendEmail } from '../../utils/email.js';

// ✅ Diferencia en horas hacia el futuro (si ya pasó, sale negativa)
function hoursUntil(now: Date, future: Date) {
  return (future.getTime() - now.getTime()) / 36e5;
}

/**
 * Estados que BLOQUEAN horarios (para evitar solapes)
 * Incluye legacy por si hay docs viejos.
 */
const ACTIVE_BOOKING_STATES = [
  BOOKING_STATUS.CONFIRMED,
  BOOKING_STATUS.IN_PROGRESS,

  // legacy / compat
  BOOKING_STATUS.SCHEDULED,
  BOOKING_STATUS.PENDING_STYLIST_CONFIRMATION
].filter(Boolean);

const ACTIVE_APPOINTMENT_STATES = ['PENDIENTE', 'CONFIRMADA'] as const;

// --- Helpers de fechas / día de la semana (ECUADOR) ---
const WEEKDAYS = [
  'DOMINGO',
  'LUNES',
  'MARTES',
  'MIERCOLES',
  'JUEVES',
  'VIERNES',
  'SABADO'
] as const;

const TZ = 'America/Guayaquil';

function getDayLabelEC(dateStr: string) {
  const d = dayjs.tz(dateStr, 'YYYY-MM-DD', TZ);
  return WEEKDAYS[d.day()];
}

// --- Overlap con citas MANUALES (appointments) ---
async function hasManualAppointmentOverlapForStylist(
  stylistId: string,
  start: Date,
  end: Date
) {
  return AppointmentModel.exists({
    stylist: stylistId,
    start: { $lt: end },
    end: { $gt: start },
    status: { $in: ACTIVE_APPOINTMENT_STATES }
  });
}

async function hasManualAppointmentOverlapForClient(
  clientId: string,
  start: Date,
  end: Date
) {
  return AppointmentModel.exists({
    clientId,
    start: { $lt: end },
    end: { $gt: start },
    status: { $in: ACTIVE_APPOINTMENT_STATES }
  });
}

// ---------------------------------------------------------------------
// DISPONIBILIDAD
// ---------------------------------------------------------------------
export async function getAvailability(req: Request, res: Response, next: NextFunction) {
  try {
    const { date, serviceId, stylistId } = req.query as any;
    const availability = await computeAvailability(date, serviceId, stylistId);
    res.json(availability);
  } catch (err) { next(err); }
}

// ---------------------------------------------------------------------
// CREAR RESERVA (1 o varios slots)  -> estado: CONFIRMED
// ---------------------------------------------------------------------
export async function createBooking(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const { slotId, slotIds, date, notas } = req.body as {
      slotId?: string;
      slotIds?: string[];
      date: string;
      notas?: string;
    };

    // 1) Verificar que el cliente no esté congelado
    const client = await UserModel.findById(userId);
    if (client?.frozenUntil && client.frozenUntil > new Date()) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'Cuenta temporalmente bloqueada para reservas');
    }

    // 2) Normalizar lista de slots
    let slotIdList: string[] = [];
    if (Array.isArray(slotIds) && slotIds.length > 0) {
      slotIdList = slotIds;
    } else if (slotId) {
      slotIdList = [slotId];
    }

    const uniqueSlotIds = Array.from(new Set(slotIdList));
    if (!uniqueSlotIds.length) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Debes enviar al menos un slot');
    }

    const invalid = uniqueSlotIds.filter(id => !mongoose.isValidObjectId(id));
    if (invalid.length) {
      throw new ApiError(StatusCodes.BAD_REQUEST, `slotIds inválidos: ${invalid.join(', ')}`);
    }

    // 3) Buscar slots activos
    const slots: any[] = await ServiceSlotModel.find({
      _id: { $in: uniqueSlotIds },
      isActive: true
    })
      .populate('stylist', 'nombre apellido role isActive')
      .populate('service', 'nombre duracionMin precio activo');

    if (slots.length !== uniqueSlotIds.length) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Uno o más horarios no existen o están inactivos');
    }

    // 4) Validar fecha (Ecuador)
    const dateObj = dayStart(date);
    if (isNaN(dateObj.getTime())) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Fecha inválida');
    }

    const dayLabel = getDayLabelEC(date);

    type Candidate = {
      slot: any;
      stylistId: string;
      serviceId: string;
      start: Date;
      end: Date;
    };

    const candidates: Candidate[] = [];

    // 5) Validar cada slot y armar candidatos
    for (const slot of slots) {
      const stylist = slot.stylist;
      const service = slot.service;

      if (!stylist || stylist.role !== ROLES.ESTILISTA || stylist.isActive === false) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Estilista no disponible para uno de los horarios');
      }

      if (!service || !service.activo) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Servicio no disponible para uno de los horarios');
      }

      if (dayLabel !== slot.dayOfWeek) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          `La fecha no coincide con el día configurado del horario (${slot.dayOfWeek})`
        );
      }

      // ✅ Construcción Ecuador
      const start = buildDateTimeForSlot(date, slot.startMin);
      const end = buildDateTimeForSlot(date, slot.endMin);

      candidates.push({
        slot,
        stylistId: stylist._id.toString(),
        serviceId: service._id.toString(),
        start,
        end
      });
    }

    // 6) Evitar solapes ENTRE los slots seleccionados (mismo estilista)
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i];
        const b = candidates[j];
        if (a.stylistId !== b.stylistId) continue;
        const overlap = a.start < b.end && b.start < a.end;
        if (overlap) {
          throw new ApiError(
            StatusCodes.BAD_REQUEST,
            'Dos de los slots seleccionados se solapan entre sí para el mismo estilista'
          );
        }
      }
    }

    // 7) Validar contra reservas y citas MANUALES existentes
    for (const block of candidates) {
      const stylistId = block.stylistId;

      const overlapping = await BookingModel.exists({
        estilistaId: stylistId,
        inicio: { $lt: block.end },
        fin: { $gt: block.start },
        estado: { $in: ACTIVE_BOOKING_STATES }
      });
      if (overlapping) {
        throw new ApiError(StatusCodes.CONFLICT, 'Horario no disponible para alguno de los horarios seleccionados');
      }

      const doubleClient = await BookingModel.exists({
        clienteId: userId,
        inicio: { $lt: block.end },
        fin: { $gt: block.start },
        estado: { $in: ACTIVE_BOOKING_STATES }
      });
      if (doubleClient) {
        throw new ApiError(StatusCodes.CONFLICT, 'Ya tienes una reserva en uno de los horarios seleccionados');
      }

      const manualStylist = await hasManualAppointmentOverlapForStylist(
        stylistId,
        block.start,
        block.end
      );
      if (manualStylist) {
        throw new ApiError(StatusCodes.CONFLICT, 'Horario no disponible (existe una cita manual para el estilista)');
      }

      const manualClient = await hasManualAppointmentOverlapForClient(
        userId,
        block.start,
        block.end
      );
      if (manualClient) {
        throw new ApiError(StatusCodes.CONFLICT, 'Ya tienes una cita manual en uno de los horarios seleccionados');
      }
    }

    // 8) Crear todas las reservas -> CONFIRMED + clienteAsistio null
    const created: any[] = [];
    for (const c of candidates) {
      const booking = await BookingModel.create({
        clienteId: userId,
        estilistaId: c.slot.stylist._id,
        servicioId: c.slot.service._id,
        inicio: c.start,
        fin: c.end,

        estado: BOOKING_STATUS.CONFIRMED, // ✅ CAMBIO AQUÍ
        clienteAsistio: null,

        notas,
        creadoPor: userId
      });
      created.push(booking);
    }

    // 9) Correos
    const clientNombre =
      client ? `${client.nombre} ${client.apellido ?? ''}`.trim() : 'Cliente';

    for (const c of candidates) {
      const fechaTexto = formatEC(c.start);
      const servicioTexto = c.slot.service?.nombre ?? 'Servicio';

      const stylistUser = await UserModel.findById(c.slot.stylist._id);
      if (stylistUser?.email) {
        const bodyStylist =
          `Tienes una nueva reserva.\n\n` +
          `Cliente: ${clientNombre}\n` +
          `Servicio: ${servicioTexto}\n` +
          `Fecha y hora: ${fechaTexto}\n\n` +
          `Notas: ${notas || 'Sin notas adicionales.'}`;

        await sendEmail(stylistUser.email, 'Nueva reserva', bodyStylist);
      }

      if (client?.email) {
        const stylistNombre =
          c.slot.stylist?.nombre && c.slot.stylist?.apellido
            ? `${c.slot.stylist.nombre} ${c.slot.stylist.apellido}`
            : 'Tu estilista';

        const bodyClient =
          `Tu reserva ha sido registrada.\n\n` +
          `Estilista: ${stylistNombre}\n` +
          `Servicio: ${servicioTexto}\n` +
          `Fecha y hora: ${fechaTexto}\n\n` +
          `Notas: ${notas || 'Sin notas adicionales.'}`;

        await sendEmail(client.email, 'Reserva confirmada', bodyClient);
      }
    }

    res.status(StatusCodes.CREATED).json({
      count: created.length,
      bookings: created
    });

  } catch (err) { next(err); }
}

// ---------------------------------------------------------------------
// REPROGRAMAR RESERVA -> estado: CONFIRMED (sin confirmación del estilista)
// ---------------------------------------------------------------------
export async function rescheduleBooking(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const id = req.params.id;

    const booking = await BookingModel.findById(id);
    if (!booking) throw new ApiError(StatusCodes.NOT_FOUND, 'No existe');

    const now = new Date();
    const diffHours = hoursUntil(now, booking.inicio);

    if (user.role === ROLES.CLIENTE && diffHours < 12) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        'Reprogramación fuera de plazo. Comuníquese con administración.'
      );
    }

    const start = parseDateTime(req.body.inicio);
    if (isNaN(start.getTime())) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Fecha de inicio inválida');
    }

    const service = await ServiceModel.findById(booking.servicioId);
    if (!service || !service.duracionMin) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Servicio inválido para esta reserva');
    }

    const end = dayjs(start).add(service.duracionMin, 'minute').toDate();

    const overlapping = await BookingModel.exists({
      _id: { $ne: booking.id },
      estilistaId: booking.estilistaId,
      inicio: { $lt: end },
      fin: { $gt: start },
      estado: { $in: ACTIVE_BOOKING_STATES }
    });
    if (overlapping) throw new ApiError(StatusCodes.CONFLICT, 'Horario no disponible');

    const manualStylist = await hasManualAppointmentOverlapForStylist(
      booking.estilistaId.toString(),
      start,
      end
    );
    if (manualStylist) {
      throw new ApiError(StatusCodes.CONFLICT, 'Horario no disponible (existe una cita manual para el estilista)');
    }

    if (booking.clienteId) {
      const manualClient = await hasManualAppointmentOverlapForClient(
        booking.clienteId.toString(),
        start,
        end
      );
      if (manualClient) {
        throw new ApiError(StatusCodes.CONFLICT, 'Ya tienes una cita manual en ese horario');
      }
    }

    booking.inicio = start;
    booking.fin = end;

    booking.estado = BOOKING_STATUS.CONFIRMED; // ✅ CAMBIO AQUÍ
    booking.clienteAsistio = null;

    booking.actualizadoPor = user.id as any;
    await booking.save();

    // Correos
    const fechaTexto = formatEC(start);
    const servicioTexto = service?.nombre ?? 'Servicio';

    const stylistUser = await UserModel.findById(booking.estilistaId).select('email nombre apellido');
    if (stylistUser?.email) {
      const bodyStylist =
        `Una reserva ha sido reprogramada.\n\n` +
        `Servicio: ${servicioTexto}\n` +
        `Nueva fecha y hora: ${fechaTexto}\n\n` +
        `ID de reserva: ${booking.id}`;

      await sendEmail(stylistUser.email, 'Reserva reprogramada', bodyStylist);
    }

    if (booking.clienteId) {
      const clientUser = await UserModel.findById(booking.clienteId).select('email nombre apellido');
      if (clientUser?.email) {
        const stylistNombre =
          stylistUser?.nombre && stylistUser?.apellido
            ? `${stylistUser.nombre} ${stylistUser.apellido}`
            : 'Tu estilista';

        const bodyClient =
          `Tu reserva ha sido reprogramada.\n\n` +
          `Estilista: ${stylistNombre}\n` +
          `Servicio: ${servicioTexto}\n` +
          `Nueva fecha y hora: ${fechaTexto}\n\n` +
          `ID de reserva: ${booking.id}`;

        await sendEmail(clientUser.email, 'Tu reserva ha sido reprogramada', bodyClient);
      }
    }

    res.json(booking);
  } catch (err) { next(err); }
}

// ---------------------------------------------------------------------
// CANCELAR RESERVA
// ---------------------------------------------------------------------
export async function cancelBooking(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const id = req.params.id;
    const { motivo } = req.body;

    const booking = await BookingModel.findById(id);
    if (!booking) throw new ApiError(StatusCodes.NOT_FOUND, 'No existe');

    const now = new Date();
    const diffHours = hoursUntil(now, booking.inicio);

    if (user.role === ROLES.CLIENTE) {
      if (diffHours < 12) {
        await UserModel.findByIdAndUpdate(user.id, {
          frozenUntil: new Date(Date.now() + 24 * 3600 * 1000)
        });
        throw new ApiError(StatusCodes.FORBIDDEN, 'Cancelación fuera de plazo. Cuenta congelada 24h.');
      }
      if (booking.clienteId.toString() !== user.id) throw new ApiError(StatusCodes.FORBIDDEN, 'No autorizado');
    }

    booking.estado = BOOKING_STATUS.CANCELLED;
    booking.notas = (booking.notas ?? '') + `\nCANCELADO: ${motivo}`;
    booking.actualizadoPor = user.id as any;
    await booking.save();

    res.json({ message: 'Cita cancelada' });
  } catch (err) { next(err); }
}

// ---------------------------------------------------------------------
// FINALIZAR (ESTILISTA) -> marcar asistencia SI/NO
// - true  => COMPLETED (puede guardar precio)
// - false => NO_SHOW (NO genera ingreso)
// ---------------------------------------------------------------------
export async function stylistComplete(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    const id = req.params.id;

    const { clienteAsistio, precio, notas } = req.body as {
      clienteAsistio: boolean;
      precio?: number;
      notas?: string;
    };

    if (typeof clienteAsistio !== 'boolean') {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Debes enviar clienteAsistio: true/false');
    }

    const booking = await BookingModel.findById(id);
    if (!booking) throw new ApiError(StatusCodes.NOT_FOUND, 'No existe');

    if (user.role !== ROLES.ESTILISTA || booking.estilistaId.toString() !== user.id) {
      throw new ApiError(StatusCodes.FORBIDDEN, 'No autorizado');
    }

    booking.clienteAsistio = clienteAsistio;

    if (clienteAsistio) {
      booking.estado = BOOKING_STATUS.COMPLETED;
      if (precio !== undefined) booking.precio = Number(precio);
    } else {
      booking.estado = BOOKING_STATUS.NO_SHOW;
      booking.precio = undefined as any; // sin ingreso
    }

    if (notas) {
      const tag = clienteAsistio ? 'FINALIZADO' : 'NO_SHOW';
      booking.notas = (booking.notas ?? '') + `\n${tag}: ${notas}`;
    }

    booking.actualizadoPor = user.id as any;
    await booking.save();

    res.json(booking);
  } catch (err) { next(err); }
}
