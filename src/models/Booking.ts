import mongoose, { Schema, Document, Model } from 'mongoose';
import { BookingStatus } from '../constants/statuses.js';

export type PaymentStatus = 'UNPAID' | 'PAID';
export type PaymentMethod = 'CARD' | 'TRANSFER_PICHINCHA';

export interface IBooking extends Document {
  clienteId: mongoose.Types.ObjectId;
  estilistaId: mongoose.Types.ObjectId;
  servicioId: mongoose.Types.ObjectId;
  inicio: Date;
  fin: Date;
  estado: BookingStatus;
  notas?: string;
  precio?: number;
  reminder30Sent?: boolean;
  creadoPor: mongoose.Types.ObjectId;
  actualizadoPor?: mongoose.Types.ObjectId;

  // ✅ NUEVO: null = no definido todavía, true/false cuando el estilista finaliza
  clienteAsistio: boolean | null;

  // 🔥 CAMPOS DE PAGO
  paymentStatus?: PaymentStatus;
  paymentMethod?: PaymentMethod;
  paidAt?: Date | null;
  invoiceNumber?: string | null;
}

const BookingSchema = new Schema<IBooking>(
  {
    clienteId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    estilistaId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    servicioId: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    inicio: { type: Date, required: true, index: true },
    fin: { type: Date, required: true, index: true },

    estado: { type: String, required: true },
    notas: String,
    precio: Number,
    reminder30Sent: { type: Boolean, default: false },
    creadoPor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actualizadoPor: { type: Schema.Types.ObjectId, ref: 'User' },

    // ✅ NUEVO CAMPO (asistencia)
    clienteAsistio: { type: Boolean, default: null },

    // 🔥 CAMPOS DE PAGO
    paymentStatus: {
      type: String,
      enum: ['UNPAID', 'PAID'],
      default: 'UNPAID'
    },
    paymentMethod: {
      type: String,
      enum: ['CARD', 'TRANSFER_PICHINCHA'],
      default: undefined
    },
    paidAt: { type: Date, default: null },
    invoiceNumber: { type: String, default: null }
  },
  { timestamps: true }
);

// Prevent overlapping appointments
BookingSchema.index({ estilistaId: 1, inicio: 1, fin: 1 });
BookingSchema.index({ clienteId: 1, inicio: 1, fin: 1 });

export const BookingModel: Model<IBooking> =
  mongoose.model<IBooking>('Booking', BookingSchema);
