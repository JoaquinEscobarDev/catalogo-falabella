const express = require('express');
const couponsController = require('../controllers/couponsController');

const router = express.Router();

router.get('/cupones', couponsController.list);
router.get('/cupones/productos', couponsController.productos);
router.post('/cupones/ocultos', couponsController.ocultar);
router.delete('/cupones/ocultos', couponsController.mostrar);
router.post('/cupones', couponsController.create);
router.delete('/cupones/:id', couponsController.remove);

module.exports = router;
