const refreshService = require('../services/refreshService');
const asyncHandler = require('./asyncHandler');
const scraperService = require('../services/scraperService');
const productsRepository = require('../repositories/productsRepository');

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

// Prueba en vivo la conexión del servidor con Falabella (tarda ~30 s).
let diagnosticoEnCurso = null;
const diagnostico = asyncHandler(async (req, res) => {
  const sku = /^\d{5,12}$/.test(req.query.sku || '') ? req.query.sku : (await productsRepository.findAllSkus())[0];
  if (!sku) return res.status(400).json({ error: 'No hay SKUs cargados' });
  // Una sola prueba a la vez: si llegan varias, comparten el resultado.
  if (!diagnosticoEnCurso) {
    diagnosticoEnCurso = scraperService.diagnostico(sku).finally(() => { diagnosticoEnCurso = null; });
  }
  const r = await diagnosticoEnCurso;
  res.type('text/plain; charset=utf-8').send(JSON.stringify(r, null, 2));
});

module.exports = { solicitar, estado, solicitarTotal, resumen, diagnostico };
