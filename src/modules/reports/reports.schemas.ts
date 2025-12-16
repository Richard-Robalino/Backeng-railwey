import Joi from 'joi';

const objectId = Joi.string().length(24).hex().message('ID inválido');

export const reportsRangeQuery = Joi.object({
  // ✅ requerido SIEMPRE
  from: Joi.string().required().messages({
    'any.required': 'from es requerido (YYYY-MM-DD)',
    'string.base': 'from debe ser string'
  }),
  to: Joi.string().required().messages({
    'any.required': 'to es requerido (YYYY-MM-DD)',
    'string.base': 'to debe ser string'
  }),

  // opcional: filtrar un estilista
  stylistId: objectId.optional()
});