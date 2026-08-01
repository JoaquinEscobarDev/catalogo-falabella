const todoService = require('../services/todoService');
const asyncHandler = require('./asyncHandler');

const list = asyncHandler(async (req, res) => {
  res.json(await todoService.listAll());
});

const upsert = asyncHandler(async (req, res) => {
  const { sku, size, quantity } = req.body;
  if (!sku) return res.status(400).json({ error: 'SKU requerido' });
  await todoService.upsert(sku, size, quantity);
  res.json({ ok: true });
});

const remove = asyncHandler(async (req, res) => {
  await todoService.remove(req.params.sku);
  res.json({ ok: true });
});

const clear = asyncHandler(async (req, res) => {
  await todoService.clear();
  res.json({ ok: true });
});

module.exports = { list, upsert, remove, clear };
