import mongoose from 'mongoose';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

import { ServiceSlotModel } from '../../models/ServiceSlot.js';
import { BookingModel } from '../../models/Booking.js';
import { BOOKING_STATUS } from '../../constants/statuses.js';

dayjs.extend(utc as any);
dayjs.extend(timezone as any);
dayjs.extend(customParseFormat as any);

const APP_TZ = process.env.APP_TZ || process.env.TZ || 'America/Guayaquil';
dayjs.tz.setDefault(APP_TZ);

const WEEKDAYS = [
  'DOMINGO',
  'LUNES',
  'MARTES',
  'MIERCOLES',
  'JUEVES',
  'VIERNES',
  'SABADO'
] as const;

const ACTIVE_STATES = [
  BOOKING_STATUS.SCHEDULED,
  BOOKING_STATUS.CONFIRMED,
  BOOKING_STATUS.IN_PROGRESS,
  BOOKING_STATUS.PENDING_STYLIST_CONFIRMATION
];

function getDayLabelEC(dateStr: string): string {
  const d = dayjs.tz(dateStr, 'YYYY-MM-DD', APP_TZ);
  if (!d.isValid()) return '';
  return WEEKDAYS[d.day()];
}

function buildDateTimeForSlotEC(dateStr: string, minutesFromMidnight: number): Date {
  const base = dayjs.tz(dateStr, 'YYYY-MM-DD', APP_TZ).startOf('day');
  return base.add(minutesFromMidnight, 'minute').toDate();
}

/**
 * Calcula la disponibilidad de un servicio usando los slots
 * date: "YYYY-MM-DD"
 */
export async function computeAvailability(
  dateStr: string,
  serviceId: string,
  stylistId?: string
) {
  if (!mongoose.isValidObjectId(serviceId)) return [];

  const day = dayjs.tz(dateStr, 'YYYY-MM-DD', APP_TZ);
  if (!day.isValid()) return [];

  const dayLabel = getDayLabelEC(dateStr);
  if (!dayLabel) return [];

  const slotFilter: any = {
    service: serviceId,
    dayOfWeek: dayLabel,
    isActive: true
  };
  if (stylistId && mongoose.isValidObjectId(stylistId)) {
    slotFilter.stylist = stylistId;
  }

  const slots: any[] = await ServiceSlotModel.find(slotFilter)
    .populate('stylist', 'nombre apellido')
    .sort({ startMin: 1 });

  if (!slots.length) return [];

  const stylistIds = Array.from(
    new Set(slots.map(s => s.stylist?._id?.toString()).filter(Boolean))
  );

  // ✅ Rango del “día” definido en Ecuador (00:00 a 00:00 del día siguiente en Ecuador)
  const dayStart = day.startOf('day').toDate();
  const dayEnd = day.startOf('day').add(1, 'day').toDate();

  // Citas ya reservadas ese día para esos estilistas
  const busy = await BookingModel.find({
    estilistaId: { $in: stylistIds },
    inicio: { $lt: dayEnd, $gte: dayStart },
    estado: { $in: ACTIVE_STATES }
  }).select('estilistaId inicio fin');

  const busyByStylist = new Map<string, { start: Date; end: Date }[]>();
  for (const b of busy) {
    const key = b.estilistaId.toString();
    if (!busyByStylist.has(key)) busyByStylist.set(key, []);
    busyByStylist.get(key)!.push({ start: b.inicio, end: b.fin });
  }

  const result: {
    slotId: string;
    stylistId: string;
    stylistName: string;
    start: string;
    end: string;
  }[] = [];

  for (const slot of slots) {
    if (!slot.stylist?._id) continue;

    const sDate = buildDateTimeForSlotEC(dateStr, slot.startMin);
    const eDate = buildDateTimeForSlotEC(dateStr, slot.endMin);

    const key = slot.stylist._id.toString();
    const busyList = busyByStylist.get(key) || [];
    const taken = busyList.some(b => b.start < eDate && b.end > sDate);

    if (!taken) {
      result.push({
        slotId: slot._id.toString(),
        stylistId: key,
        stylistName: `${slot.stylist.nombre || ''} ${slot.stylist.apellido || ''}`.trim(),
        // ISO en UTC (Z). El frontend lo puede mostrar en -05:00 sin problemas.
        start: sDate.toISOString(),
        end: eDate.toISOString()
      });
    }
  }

  return result;
}
