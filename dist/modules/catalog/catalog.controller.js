import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../../middlewares/errorHandler.js';
import { CategoryModel } from '../../models/Category.js';
import { ServiceModel } from '../../models/Service.js';
import mongoose from 'mongoose';
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
export async function createCategory(req, res, next) {
    try {
        const { nombre, descripcion, imageUrl, activo, services } = req.body;
        // Dedupe defensivo (además de Joi.unique)
        const uniqueServices = Array.from(new Set(services || []));
        // Verificar que TODOS existen y están activos
        if (uniqueServices.length) {
            const count = await ServiceModel.countDocuments({ _id: { $in: uniqueServices }, activo: true });
            if (count !== uniqueServices.length) {
                throw new ApiError(StatusCodes.BAD_REQUEST, 'Uno o más services no existen o están inactivos');
            }
        }
        // Nombre único (case-insensitive)
        const clash = await CategoryModel.findOne({
            nombre: { $regex: `^${escapeRegExp(nombre.trim())}$`, $options: 'i' }
        });
        if (clash)
            throw new ApiError(StatusCodes.CONFLICT, 'Ya existe una categoría con ese nombre');
        const cat = await CategoryModel.create({
            nombre: nombre.trim(),
            descripcion: descripcion?.trim(),
            imageUrl,
            activo: typeof activo === 'boolean' ? activo : true,
            services: uniqueServices.map(id => new mongoose.Types.ObjectId(id))
        });
        res.status(StatusCodes.CREATED).json(cat);
    }
    catch (err) {
        if (err?.code === 11000)
            return next(new ApiError(StatusCodes.CONFLICT, 'Nombre de categoría ya existe'));
        next(err);
    }
}
export async function listCategories(req, res, next) {
    try {
        const { q, active, includeServices } = req.query;
        const page = Number(req.query.page ?? 1);
        const limit = Number(req.query.limit ?? 20);
        const filter = {};
        if (q)
            filter.nombre = { $regex: String(q), $options: 'i' };
        if (typeof active !== 'undefined')
            filter.activo = active === 'true' || active === true;
        const query = CategoryModel.find(filter).sort({ nombre: 1 }).skip((page - 1) * limit).limit(limit);
        if (String(includeServices) === 'true')
            query.populate('services', 'nombre precio duracionMin activo');
        const [data, total] = await Promise.all([query, CategoryModel.countDocuments(filter)]);
        res.json({ data, meta: { page, limit, total } });
    }
    catch (err) {
        next(err);
    }
}
export async function getCategory(req, res, next) {
    try {
        const c = await CategoryModel.findById(req.params.id).populate('services', 'nombre precio duracionMin activo');
        if (!c)
            throw new ApiError(StatusCodes.NOT_FOUND, 'Categoría no encontrada');
        res.json(c);
    }
    catch (err) {
        next(err);
    }
}
export async function updateCategory(req, res, next) {
    try {
        const updates = {};
        if (typeof req.body.nombre === 'string') {
            const nuevo = req.body.nombre.trim();
            // validar formato ya lo hace Joi; aquí solo clash (case-insensitive, distinto _id)
            const clash = await CategoryModel.findOne({
                _id: { $ne: req.params.id },
                nombre: { $regex: `^${escapeRegExp(nuevo)}$`, $options: 'i' }
            });
            if (clash)
                throw new ApiError(StatusCodes.CONFLICT, 'Ya existe una categoría con ese nombre');
            updates.nombre = nuevo;
        }
        if (typeof req.body.descripcion !== 'undefined')
            updates.descripcion = req.body.descripcion?.trim() || '';
        if (typeof req.body.imageUrl !== 'undefined')
            updates.imageUrl = req.body.imageUrl || null;
        if (typeof req.body.activo === 'boolean')
            updates.activo = req.body.activo;
        const c = await CategoryModel.findByIdAndUpdate(req.params.id, updates, { new: true });
        if (!c)
            throw new ApiError(StatusCodes.NOT_FOUND, 'Categoría no encontrada');
        res.json(c);
    }
    catch (err) {
        if (err?.code === 11000)
            return next(new ApiError(StatusCodes.CONFLICT, 'Nombre de categoría ya existe'));
        next(err);
    }
}
export async function deleteCategory(req, res, next) {
    try {
        const c = await CategoryModel.findByIdAndDelete(req.params.id);
        if (!c)
            throw new ApiError(StatusCodes.NOT_FOUND, 'Categoría no encontrada');
        res.json({ message: 'Categoría eliminada definitivamente' });
    }
    catch (err) {
        next(err);
    }
}
// Reemplazar TODO el set de servicios
export async function replaceCategoryServices(req, res, next) {
    try {
        const incoming = (req.body.services || []);
        const unique = Array.from(new Set(incoming));
        const count = await ServiceModel.countDocuments({ _id: { $in: unique }, activo: true });
        if (count !== unique.length)
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Servicios inválidos o inactivos');
        const c = await CategoryModel.findByIdAndUpdate(req.params.id, { services: unique.map(id => new mongoose.Types.ObjectId(id)) }, { new: true }).populate('services', 'nombre precio duracionMin activo');
        if (!c)
            throw new ApiError(StatusCodes.NOT_FOUND, 'Categoría no encontrada');
        res.json(c);
    }
    catch (err) {
        next(err);
    }
}
export async function addCategoryServices(req, res, next) {
    try {
        const incoming = (req.body.services || []);
        const unique = Array.from(new Set(incoming));
        const valid = await ServiceModel.find({ _id: { $in: unique }, activo: true }).select('_id').lean();
        if (!valid.length)
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Servicios inválidos o inactivos');
        const c = await CategoryModel.findById(req.params.id);
        if (!c)
            throw new ApiError(StatusCodes.NOT_FOUND, 'Categoría no encontrada');
        const existing = new Set(c.services.map(s => s.toString()));
        for (const { _id } of valid)
            existing.add(_id.toString());
        c.services = Array.from(existing).map(id => new mongoose.Types.ObjectId(id));
        await c.save();
        await c.populate('services', 'nombre precio duracionMin activo');
        res.json(c);
    }
    catch (err) {
        next(err);
    }
}
export async function removeCategoryServices(req, res, next) {
    try {
        const incoming = (req.body.services || []);
        const removeSet = new Set(incoming.map(String));
        const c = await CategoryModel.findById(req.params.id);
        if (!c)
            throw new ApiError(StatusCodes.NOT_FOUND, 'Categoría no encontrada');
        const before = c.services.length;
        c.services = c.services.filter(s => !removeSet.has(s.toString()));
        if (c.services.length === before) {
            // nada para quitar
            return res.status(StatusCodes.OK).json(c);
        }
        await c.save();
        await c.populate('services', 'nombre precio duracionMin activo');
        res.json(c);
    }
    catch (err) {
        next(err);
    }
}
export async function listCategoryServices(req, res, next) {
    try {
        const c = await CategoryModel.findById(req.params.id).populate('services', 'nombre precio duracionMin activo');
        if (!c)
            throw new ApiError(StatusCodes.NOT_FOUND, 'Categoría no encontrada');
        res.json(c.services);
    }
    catch (err) {
        next(err);
    }
}
export async function activateCategory(req, res, next) {
    try {
        const c = await CategoryModel.findByIdAndUpdate(req.params.id, { activo: true }, { new: true });
        if (!c)
            throw new ApiError(StatusCodes.NOT_FOUND, 'Categoría no encontrada');
        res.json({ message: 'Categoría activada', category: c });
    }
    catch (err) {
        next(err);
    }
}
export async function deactivateCategory(req, res, next) {
    try {
        const c = await CategoryModel.findByIdAndUpdate(req.params.id, { activo: false }, { new: true });
        if (!c)
            throw new ApiError(StatusCodes.NOT_FOUND, 'Categoría no encontrada');
        res.json({ message: 'Categoría desactivada', category: c });
    }
    catch (err) {
        next(err);
    }
}
