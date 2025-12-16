import mongoose, { Schema } from 'mongoose';
const AppointmentSchema = new Schema({
    stylist: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // 🔥 ahora es un arreglo de servicios
    services: [{
            type: Schema.Types.ObjectId,
            ref: 'Service',
            required: true
        }],
    start: { type: Date, required: true, index: true },
    end: { type: Date, required: true, index: true },
    status: {
        type: String,
        enum: ['PENDIENTE', 'CONFIRMADA', 'CANCELADA', 'COMPLETADA'],
        default: 'PENDIENTE',
        index: true
    },
    // 🔥 referencia al usuario (cliente) opcional
    clientId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    clientName: { type: String },
    clientPhone: { type: String },
    notes: { type: String }
}, { timestamps: true });
AppointmentSchema.index({ stylist: 1, start: 1, end: 1 });
export const AppointmentModel = mongoose.model('Appointment', AppointmentSchema);
