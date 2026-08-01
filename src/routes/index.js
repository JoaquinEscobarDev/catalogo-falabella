const express = require('express');

const router = express.Router();

router.use(require('./products.routes'));
router.use(require('./stock.routes'));
router.use(require('./todo.routes'));
router.use(require('./refresh.routes'));

module.exports = router;
