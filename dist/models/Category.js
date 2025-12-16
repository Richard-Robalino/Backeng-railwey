import mongoose, { Schema } from 'mongoose';
const CategorySchema = new Schema({
    nombre: { type: String, required: true, trim: true, unique: true },
    descripcion: { type: String, trim: true },
    activo: { type: Boolean, default: true },
    services: [{ type: Schema.Types.ObjectId, ref: 'Service', default: [] }]
}, { timestamps: true });
export const CategoryModel = mongoose.model('Category', CategorySchema);
