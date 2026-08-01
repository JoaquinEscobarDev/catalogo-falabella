const express = require('express');
const stockController = require('../controllers/stockController');

const router = express.Router();

router.get('/stock/:sku', stockController.getStock);

module.exports = router;
