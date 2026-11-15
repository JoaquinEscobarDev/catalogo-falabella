const couponService = require('../services/couponService');
const asyncHandler = require('./asyncHandler');

const list = asyncHandler(async (req, res) => {
  res.json(await couponService.listAll());
});

const create = asyncHandler(async (req, res) => {
  const id = await couponService.create(req.body || {});
  res.json({ ok: true, id });
});

const remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido' });
  await couponService.remove(id);
  res.json({ ok: true });
});

const productos = asyncHandler(async (req, res) => {
  const id = req.query.id ? parseInt(req.query.id, 10) : null;
  const clave = req.query.clave ? String(req.query.clave) : null;
  if (!id && !clave) return res.status(400).json({ error: 'Falta el cupón' });
  res.json(await couponService.productosDeCupon({ id, clave }));
});

module.exports = { list, create, remove, productos };
