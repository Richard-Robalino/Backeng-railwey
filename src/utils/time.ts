import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import isBetween from 'dayjs/plugin/isBetween.js';
import timezone from 'dayjs/plugin/timezone.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(utc as any);
dayjs.extend(isBetween as any);
dayjs.extend(timezone as any);
dayjs.extend(customParseFormat as any);

export const APP_TZ = process.env.APP_TZ || process.env.TZ || 'America/Guayaquil';
dayjs.tz.setDefault(APP_TZ);

// Para fechas "YYYY-MM-DD" (medianoche Ecuador)
export function dayStart(dateStr: string): Date {
  return dayjs.tz(dateStr, 'YYYY-MM-DD', APP_TZ).startOf('day').toDate();
}

export function dayEnd(dateStr: string): Date {
  return dayjs.tz(dateStr, 'YYYY-MM-DD', APP_TZ).startOf('day').add(1, 'day').toDate();
}

// Construye un Date desde fecha + minutos desde medianoche, pero en Ecuador
export function buildDateTimeForSlot(dateStr: string, minutesFromMidnight: number): Date {
  return dayjs.tz(dateStr, 'YYYY-MM-DD', APP_TZ).startOf('day').add(minutesFromMidnight, 'minute').toDate();
}

// Parser: si viene con Z / offset, respétalo; si NO, asúmelo Ecuador
export function parseDateTime(input: string): Date {
  const hasZone = /([zZ]|[+-]\d{2}:\d{2})$/.test(input);
  if (hasZone) return dayjs(input).toDate();

  const formats = ['YYYY-MM-DDTHH:mm:ss.SSS', 'YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DDTHH:mm', 'YYYY-MM-DD HH:mm', 'YYYY-MM-DD'];
  for (const f of formats) {
    const d = dayjs.tz(input, f, APP_TZ);
    if (d.isValid()) return d.toDate();
  }

  const fallback = dayjs.tz(input, APP_TZ);
  if (fallback.isValid()) return fallback.toDate();

  return new Date(''); // inválida, tu controlador ya valida isNaN
}

export function formatEC(date: Date): string {
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: APP_TZ,
    dateStyle: 'full',
    timeStyle: 'short'
  }).format(date);
}

export { dayjs };
