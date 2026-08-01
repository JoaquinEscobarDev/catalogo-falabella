const express = require('express');
const productsController = require('../controllers/productsController');

const router = express.Router();

router.get('/skus', productsController.list);
router.post('/skus', productsController.create);
router.delete('/skus/:sku', productsController.remove);

router.get('/categoria/:nombre', productsController.findByCategory);
router.get('/producto/:sku', productsController.getProducto);

module.exports = router;
