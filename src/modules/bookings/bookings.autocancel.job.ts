import { BookingModel } from '../../models/Booking.js';
import { BOOKING_STATUS } from '../../constants/statuses.js';
import { UserModel } from '../../models/User.js';
import { sendEmail } from '../../utils/email.js';
import { formatEC } from '../../utils/time.js';

// ✅ Se cancela automáticamente 10 minutos después de la hora de la cita
const AUTO_CANCEL_AFTER_MINUTES = 10;

// Cancela bookings pendientes cuyo inicio ya pasó + 10 minutos
export async function autoCancelUnconfirmedBookings() {
  const now = new Date();

  // threshold = ahora - 10 min  => cancela si inicio <= threshold
  const threshold = new Date(now.getTime() - AUTO_CANCEL_AFTER_MINUTES * 60 * 1000);

  const pending = await BookingModel.find({
    estado: BOOKING_STATUS.PENDING_STYLIST_CONFIRMATION,
    inicio: { $lte: threshold }
  });

  if (!pending.length) return { cancelled: 0 };

  for (const b of pending) {
    b.estado = BOOKING_STATUS.CANCELLED;
    b.notas =
      (b.notas ?? '') +
      `\nAUTO_CANCEL: no confirmada por estilista después de ${AUTO_CANCEL_AFTER_MINUTES} min.`;
    await b.save();

    const fechaTexto = formatEC(b.inicio);

    // Email cliente
    if (b.clienteId) {
      const client = await UserModel.findById(b.clienteId).select('email');
      if (client?.email) {
        await sendEmail(
          client.email,
          'Reserva cancelada automáticamente',
          `Tu reserva fue cancelada automáticamente porque el estilista no la confirmó dentro de ${AUTO_CANCEL_AFTER_MINUTES} minutos.\n\nFecha y hora: ${fechaTexto}\nID: ${b.id}`
        );
      }
    }

    // Email estilista
    const stylist = await UserModel.findById(b.estilistaId).select('email');
    if (stylist?.email) {
      await sendEmail(
        stylist.email,
        'Reserva auto-cancelada',
        `Una reserva pendiente fue cancelada automáticamente por falta de confirmación dentro de ${AUTO_CANCEL_AFTER_MINUTES} minutos.\n\nFecha y hora: ${fechaTexto}\nID: ${b.id}`
      );
    }
  }

  return { cancelled: pending.length };
}

// Job simple (cada 1 minuto)
export function startBookingAutoCancelJob() {
  setInterval(() => {
    autoCancelUnconfirmedBookings().catch(() => {
      // evitar que el servidor caiga si falla el job
    });
  }, 60_000);
}
