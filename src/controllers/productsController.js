const productService = require('../services/productService');
const asyncHandler = require('./asyncHandler');

const list = asyncHandler(async (req, res) => {
  res.json(await productService.listAll());
});

const create = asyncHandler(async (req, res) => {
  const { sku, alias, categoria } = req.body;
  if (!sku) return res.status(400).json({ error: 'SKU requerido' });
  await productService.create(sku.trim(), alias, categoria);
  res.json({ ok: true });
});

const remove = asyncHandler(async (req, res) => {
  await productService.remove(req.params.sku);
  res.json({ ok: true });
});

const findByCategory = asyncHandler(async (req, res) => {
  res.json(await productService.findByCategory(req.params.nombre));
});

const getProducto = asyncHandler(async (req, res) => {
  const producto = await productService.getProducto(req.params.sku, { force: req.query.force === '1' });
  res.json(producto);
});

const search = asyncHandler(async (req, res) => {
  res.json(await productService.search(req.query.q || ''));
});

module.exports = { list, create, remove, findByCategory, getProducto, search };
