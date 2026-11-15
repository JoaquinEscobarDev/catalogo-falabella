const express = require('express');
const ctrl = require('../controllers/connectController');

const router = express.Router();

router.get('/connect/planes', ctrl.listarPlanes);
router.post('/connect/planes', ctrl.crearPlan);
router.delete('/connect/planes/:id', ctrl.eliminarPlan);

// El CSV va antes que /:id para que "ventas.csv" no se tome como un id.
router.get('/connect/ventas.csv', ctrl.csvVentas);
router.get('/connect/ventas', ctrl.listarVentas);
router.post('/connect/ventas', ctrl.crearVenta);
router.delete('/connect/ventas/:id', ctrl.eliminarVenta);

module.exports = router;
