import mongoose, { Schema, Document, Model } from 'mongoose';
import { PaymentMethod } from './Booking.js';

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED';

export interface IPayment extends Document {
  bookingId: mongoose.Types.ObjectId;
  amount: number;
  currency: 'USD';
  method: PaymentMethod;
  status: PaymentStatus;
  transactionRef?: string;
  cardBrand?: string;
  cardLast4?: string;
  createdBy: mongoose.Types.ObjectId;

  // ✅ NUEVO: comprobante transferencia
  transferProofPath?: string;
  transferProofUrl?: string;
  transferProofUploadedAt?: Date;
  transferProofUploadedBy?: mongoose.Types.ObjectId;
}

const PaymentSchema = new Schema<IPayment>({
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'USD' },
  method: { type: String, enum: ['CARD', 'TRANSFER_PICHINCHA'], required: true },
  status: { type: String, enum: ['PENDING', 'PAID', 'FAILED'], default: 'PENDING' },
  transactionRef: { type: String },
  cardBrand: { type: String },
  cardLast4: { type: String },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },

  // ✅ NUEVO
  transferProofPath: { type: String },
  transferProofUrl: { type: String },
  transferProofUploadedAt: { type: Date },
  transferProofUploadedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

PaymentSchema.index({ bookingId: 1, status: 1 });
PaymentSchema.index({ transferProofUploadedAt: -1 });

export const PaymentModel: Model<IPayment> =
  mongoose.model<IPayment>('Payment', PaymentSchema);
