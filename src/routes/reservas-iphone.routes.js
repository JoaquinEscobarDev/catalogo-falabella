const express = require('express');
const QRCode = require('qrcode');
const asyncHandler = require('../controllers/asyncHandler');
const ctrl = require('../controllers/reservasIphoneController');

const router = express.Router();

router.post('/reservas-iphone', ctrl.crear);
router.get('/reservas-iphone', ctrl.listar);

router.get('/reservas-iphone/qr', asyncHandler(async (req, res) => {
  const url = `${req.protocol}://${req.get('host')}/reserva-iphone`;
  const print = req.query.print === '1';
  const color = print
    ? { dark: '#000000', light: '#ffffff' }
    : { dark: '#e6edf3', light: '#0d1117' };
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 300, color });
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(svg);
}));

module.exports = router;
