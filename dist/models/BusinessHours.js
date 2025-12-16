import mongoose, { Schema } from 'mongoose';
const BusinessHoursSchema = new Schema({
    days: [{
            dayOfWeek: { type: Number, min: 0, max: 6, required: true },
            open: { type: String, required: true },
            close: { type: String, required: true }
        }],
    exceptions: [{
            date: { type: String, required: true },
            closed: Boolean,
            open: String,
            close: String
        }]
}, { timestamps: true });
export const BusinessHoursModel = mongoose.model('BusinessHours', BusinessHoursSchema);
