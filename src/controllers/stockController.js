const stockService = require('../services/stockService');
const asyncHandler = require('./asyncHandler');

const getStock = asyncHandler(async (req, res) => {
  res.json(await stockService.getStock(req.params.sku));
});

module.exports = { getStock };
