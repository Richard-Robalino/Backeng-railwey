import mongoose, { Schema } from 'mongoose';
const EmailVerificationTokenSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    lastSentAt: Date
}, { timestamps: true });
export const EmailVerificationTokenModel = mongoose.model('EmailVerificationToken', EmailVerificationTokenSchema);
