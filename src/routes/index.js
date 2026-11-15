const express = require('express');

const router = express.Router();

router.use(require('./products.routes'));
router.use(require('./stock.routes'));
router.use(require('./todo.routes'));
router.use(require('./refresh.routes'));
router.use(require('./coupons.routes'));
router.use(require('./connect.routes'));
router.use(require('./reservas-iphone.routes'));
router.use(require('./encuestas.routes'));

module.exports = router;
