import mongoose, { Schema } from 'mongoose';
const ServiceSlotSchema = new Schema({
    stylist: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    service: {
        type: Schema.Types.ObjectId,
        ref: 'Service',
        required: true,
        index: true
    },
    dayOfWeek: {
        type: String,
        enum: ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'],
        required: true,
        index: true
    },
    startMin: {
        type: Number,
        required: true
    },
    endMin: {
        type: Number,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});
// Un estilista no puede tener dos slots que se crucen en el mismo día
ServiceSlotSchema.index({ stylist: 1, dayOfWeek: 1, startMin: 1, endMin: 1 });
export const ServiceSlotModel = mongoose.model('ServiceSlot', ServiceSlotSchema);
