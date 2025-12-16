import mongoose, { Schema } from 'mongoose';
const NotificationSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['EMAIL', 'SYSTEM'], default: 'EMAIL' },
    title: { type: String, required: true },
    message: { type: String, required: true },
    sentAt: { type: Date, default: () => new Date() }
}, { timestamps: true });
export const NotificationModel = mongoose.model('Notification', NotificationSchema);
