import mongoose, { Schema } from 'mongoose';
const PasswordResetTokenSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
    lastSentAt: Date
}, { timestamps: true });
export const PasswordResetTokenModel = mongoose.model('PasswordResetToken', PasswordResetTokenSchema);
