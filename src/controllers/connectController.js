const connectService = require('../services/connectService');
const asyncHandler = require('./asyncHandler');

function idValido(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'Id inválido' }); return null; }
  return id;
}

const listarPlanes = asyncHandler(async (req, res) => {
  res.json(await connectService.listarPlanes());
});

const crearPlan = asyncHandler(async (req, res) => {
  res.json({ ok: true, id: await connectService.crearPlan(req.body || {}) });
});

const eliminarPlan = asyncHandler(async (req, res) => {
  const id = idValido(req, res);
  if (id === null) return;
  await connectService.eliminarPlan(id);
  res.json({ ok: true });
});

const listarVentas = asyncHandler(async (req, res) => {
  res.json(await connectService.listarVentas(req.query.mes));
});

const crearVenta = asyncHandler(async (req, res) => {
  res.json({ ok: true, id: await connectService.crearVenta(req.body || {}) });
});

const eliminarVenta = asyncHandler(async (req, res) => {
  const id = idValido(req, res);
  if (id === null) return;
  await connectService.eliminarVenta(id);
  res.json({ ok: true });
});

const csvVentas = asyncHandler(async (req, res) => {
  const datos = await connectService.listarVentas(req.query.mes);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="ventas-connect-${datos.mes}.csv"`);
  res.send(connectService.csvVentas(datos));
});

module.exports = { listarPlanes, crearPlan, eliminarPlan, listarVentas, crearVenta, eliminarVenta, csvVentas };
