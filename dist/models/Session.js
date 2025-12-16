import mongoose, { Schema } from 'mongoose';
const SessionSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    lastActivityAt: { type: Date, default: () => new Date() },
    revoked: { type: Boolean, default: false }
}, { timestamps: true });
export const SessionModel = mongoose.model('Session', SessionSchema);
