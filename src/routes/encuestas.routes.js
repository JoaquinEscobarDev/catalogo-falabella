const express = require('express');
const QRCode  = require('qrcode');
const asyncHandler = require('../controllers/asyncHandler');
const ctrl    = require('../controllers/encuestasController');
const { TIENDAS } = require('../services/encuestasService');

const router = express.Router();

router.post('/encuestas', ctrl.crear);
router.get('/encuestas',  ctrl.listar);

router.get('/encuestas/qr/:tienda', asyncHandler(async (req, res) => {
  const { tienda } = req.params;
  if (!TIENDAS.includes(tienda)) return res.status(404).json({ error: 'Tienda no encontrada' });
  const url    = `${req.protocol}://${req.get('host')}/encuesta/${tienda}`;
  const buffer = await QRCode.toBuffer(url, { margin: 1, width: 400, color: { dark: '#000000', light: '#ffffff' } });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(buffer);
}));

module.exports = router;
