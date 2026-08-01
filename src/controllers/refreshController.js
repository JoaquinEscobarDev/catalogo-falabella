const refreshService = require('../services/refreshService');
const asyncHandler = require('./asyncHandler');

const solicitar = asyncHandler(async (req, res) => {
  const { categoria } = req.body;
  if (!categoria) return res.status(400).json({ error: 'Falta la categoría' });
  const id = await refreshService.solicitar(categoria);
  res.json({ ok: true, id });
});

const estado = asyncHandler(async (req, res) => {
  const procesado = await refreshService.estado(req.params.id);
  res.json({ procesado });
});

module.exports = { solicitar, estado };
