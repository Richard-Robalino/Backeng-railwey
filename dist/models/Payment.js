import mongoose, { Schema } from 'mongoose';
const PaymentSchema = new Schema({
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
export const PaymentModel = mongoose.model('Payment', PaymentSchema);
