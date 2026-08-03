const express = require('express');
const productsController = require('../controllers/productsController');

const router = express.Router();

router.get('/skus', productsController.list);
router.post('/skus', productsController.create);
router.delete('/skus/:sku', productsController.remove);

router.get('/search', productsController.search);
router.get('/categoria/:nombre', productsController.findByCategory);
router.get('/producto/:sku', productsController.getProducto);
router.patch('/producto/:sku/upc', productsController.setUpc);

module.exports = router;
