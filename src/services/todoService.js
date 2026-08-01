const todoRepository = require('../repositories/todoRepository');
const priceHistoryRepository = require('../repositories/priceHistoryRepository');

// ToDo compartido: vive en la base, no en localStorage, así todos los
// dispositivos ven la misma lista. Cualquier SKU con cambio de precio sin
// ver (detectado por el refresh diario) se agrega solo al ToDo de todos.
async function listAll() {
  const pendientes = await priceHistoryRepository.findUnseenSkus();
  for (const sku of pendientes) await todoRepository.ensureExists(sku);

  const items = await todoRepository.findAll();
  const cambiosPorSku = await priceHistoryRepository.findUnseenBySku();
  return items.map(i => ({ ...i, cambios: cambiosPorSku[i.sku] || [] }));
}

async function upsert(sku, size, quantity) {
  await todoRepository.upsert(sku, size, quantity);
}

async function remove(sku) {
  await priceHistoryRepository.markSeenBySku(sku);
  await todoRepository.remove(sku);
}

async function clear() {
  await priceHistoryRepository.markAllSeen();
  await todoRepository.clear();
}

module.exports = { listAll, upsert, remove, clear };
