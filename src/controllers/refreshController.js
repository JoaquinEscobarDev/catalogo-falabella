const refreshService = require('../services/refreshService');
const asyncHandler = require('./asyncHandler');

const solicitar = asyncHandler(async (req, res) => {
  const { categoria } = req.body;
  if (!categoria) return res.status(400).json({ error: 'Falta la categoría' });
  const id = await refreshService.solicitar(categoria);
  res.json({ ok: true, id });
});

const estado = asyncHandler(async (req, res) => {
  res.json(await refreshService.estado(req.params.id));
});

const solicitarTotal = asyncHandler(async (req, res) => {
  refreshService.solicitarTotal();
  res.status(202).json({ ok: true });
});

const resumen = asyncHandler(async (req, res) => {
  res.json(await refreshService.resumen());
});

module.exports = { solicitar, estado, solicitarTotal, resumen };
