import mongoose, { Schema } from 'mongoose';
const StylistScheduleSchema = new Schema({
    stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    dayOfWeek: { type: Number, min: 0, max: 6, required: true },
    slots: [{ start: { type: String, required: true }, end: { type: String, required: true } }],
    exceptions: [{
            date: { type: String, required: true },
            closed: { type: Boolean, default: false },
            blocks: [{ start: String, end: String }]
        }]
}, { timestamps: true });
StylistScheduleSchema.index({ stylistId: 1, dayOfWeek: 1 }, { unique: true });
export const StylistScheduleModel = mongoose.model('StylistSchedule', StylistScheduleSchema);
