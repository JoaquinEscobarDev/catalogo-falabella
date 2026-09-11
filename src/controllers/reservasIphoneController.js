const asyncHandler = require('./asyncHandler');
const service = require('../services/reservasIphoneService');

const crear = asyncHandler(async (req, res) => {
  const reserva = await service.crearReserva(req.body);
  res.status(201).json({ ok: true, reserva });
});

const listar = asyncHandler(async (req, res) => {
  const reservas = await service.obtenerReservas();
  res.json({ reservas });
});

module.exports = { crear, listar };
