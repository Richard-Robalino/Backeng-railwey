import { StatusCodes } from 'http-status-codes';
import mongoose from 'mongoose';
import { AppointmentModel } from '../../models/Appointment.js';
import { UserModel } from '../../models/User.js';
import { ServiceModel } from '../../models/Service.js';
import { CategoryModel } from '../../models/Category.js';
import { BookingModel } from '../../models/Booking.js';
import { ApiError } from '../../middlewares/errorHandler.js';
import { ROLES } from '../../constants/roles.js';
import { BOOKING_STATUS } from '../../constants/statuses.js';
import { sendEmail } from '../../utils/email.js';
// ✅ helpers TZ Ecuador (de tu utils/time.js)
import { parseDateTime, formatEC } from '../../utils/time.js';
// ----------------- Constantes / helpers básicos -----------------
const ACTIVE_BOOKING_STATES = [
    BOOKING_STATUS.SCHEDULED,
    BOOKING_STATUS.CONFIRMED,
    BOOKING_STATUS.IN_PROGRESS,
    BOOKING_STATUS.PENDING_STYLIST_CONFIRMATION
];
const ACTIVE_APPOINTMENT_STATES = ['PENDIENTE', 'CONFIRMADA'];
function isValid30Step(date) {
    const minutes = date.getMinutes();
    return (minutes === 0 || minutes === 30) &&
        date.getSeconds() === 0 &&
        date.getMilliseconds() === 0;
}
function diffMinutes(start, end) {
    return Math.round((end.getTime() - start.getTime()) / 60000);
}
/**
 * Valida:
 * - estilista existe / activo / rol ESTILISTA
 * - servicios existen, activos
 * - todos los servicios pertenecen a algún catálogo activo del estilista
 */
async function validateStylistAndServices(stylistId, rawServiceIds) {
    if (!mongoose.isValidObjectId(stylistId)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'ID de estilista inválido');
    }
    const uniqueServiceIds = Array.from(new Set(rawServiceIds || []));
    if (!uniqueServiceIds.length) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Debes enviar al menos un servicio');
    }
    const invalid = uniqueServiceIds.filter(id => !mongoose.isValidObjectId(id));
    if (invalid.length) {
        throw new ApiError(StatusCodes.BAD_REQUEST, `IDs de servicio inválidos: ${invalid.join(', ')}`);
    }
    const stylist = await UserModel.findById(stylistId).select('role isActive catalogs nombre apellido email');
    if (!stylist) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Estilista no encontrado');
    }
    if (stylist.role !== ROLES.ESTILISTA) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'El usuario no es un estilista');
    }
    if (!stylist.isActive) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'El estilista está inactivo');
    }
    const services = await ServiceModel.find({
        _id: { $in: uniqueServiceIds },
        activo: true
    }).lean();
    if (services.length !== uniqueServiceIds.length) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Uno o más servicios no existen o están inactivos');
    }
    const catalogs = (stylist.catalogs || []);
    if (!catalogs.length) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'El estilista no tiene catálogos asignados');
    }
    const cats = await CategoryModel.find({
        _id: { $in: catalogs },
        activo: true
    }).select('services').lean();
    if (!cats.length) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'El estilista no tiene catálogos activos');
    }
    const allowedServices = new Set();
    for (const c of cats) {
        for (const s of c.services || []) {
            allowedServices.add(String(s));
        }
    }
    for (const sid of uniqueServiceIds) {
        if (!allowedServices.has(String(sid))) {
            throw new ApiError(StatusCodes.FORBIDDEN, 'Uno de los servicios no está asociado a este estilista');
        }
    }
    return { stylist, services, uniqueServiceIds };
}
/**
 * Verifica que NO haya solape con:
 * - otras citas manuales (AppointmentModel)
 * - bookings normales (BookingModel) en estado activo
 */
async function ensureNoOverlap(stylistId, start, end, excludeId) {
    const filter = {
        stylist: stylistId,
        status: { $in: ACTIVE_APPOINTMENT_STATES },
        start: { $lt: end },
        end: { $gt: start }
    };
    if (excludeId && mongoose.isValidObjectId(excludeId)) {
        filter._id = { $ne: excludeId };
    }
    const overlapAppointment = await AppointmentModel.exists(filter);
    const bookingFilter = {
        estilistaId: stylistId,
        inicio: { $lt: end },
        fin: { $gt: start },
        estado: { $in: ACTIVE_BOOKING_STATES }
    };
    const overlapBooking = await BookingModel.exists(bookingFilter);
    if (overlapAppointment || overlapBooking) {
        throw new ApiError(StatusCodes.CONFLICT, 'El estilista ya tiene una cita o reserva en ese horario');
    }
}
// ---------------------------------------------------------------------
// CREAR CITA MANUAL
// ---------------------------------------------------------------------
export async function createAppointment(req, res, next) {
    try {
        const { stylistId, serviceId, serviceIds, clientId, start, end, clientName, clientPhone, status, notes } = req.body;
        // ✅ Ecuador (si viene sin zona, asume America/Guayaquil)
        const startDate = parseDateTime(start);
        const endDate = parseDateTime(end);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Fechas inválidas');
        }
        if (endDate <= startDate) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'La hora de fin debe ser mayor que la de inicio');
        }
        if (!isValid30Step(startDate) || !isValid30Step(endDate)) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Las horas deben estar en intervalos de 30 minutos (hh:00 o hh:30)');
        }
        let serviceIdList = [];
        if (Array.isArray(serviceIds) && serviceIds.length > 0) {
            serviceIdList = serviceIds;
        }
        else if (serviceId) {
            serviceIdList = [serviceId];
        }
        const { stylist, services, uniqueServiceIds } = await validateStylistAndServices(stylistId, serviceIdList);
        const minutes = diffMinutes(startDate, endDate);
        const totalDuration = services.reduce((acc, s) => acc + (s.duracionMin || 0), 0);
        if (minutes !== totalDuration) {
            throw new ApiError(StatusCodes.BAD_REQUEST, `La duración de la cita (${minutes} min) debe coincidir con la suma de los servicios (${totalDuration} min)`);
        }
        if (minutes % 30 !== 0) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'La duración total de la cita debe ser múltiplo de 30 minutos (30, 60, 90, ...)');
        }
        await ensureNoOverlap(stylistId, startDate, endDate);
        let clientIdToSave = null;
        let clientDoc = null;
        if (clientId) {
            if (!mongoose.isValidObjectId(clientId)) {
                throw new ApiError(StatusCodes.BAD_REQUEST, 'clientId inválido');
            }
            clientDoc = await UserModel.findById(clientId).select('isActive email nombre apellido');
            if (!clientDoc) {
                throw new ApiError(StatusCodes.BAD_REQUEST, 'Usuario (cliente) no encontrado');
            }
            if (clientDoc.isActive === false) {
                throw new ApiError(StatusCodes.BAD_REQUEST, 'El cliente está inactivo');
            }
            clientIdToSave = new mongoose.Types.ObjectId(clientId);
        }
        const appointment = await AppointmentModel.create({
            stylist: stylistId,
            services: uniqueServiceIds,
            start: startDate,
            end: endDate,
            status: status || 'PENDIENTE',
            clientId: clientIdToSave,
            clientName: clientName || undefined,
            clientPhone: clientPhone || undefined,
            notes: notes || undefined
        });
        await appointment.populate([
            { path: 'stylist', select: 'nombre apellido email' },
            { path: 'services', select: 'nombre duracionMin precio' },
            { path: 'clientId', select: 'nombre apellido email' }
        ]);
        // ✅ Email en hora Ecuador
        const fechaTexto = formatEC(startDate);
        const serviciosTexto = services
            .map((s) => `${s.nombre} (${s.duracionMin} min)`)
            .join(', ');
        const clienteNombreParaMail = clientName ||
            (clientDoc ? `${clientDoc.nombre} ${clientDoc.apellido}` : 'Cliente');
        // Estilista
        if (stylist.email) {
            const bodyStylist = `Tienes una nueva CITA MANUAL.\n\n` +
                `Cliente: ${clienteNombreParaMail}\n` +
                `Fecha y hora: ${fechaTexto}\n` +
                `Servicios: ${serviciosTexto}\n\n` +
                `Notas: ${notes || 'Sin notas adicionales.'}`;
            await sendEmail(stylist.email, 'Nueva cita manual registrada', bodyStylist);
        }
        // Cliente
        const emailCliente = (clientDoc && clientDoc.email) ? clientDoc.email : null;
        if (emailCliente) {
            const bodyClient = `Tu cita ha sido registrada.\n\n` +
                `Estilista: ${stylist.nombre} ${stylist.apellido}\n` +
                `Fecha y hora: ${fechaTexto}\n` +
                `Servicios: ${serviciosTexto}\n\n` +
                `Notas: ${notes || 'Sin notas adicionales.'}`;
            await sendEmail(emailCliente, 'Confirmación de cita', bodyClient);
        }
        res.status(StatusCodes.CREATED).json(appointment);
    }
    catch (err) {
        next(err);
    }
}
// ---------------------------------------------------------------------
// LISTAR CITAS MANUALES
// ---------------------------------------------------------------------
export async function listAppointments(req, res, next) {
    try {
        const { stylistId, serviceId, status, from, to } = req.query;
        const page = Number(req.query.page ?? 1);
        const limit = Number(req.query.limit ?? 20);
        const filter = {};
        if (stylistId && mongoose.isValidObjectId(stylistId))
            filter.stylist = stylistId;
        if (serviceId && mongoose.isValidObjectId(serviceId))
            filter.services = serviceId;
        if (status)
            filter.status = status;
        if (from || to) {
            filter.start = {};
            if (from)
                filter.start.$gte = parseDateTime(String(from));
            if (to)
                filter.start.$lte = parseDateTime(String(to));
        }
        const query = AppointmentModel.find(filter)
            .sort({ start: 1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .populate('stylist', 'nombre apellido')
            .populate('services', 'nombre duracionMin precio')
            .populate('clientId', 'nombre apellido email');
        const [data, total] = await Promise.all([
            query,
            AppointmentModel.countDocuments(filter)
        ]);
        res.json({ data, meta: { page, limit, total } });
    }
    catch (err) {
        next(err);
    }
}
// ---------------------------------------------------------------------
// VER UNA CITA MANUAL
// ---------------------------------------------------------------------
export async function getAppointment(req, res, next) {
    try {
        const app = await AppointmentModel.findById(req.params.id)
            .populate('stylist', 'nombre apellido')
            .populate('services', 'nombre duracionMin precio')
            .populate('clientId', 'nombre apellido email');
        if (!app)
            throw new ApiError(StatusCodes.NOT_FOUND, 'Cita no encontrada');
        res.json(app);
    }
    catch (err) {
        next(err);
    }
}
// ---------------------------------------------------------------------
// ACTUALIZAR CITA MANUAL
// ---------------------------------------------------------------------
export async function updateAppointment(req, res, next) {
    try {
        const { id } = req.params;
        const app = await AppointmentModel.findById(id);
        if (!app)
            throw new ApiError(StatusCodes.NOT_FOUND, 'Cita no encontrada');
        if (req.user?.role === ROLES.ESTILISTA && !app.stylist.equals(req.user.id)) {
            throw new ApiError(StatusCodes.FORBIDDEN, 'No autorizado');
        }
        let startDate = app.start;
        let endDate = app.end;
        // ✅ Ecuador
        if (req.body.start)
            startDate = parseDateTime(req.body.start);
        if (req.body.end)
            endDate = parseDateTime(req.body.end);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Fechas inválidas');
        }
        if (endDate <= startDate) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'La hora de fin debe ser mayor que la de inicio');
        }
        if (!isValid30Step(startDate) || !isValid30Step(endDate)) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Las horas deben estar en intervalos de 30 minutos (hh:00 o hh:30)');
        }
        const services = await ServiceModel.find({
            _id: { $in: app.services },
            activo: true
        }).lean();
        if (!services.length || services.length !== app.services.length) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Uno o más servicios de la cita ya no existen o están inactivos');
        }
        const minutes = diffMinutes(startDate, endDate);
        const totalDuration = services.reduce((acc, s) => acc + (s.duracionMin || 0), 0);
        if (minutes !== totalDuration) {
            throw new ApiError(StatusCodes.BAD_REQUEST, `La duración de la cita (${minutes} min) debe coincidir con la suma de los servicios (${totalDuration} min)`);
        }
        if (minutes % 30 !== 0) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'La duración de la cita debe ser múltiplo de 30 minutos');
        }
        await ensureNoOverlap(String(app.stylist), startDate, endDate, id);
        app.start = startDate;
        app.end = endDate;
        if (typeof req.body.status === 'string')
            app.status = req.body.status;
        if (typeof req.body.clientId !== 'undefined') {
            if (req.body.clientId) {
                if (!mongoose.isValidObjectId(req.body.clientId)) {
                    throw new ApiError(StatusCodes.BAD_REQUEST, 'clientId inválido');
                }
                const client = await UserModel.findById(req.body.clientId).select('isActive');
                if (!client)
                    throw new ApiError(StatusCodes.BAD_REQUEST, 'Usuario (cliente) no encontrado');
                if (client.isActive === false)
                    throw new ApiError(StatusCodes.BAD_REQUEST, 'El cliente está inactivo');
                app.clientId = new mongoose.Types.ObjectId(req.body.clientId);
            }
            else {
                app.clientId = null;
            }
        }
        if (typeof req.body.clientName !== 'undefined')
            app.clientName = req.body.clientName || undefined;
        if (typeof req.body.clientPhone !== 'undefined')
            app.clientPhone = req.body.clientPhone || undefined;
        if (typeof req.body.notes !== 'undefined')
            app.notes = req.body.notes || undefined;
        await app.save();
        await app.populate([
            { path: 'stylist', select: 'nombre apellido' },
            { path: 'services', select: 'nombre duracionMin precio' },
            { path: 'clientId', select: 'nombre apellido email' }
        ]);
        res.json(app);
    }
    catch (err) {
        next(err);
    }
}
// ---------------------------------------------------------------------
// CANCELAR CITA MANUAL  ✅ ESTA ES LA QUE TE FALTA
// ---------------------------------------------------------------------
export async function cancelAppointment(req, res, next) {
    try {
        const { id } = req.params;
        const app = await AppointmentModel.findById(id);
        if (!app)
            throw new ApiError(StatusCodes.NOT_FOUND, 'Cita no encontrada');
        if (req.user?.role === ROLES.ESTILISTA && !app.stylist.equals(req.user.id)) {
            throw new ApiError(StatusCodes.FORBIDDEN, 'No autorizado');
        }
        app.status = 'CANCELADA';
        await app.save();
        res.json({ message: 'Cita cancelada' });
    }
    catch (err) {
        next(err);
    }
}
