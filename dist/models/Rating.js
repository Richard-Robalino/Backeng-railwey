import mongoose, { Schema } from 'mongoose';
const RatingSchema = new Schema({
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
    clienteId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    estilistaId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    estrellas: { type: Number, min: 1, max: 5, required: true },
    comentario: { type: String, maxlength: 70 }
}, { timestamps: true });
export const RatingModel = mongoose.model('Rating', RatingSchema);
