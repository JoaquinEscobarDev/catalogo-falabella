const express = require('express');
const couponsController = require('../controllers/couponsController');

const router = express.Router();

router.get('/cupones', couponsController.list);
router.post('/cupones', couponsController.create);
router.delete('/cupones/:id', couponsController.remove);

module.exports = router;
