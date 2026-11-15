const express = require('express');
const refreshController = require('../controllers/refreshController');

const router = express.Router();

router.post('/solicitar-refresh', refreshController.solicitar);
router.get('/solicitar-refresh/:id', refreshController.estado);
router.post('/refresh-total', refreshController.solicitarTotal);
router.get('/estado', refreshController.resumen);

module.exports = router;
