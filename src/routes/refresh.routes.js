const express = require('express');
const refreshController = require('../controllers/refreshController');

const router = express.Router();

router.post('/solicitar-refresh', refreshController.solicitar);
router.get('/solicitar-refresh/:id', refreshController.estado);

module.exports = router;
