const express = require('express');
const todoController = require('../controllers/todoController');

const router = express.Router();

router.get('/todo', todoController.list);
router.post('/todo', todoController.upsert);
router.delete('/todo/:sku', todoController.remove);
router.post('/todo/clear', todoController.clear);

module.exports = router;
