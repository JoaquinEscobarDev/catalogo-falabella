const asyncHandler = require('./asyncHandler');
const service = require('../services/encuestasService');

const crear = asyncHandler(async (req, res) => {
  const { tienda, p1, p2, p3, p4, p5 } = req.body;
  const encuesta = await service.crearEncuesta({ tienda, p1, p2, p3, p4, p5 });
  res.status(201).json({ ok: true, encuesta });
});

const listar = asyncHandler(async (req, res) => {
  const encuestas = await service.obtenerEncuestas(req.query.tienda);
  const resumen   = await service.resumenPorTienda();
  res.json({ encuestas, resumen });
});

module.exports = { crear, listar };
